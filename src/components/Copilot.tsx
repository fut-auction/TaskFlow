import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, CircleAlert, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Task } from '../domain/tasks';
import { streamStep, type WireMessage } from '../agent/client';
import { executeTool, needsApproval } from '../agent/tools';

type FeedMessage = { who: 'user' | 'assistant'; text: string; actions?: string[]; error?: boolean };
const PROMPTS = ["What's due this week?", 'Summarize my board', 'What should I do first?'];
function readStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export default function Copilot({ getTasks, commitTasks, open, onToggle }: {
  getTasks: () => Task[];
  commitTasks: (tasks: Task[]) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [feed, setFeed] = useState<FeedMessage[]>(() => readStorage('taskflow:feed:v1', []));
  const historyRef = useRef<WireMessage[]>(readStorage('taskflow:chat:v1', []));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [approval, setApproval] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => localStorage.setItem('taskflow:feed:v1', JSON.stringify(feed.slice(-30))), [feed]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [feed, streaming, busy, approval]);
  function requestApproval(text: string) {
    setApproval(text);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }
  function decide(ok: boolean) { resolver.current?.(ok); resolver.current = null; setApproval(null); }
  async function send(override?: string) {
    const question = (override || input).trim();
    if (!question || busy) return;
    setInput(''); setBusy(true); setStreaming('');
    setFeed(previous => [...previous, { who: 'user', text: question }]);
    const transcript: WireMessage[] = [...historyRef.current, { role: 'user', content: question }];
    const actions: string[] = [];
    let lastText = '';
    let failed = false;
    try {
      for (let iteration = 0; iteration < 6; iteration++) {
        const answer = await streamStep(transcript, getTasks(), setStreaming);
        transcript.push(answer);
        if (answer.content) lastText = answer.content;
        if (!answer.tool_calls?.length) break;
        const mutating = answer.tool_calls.filter(call => !['list_tasks', 'get_task'].includes(call.function.name));
        const allowGrouped = mutating.length <= 1 || await requestApproval(`The AI requested ${mutating.length} separate task changes in one step. Approve this group of actions?`);
        setStreaming('Applying actions to your board…');
        for (const call of answer.tool_calls) {
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(call.function.arguments || '{}'); }
          catch { parsed = {}; }
          const description = needsApproval(call.function.name, parsed, getTasks());
          let result;
          if ((!allowGrouped && !['list_tasks', 'get_task'].includes(call.function.name)) || (description && !(await requestApproval(description)))) {
            result = { ok: false, message: 'User declined the action. Nothing was changed.' };
            actions.push('Skipped action — approval declined');
          } else {
            const outcome = executeTool(call.function.name, parsed, getTasks());
            if (outcome.changed) commitTasks(outcome.tasks);
            result = outcome.result;
            actions.push(`${outcome.result.ok ? '✓' : '!'} ${outcome.label}`);
          }
          transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (iteration === 5) lastText = 'I stopped the workflow after six steps to avoid unintended changes. Please review the results.';
      }
      const cutoff = Math.max(0, transcript.length - 40);
      const atUser = transcript.findIndex((entry, i) => i >= cutoff && entry.role === 'user');
      historyRef.current = transcript.slice(atUser < 0 ? 0 : atUser);
      localStorage.setItem('taskflow:chat:v1', JSON.stringify(historyRef.current));
    } catch (error) {
      failed = true;
      lastText = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
    } finally {
      setFeed(previous => [...previous, { who: 'assistant', text: lastText || (actions.length ? 'I finished processing your request.' : 'I could not generate a response. Please try again.'), actions, error: failed }]);
      setBusy(false); setStreaming('');
    }
  }
  return <aside className={`copilot-panel ${open ? 'is-open' : ''}`} aria-label="AI Copilot">
    <div className="copilot-head"><div className="copilot-avatar"><Sparkles size={20}/></div><div className="copilot-heading"><strong>AI Assistant</strong><span><span className="status-dot"/> Task management assistant</span></div><button className="icon-button close-copilot" aria-label="Close copilot" onClick={onToggle}><X size={19}/></button></div>
    <div className="copilot-conversation">
      {feed.length === 0 && <div className="copilot-welcome"><div className="welcome-orb"><Bot size={29}/></div><h3>How can I help with your tasks?</h3><p>Manage tasks, move priorities, and uncover insights with natural language.</p><div className="prompt-stack">{PROMPTS.map(prompt => <button key={prompt} disabled={busy} onClick={() => void send(prompt)}>{prompt}<ArrowUp size={14}/></button>)}</div></div>}
      {feed.map((message, i) => <div className={`chat-entry ${message.who}`} key={i}><div className="message-bubble">{message.error && <CircleAlert size={16} className="inline-icon"/>}{message.text}</div>{message.actions && message.actions.length > 0 && <div className="action-log"><div className="action-log-title"><ShieldCheck size={14}/> Actions recorded</div>{message.actions.map((action, j) => <span key={j}>{action}</span>)}</div>}</div>)}
      {busy && <div className="chat-entry assistant"><div className="message-bubble live">{streaming ? streaming : <><Loader2 className="spin inline-icon" size={15}/> Thinking and checking tasks…</>}</div></div>}
      <div ref={endRef}/>
    </div>
    <div className="copilot-bottom"><div className="ai-hint"><ShieldCheck size={14}/> Destructive & bulk actions require approval</div><form onSubmit={e => { e.preventDefault(); void send(); }} className="chat-compose"><textarea aria-label="Ask your copilot" placeholder="Ask me anything about your tasks…" value={input} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} disabled={busy}/><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="Send message">{busy ? <Loader2 className="spin" size={17}/> : <ArrowUp size={19}/>}</button></form><div className="copilot-disclaimer">Powered by OpenRouter · Task data processed for AI requests</div></div>
    {approval && <div className="approval-backdrop"><div className="approval-card" role="alertdialog" aria-modal="true" aria-label="Confirm AI action"><div className="approval-icon"><ShieldCheck size={23}/></div><h3>Review AI action</h3><p>{approval}</p><div className="approval-actions"><button className="secondary-button" onClick={() => decide(false)}>Cancel</button><button className="primary-button" onClick={() => decide(true)}><Check size={16}/> Confirm action</button></div><p className="approval-footnote"><ChevronDown size={13}/> Your choice is sent back to the AI</p></div></div>}
  </aside>;
}
