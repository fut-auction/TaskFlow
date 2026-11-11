import { describe, expect, it } from 'vitest';
import { isOverdue, makeTask, moveTask, updateTask, type Task } from './tasks';
import { executeTool, needsApproval } from '../agent/tools';
const task = (id: string, status: Task['status'], order = 0): Task => ({
  id, title: id, description: '', status, priority: 'medium', dueDate: null, tags: [], checklist: [], notes: [], order, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
});
describe('task domain', () => {
  it('creates a task with defaults', () => {
    const t = makeTask({ title: '  Test task  ' }, []);
    expect(t.title).toBe('Test task'); expect(t.status).toBe('todo'); expect(t.id).toBeTruthy();
  });
  it('moves and reorders tasks without duplicates', () => {
    const list = [task('a', 'todo'), task('b', 'inprogress'), task('c', 'inprogress', 1)];
    const moved = moveTask(list, 'a', 'inprogress', 'c');
    expect(moved).toHaveLength(3);
    expect(moved.find(t => t.id === 'a')?.status).toBe('inprogress');
    expect(moved.filter(t => t.status === 'inprogress').sort((x, y) => x.order - y.order).map(t => t.id)).toEqual(['b', 'a', 'c']);
  });
  it('does not mutate the input collection', () => {
    const before = [task('a', 'todo')];
    const after = updateTask(before, 'a', { priority: 'urgent' });
    expect(before[0].priority).toBe('medium'); expect(after[0].priority).toBe('urgent');
  });
  it('detects overdue unfinished tasks', () => {
    const value = { ...task('a', 'todo'), dueDate: '2026-11-09' };
    expect(isOverdue(value, new Date('2026-11-10T12:00:00'))).toBe(true);
    expect(isOverdue({ ...value, status: 'done' }, new Date('2026-11-10T12:00:00'))).toBe(false);
  });
});
describe('agent safeguards', () => {
  it('requests approval for destructive and bulk operations', () => {
    expect(needsApproval('delete_task', { id: 'a' }, [task('a', 'todo')])).toContain('Delete task');
    expect(needsApproval('bulk_update_tasks', { ids: ['a'], patch: { status: 'done' } }, [])).toContain('Update 1 task');
  });
  it('rejects invalid bulk edits atomically', () => {
    const before = [task('a', 'todo')];
    const result = executeTool('bulk_update_tasks', { ids: ['a', 'missing'], patch: { priority: 'urgent' } }, before);
    expect(result.changed).toBe(false); expect(result.tasks).toEqual(before);
  });
  it('does not allow injecting additional task fields', () => {
    const result = executeTool('update_task', { id: 'a', patch: { id: 'overwritten' } }, [task('a', 'todo')]);
    expect(result.result.ok).toBe(false);
  });
  it('reports task creation to the model with created ID', () => {
    const result = executeTool('create_task', { title: 'New' }, []);
    expect(result.changed).toBe(true); expect(result.result.id).toEqual(result.tasks[0].id);
  });
});
