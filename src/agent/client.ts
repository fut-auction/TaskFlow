import { GUEST_ID } from '../session';
import { authHeaders } from '../auth-client';
import type { Task } from '../domain/tasks';

export type WireToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type WireMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
};
export type AgentReply = { role: 'assistant'; content: string | null; tool_calls?: WireToolCall[] };

export async function streamStep(
  messages: WireMessage[],
  snapshot: Task[],
  onToken: (text: string) => void,
  userId: string,
  signal?: AbortSignal,
): Promise<AgentReply> {
  const response = await fetch(userId === GUEST_ID ? '/api/guest/agent/step' : '/api/agent/step', {
    method: 'POST',
    signal,
    headers: { ...(await authHeaders(userId)), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      ...(userId === GUEST_ID ? { snapshot } : {}),
      today: new Date().toLocaleDateString('en-CA'),
    }),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(problem.error || `Agent returned HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Streaming is not supported by this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  const toolCalls = new Map<number, WireToolCall>();
  let ended = false;
  try {
    while (!ended) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending = (pending + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
      let separator: number;
      while ((separator = pending.indexOf('\n\n')) !== -1) {
        const packet = pending.slice(0, separator);
        pending = pending.slice(separator + 2);
        for (const line of packet.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            ended = true;
            break;
          }
          if (!data) continue;
          let event: {
            error?: string | { message?: string };
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.error)
            throw new Error(
              typeof event.error === 'string' ? event.error : event.error.message || 'OpenRouter error',
            );
          const delta = event.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onToken(content);
          }
          for (const part of delta?.tool_calls || []) {
            const prior = toolCalls.get(part.index) || {
              id: '',
              type: 'function' as const,
              function: { name: '', arguments: '' },
            };
            prior.id += part.id || '';
            prior.function.name += part.function?.name || '';
            prior.function.arguments += part.function?.arguments || '';
            toolCalls.set(part.index, prior);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return { role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}) };
}
