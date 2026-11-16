import { GUEST_ID } from '../session';
import { readLocalChat, writeLocalChat } from '../local-store';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import MarkdownMessage from './MarkdownMessage';
import type { Task } from '../domain/tasks';
import { streamStep, type WireMessage } from '../agent/client';
import { authHeaders } from '../auth-client';
import { executeTool, needsApproval } from '../agent/tools';

type FeedMessage = { who: 'user' | 'assistant'; text: string; actions?: string[]; error?: boolean };
const PROMPTS = ["What's due this week?", 'Summarize my board', 'What should I do first?'];
export default function Copilot({
  getTasks,
  commitTasks,
  open,
  onToggle,
  onBusyChange,
  userId,
}: {
  getTasks: () => Task[];
  commitTasks: (tasks: Task[]) => Promise<void>;
  open: boolean;
  onToggle: () => void;
  userId: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const [historyReady, setHistoryReady] = useState(false);
  const chatRevision = useRef(0);
  const epoch = useRef(0);
  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const historyRef = useRef<WireMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [approval, setApproval] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const load = async () => {
      try {
        const saved =
          userId === GUEST_ID
            ? readLocalChat()
            : await (async () => {
                const response = await fetch('/api/chat', { headers: await authHeaders(userId) });
                if (!response.ok) throw new Error('Could not load saved chat. Reload to retry.');
                return response.json();
              })();
        if (!active) return;
        setFeed(saved.feed);
        historyRef.current = saved.history;
        chatRevision.current = saved.chatRevision;
        epoch.current = saved.epoch;
        setHistoryReady(true);
      } catch (error) {
        if (active)
          setFeed([
            {
              who: 'assistant' as const,
              text: error instanceof Error ? error.message : 'Could not load chat.',
              error: true,
            },
          ]);
      }
    };
    void load();
    return () => {
      active = false;
      mounted.current = false;
      onBusyChange(false);
      controller.current?.abort();
      resolver.current?.(false);
    };
  }, [userId, onBusyChange]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed, streaming, busy, approval]);
  function requestApproval(text: string) {
    setApproval(text);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }
  function decide(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setApproval(null);
  }
  async function persistChat(finalFeed: FeedMessage[]) {
    if (userId === GUEST_ID) {
      const saved = await writeLocalChat(
        { feed: finalFeed, history: historyRef.current },
        epoch.current,
        chatRevision.current,
      );
      chatRevision.current = saved.chatRevision;
      return;
    }
    const response = await fetch('/api/chat', {
      method: 'PUT',
      headers: { ...(await authHeaders(userId)), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat: { feed: finalFeed, history: historyRef.current },
        epoch: epoch.current,
        chatRevision: chatRevision.current,
      }),
    });
    if (!response.ok)
      throw new Error(
        'Chat history could not be saved. Task changes already confirmed remain saved. Reload before continuing.',
      );
    const saved = await response.json();
    chatRevision.current = saved.chatRevision;
  }
  async function send(override?: string) {
    const question = (override || input).trim();
    if (!question || busy || !historyReady) return;
    setInput('');
    setBusy(true);
    onBusyChange(true);
    setStreaming('');
    setFeed((previous) => [...previous, { who: 'user', text: question }]);
    const transcript: WireMessage[] = [...historyRef.current, { role: 'user', content: question }];
    const actions: string[] = [];
    let lastText = '';
    let failed = false;
    controller.current = new AbortController();
    try {
      for (let iteration = 0; iteration < 6; iteration++) {
        const answer = await streamStep(
          transcript,
          getTasks(),
          setStreaming,
          userId,
          controller.current.signal,
        );
        if (!mounted.current) return;
        transcript.push(answer);
        if (answer.content) lastText = answer.content;
        if (!answer.tool_calls?.length) break;
        const mutating = answer.tool_calls.filter(
          (call) => !['list_tasks', 'get_task'].includes(call.function.name),
        );
        const allowGrouped =
          mutating.length <= 1 ||
          (await requestApproval(
            `The AI requested ${mutating.length} separate task changes in one step. Approve this group of actions?`,
          ));
        setStreaming('Applying actions to your board…');
        for (const call of answer.tool_calls) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(call.function.arguments || '{}');
          } catch {
            parsed = {};
          }
          const description = needsApproval(call.function.name, parsed, getTasks());
          let result;
          if (
            (!allowGrouped && !['list_tasks', 'get_task'].includes(call.function.name)) ||
            (description && !(await requestApproval(description)))
          ) {
            result = { ok: false, message: 'User declined the action. Nothing was changed.' };
            actions.push('Skipped action — approval declined');
          } else {
            if (!mounted.current) return;
            const outcome = executeTool(call.function.name, parsed, getTasks());
            if (outcome.changed) await commitTasks(outcome.tasks);
            result = outcome.result;
            actions.push(`${outcome.result.ok ? '✓' : '!'} ${outcome.label}`);
          }
          transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (iteration === 5)
          lastText =
            'I stopped the workflow after six steps to avoid unintended changes. Please review the results.';
      }
      const cutoff = Math.max(0, transcript.length - 40);
      const atUser = transcript.findIndex((entry, i) => i >= cutoff && entry.role === 'user');
      historyRef.current = transcript.slice(atUser < 0 ? 0 : atUser);
    } catch (error) {
      failed = true;
      lastText = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
    } finally {
      if (mounted.current) {
        const finalFeed: FeedMessage[] = [
          ...feed,
          { who: 'user' as const, text: question },
          {
            who: 'assistant' as const,
            text:
              lastText ||
              (actions.length
                ? 'I finished processing your request.'
                : 'I could not generate a response. Please try again.'),
            actions,
            error: failed,
          },
        ].slice(-30);
        setStreaming('Saving chat…');
        setFeed(finalFeed);
        try {
          await persistChat(finalFeed);
        } catch (error) {
          if (mounted.current) {
            setHistoryReady(false);
            setFeed((previous) => [
              ...previous,
              {
                who: 'assistant' as const,
                text: error instanceof Error ? error.message : 'Chat save failed.',
                error: true,
              },
            ]);
          }
        }
        if (mounted.current) {
          setBusy(false);
          onBusyChange(false);
          setStreaming('');
        }
      }
    }
  }
  return (
    <aside className={`copilot-panel ${open ? 'is-open' : ''}`} aria-label="AI Copilot">
      <div className="copilot-head">
        <div className="copilot-avatar">
          <Sparkles size={20} />
        </div>
        <div className="copilot-heading">
          <strong>AI Assistant</strong>
          <span>
            <span className="status-dot" /> Task management assistant
          </span>
        </div>
        <button className="icon-button close-copilot" aria-label="Close copilot" onClick={onToggle}>
          <X size={19} />
        </button>
      </div>
      <div className="copilot-conversation">
        {!historyReady && !feed.length && <p role="status">Loading your saved chat…</p>}
        {feed.length === 0 && (
          <div className="copilot-welcome">
            <div className="welcome-orb">
              <Bot size={29} />
            </div>
            <h3>How can I help with your tasks?</h3>
            <p>Manage tasks, move priorities, and uncover insights with natural language.</p>
            <div className="prompt-stack">
              {PROMPTS.map((prompt) => (
                <button key={prompt} disabled={busy || !historyReady} onClick={() => void send(prompt)}>
                  {prompt}
                  <ArrowUp size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {feed.map((message, i) => (
          <div className={`chat-entry ${message.who}`} key={i}>
            <div className="message-bubble">
              {message.error && <CircleAlert size={16} className="inline-icon" />}
              <MarkdownMessage text={message.text} />
            </div>
            {message.actions && message.actions.length > 0 && (
              <div className="action-log">
                <div className="action-log-title">
                  <ShieldCheck size={14} /> Actions recorded
                </div>
                {message.actions.map((action, j) => (
                  <span key={j}>{action}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-entry assistant">
            <div className="message-bubble live">
              {streaming ? (
                <MarkdownMessage text={streaming} />
              ) : (
                <>
                  <Loader2 className="spin inline-icon" size={15} /> Thinking and checking tasks…
                </>
              )}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="copilot-bottom">
        <div className="ai-hint">
          <ShieldCheck size={14} /> Destructive & bulk actions require approval
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="chat-compose"
        >
          <textarea
            aria-label="Ask your copilot"
            placeholder="Ask me anything about your tasks…"
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={busy || !historyReady}
          />
          <button
            className="send-button"
            type="submit"
            disabled={busy || !historyReady || !input.trim()}
            aria-label="Send message"
          >
            {busy ? <Loader2 className="spin" size={17} /> : <ArrowUp size={19} />}
          </button>
        </form>
        <div className="copilot-disclaimer">
          Powered by OpenRouter · Task data processed for AI requests
        </div>
      </div>
      {approval && (
        <div className="approval-backdrop">
          <div
            className="approval-card"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm AI action"
          >
            <div className="approval-icon">
              <ShieldCheck size={23} />
            </div>
            <h3>Review AI action</h3>
            <p>{approval}</p>
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => decide(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={() => decide(true)}>
                <Check size={16} /> Confirm action
              </button>
            </div>
            <p className="approval-footnote">
              <ChevronDown size={13} /> Your choice is sent back to the AI
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
