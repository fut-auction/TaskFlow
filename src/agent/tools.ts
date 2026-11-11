import { z } from 'zod';
import { makeTask, moveTask, updateTask, STATUSES, PRIORITIES, type Task, type TaskPatch } from '../domain/tasks';

const checklist = z.array(z.object({ id: z.string().optional(), text: z.string().min(1), done: z.boolean() })).max(100);
const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  status: z.enum(STATUSES as [typeof STATUSES[number], ...typeof STATUSES[number][]]),
  priority: z.enum(PRIORITIES as [typeof PRIORITIES[number], ...typeof PRIORITIES[number][]]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  tags: z.array(z.string().max(40)).max(20),
  checklist,
  notes: z.array(z.string().max(2000)).max(100),
};
const patchSchema = z.object(fields).partial().strict();
export type ToolResult = { tasks: Task[]; result: { ok: boolean; message: string; [key: string]: unknown }; label: string; changed: boolean };
export function needsApproval(name: string, args: Record<string, unknown>, tasks: Task[]): string | null {
  if (name === 'delete_task') return `Delete task “${tasks.find(t => t.id === args.id)?.title || args.id}”? This cannot be undone.`;
  if (name === 'bulk_update_tasks') {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    return `Update ${ids.length} task${ids.length === 1 ? '' : 's'} at once? Review: ${JSON.stringify({ patch: args.patch, addTags: args.addTags }).slice(0, 300)}`;
  }
  return null;
}
function finish(tasks: Task[], message: string, changed = false): ToolResult {
  return { tasks, result: { ok: true, message }, label: message, changed };
}
function reject(tasks: Task[], message: string): ToolResult {
  return { tasks, result: { ok: false, message }, label: message, changed: false };
}
function normalizedPatch(value: unknown): TaskPatch {
  const parsed = patchSchema.parse(value);

  const { checklist: items, ...rest } = parsed;

  return {
    ...rest,
    ...(items !== undefined
      ? {
          checklist: items.map(item => ({
            id: item.id || crypto.randomUUID(),
            text: item.text,
            done: item.done,
          })),
        }
      : {}),
  };
}export function executeTool(name: string, input: unknown, tasks: Task[]): ToolResult {
  try {
  const args = z.record(z.string(), z.unknown()).parse(input);
    if (name === 'list_tasks') {
      const parsed = z.object({ query: z.string().optional(), status: z.enum(['todo', 'inprogress', 'done']).optional(), overdueOnly: z.boolean().optional() }).parse(args);
      const today = new Date().toLocaleDateString('en-CA');
      const found = tasks.filter(t => (!parsed.query || [t.title, t.description, t.tags.join(' ')].join(' ').toLowerCase().includes(parsed.query.toLowerCase())) && (!parsed.status || t.status === parsed.status) && (!parsed.overdueOnly || (!!t.dueDate && t.dueDate < today && t.status !== 'done')));
      const output = finish(tasks, `Found ${found.length} matching task${found.length === 1 ? '' : 's'}`);
      return { ...output, result: { ...output.result, tasks: found.slice(0, 80) } };
    }
    if (name === 'get_task') {
      const { id } = z.object({ id: z.string() }).parse(args);
      const target = tasks.find(t => t.id === id);
      if (!target) return reject(tasks, 'Task not found.');
      const output = finish(tasks, `Read “${target.title}”`);
      return { ...output, result: { ...output.result, task: target } };
    }
    if (name === 'create_task') {
      const parsed = z.object(fields).partial().extend({ title: fields.title }).strict().parse(args);
      const created = makeTask({ ...parsed, checklist: parsed.checklist?.map(item => ({ ...item, id: item.id || crypto.randomUUID() })) }, tasks);
      return { ...finish([...tasks, created], `Created “${created.title}”`, true), result: { ok: true, message: `Created “${created.title}”`, id: created.id } };
    }
    if (name === 'update_task') {
      const { id, patch } = z.object({ id: z.string(), patch: z.unknown() }).parse(args);
      const found = tasks.find(t => t.id === id);
      if (!found) return reject(tasks, 'Task not found.');
      const parsed = normalizedPatch(patch);
      return finish(updateTask(tasks, id, parsed), `Updated “${found.title}”`, true);
    }
    if (name === 'move_task') {
      const { id, status, beforeId } = z.object({ id: z.string(), status: z.enum(['todo', 'inprogress', 'done']), beforeId: z.string().optional() }).parse(args);
      const found = tasks.find(t => t.id === id);
      if (!found) return reject(tasks, 'Task not found.');
      if (beforeId && !tasks.some(t => t.id === beforeId && t.status === status)) return reject(tasks, 'Destination task not found in target column.');
      return finish(moveTask(tasks, id, status, beforeId), `Moved “${found.title}” to ${status}`, true);
    }
    if (name === 'delete_task') {
      const { id } = z.object({ id: z.string() }).parse(args);
      const found = tasks.find(t => t.id === id);
      if (!found) return reject(tasks, 'Task not found.');
      return finish(tasks.filter(t => t.id !== id), `Deleted “${found.title}”`, true);
    }
    if (name === 'bulk_update_tasks') {
      const { ids, patch, addTags } = z.object({ ids: z.array(z.string()).min(1).max(250), patch: z.unknown().optional(), addTags: z.array(z.string().trim().min(1).max(40)).max(20).optional() }).parse(args);
      const unique = new Set(ids);
      const found = tasks.filter(t => unique.has(t.id));
      if (found.length !== unique.size) return reject(tasks, 'One or more task IDs do not exist; no changes applied.');
      if (!patch && !addTags?.length) return reject(tasks, 'No updates provided.');
      const parsed = patch === undefined ? {} : normalizedPatch(patch);
      return finish(tasks.map(t => unique.has(t.id) ? { ...t, ...parsed, ...(addTags?.length ? { tags: [...new Set([...(parsed.tags || t.tags), ...addTags])] } : {}), updatedAt: new Date().toISOString() } : t), `Updated ${found.length} tasks`, true);
    }
    if (name === 'add_note') {
      const { id, text } = z.object({ id: z.string(), text: z.string().trim().min(1).max(2000) }).parse(args);
      const found = tasks.find(t => t.id === id);
      if (!found) return reject(tasks, 'Task not found.');
      return finish(updateTask(tasks, id, { notes: [...found.notes, text] }), `Added note to “${found.title}”`, true);
    }
    return reject(tasks, `Unknown tool: ${name}`);
  } catch (err) {
    return reject(tasks, `Invalid action arguments: ${err instanceof Error ? err.message.slice(0, 200) : 'Unknown error'}`);
  }
}
