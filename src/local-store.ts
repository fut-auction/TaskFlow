import { tasksSchema, chatSchema } from '../server/schema.mjs';
import type { Task } from './domain/tasks';
import type { WireMessage } from './agent/client';
import { GUEST_STORAGE_KEY } from './session';
export type LocalChat = {
  feed: { who: 'user' | 'assistant'; text: string; actions?: string[]; error?: boolean }[];
  history: WireMessage[];
};
type LocalState = {
  version: 1;
  tasks: Task[];
  revision: number;
  epoch: number;
  chat: LocalChat;
  chatRevision: number;
};
function readState(): LocalState {
  const raw = localStorage.getItem(GUEST_STORAGE_KEY);
  if (!raw)
    return {
      version: 1,
      tasks: [],
      revision: 0,
      epoch: 0,
      chat: { feed: [], history: [] },
      chatRevision: 0,
    };
  try {
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      ![data.revision, data.epoch, data.chatRevision].every((v) => Number.isSafeInteger(v) && v >= 0)
    )
      throw new Error('Invalid local state');
    return { ...data, tasks: tasksSchema.parse(data.tasks), chat: chatSchema.parse(data.chat) };
  } catch {
    throw new Error(
      'Saved guest data could not be read. It has been kept unchanged. Export/recover the browser data before replacing it.',
    );
  }
}
function writeState(data: LocalState) {
  if (new TextEncoder().encode(JSON.stringify(data)).length > 900000)
    throw new Error('Guest storage limit is 900 KB. Export and reduce your data.');
  // A single setItem is atomic. A failed/quota-limited write keeps the previous value.
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(data));
}
async function exclusive<T>(action: () => T): Promise<T> {
  if (typeof window !== 'undefined' && navigator.locks)
    return navigator.locks.request(GUEST_STORAGE_KEY, async () => action());
  return action();
}
export function readLocalTasks() {
  const { tasks, revision, epoch } = readState();
  return { tasks, revision, epoch };
}
export function writeLocalTasks(tasks: Task[], revision: number, clear = false) {
  return exclusive(() => {
    const current = readState();
    if (current.revision !== revision)
      throw new Error('Guest tasks changed in another tab. Refresh and try again.');
    const next = clear
      ? {
          ...current,
          tasks: [],
          revision: revision + 1,
          epoch: current.epoch + 1,
          chat: { feed: [], history: [] },
          chatRevision: 0,
        }
      : { ...current, tasks: tasksSchema.parse(tasks), revision: revision + 1 };
    writeState(next);
    return { tasks: next.tasks, revision: next.revision, epoch: next.epoch };
  });
}
export function readLocalChat() {
  const { chat, chatRevision, epoch } = readState();
  return { ...chat, chatRevision, epoch };
}
export function writeLocalChat(chat: LocalChat, epoch: number, chatRevision: number) {
  return exclusive(() => {
    const current = readState();
    if (current.epoch !== epoch || current.chatRevision !== chatRevision)
      throw new Error('Guest chat changed in another tab. Reload to continue.');
    const parsed = chatSchema.parse(chat);
    const next = { ...current, chat: parsed, chatRevision: chatRevision + 1 };
    writeState(next);
    return { ...parsed, epoch, chatRevision: next.chatRevision };
  });
}
