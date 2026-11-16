import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalTasks, writeLocalTasks, readLocalChat, writeLocalChat } from './local-store';
import { GUEST_STORAGE_KEY } from './session';
import { makeTask } from './domain/tasks';
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('guest local persistence', () => {
  it('starts empty without seeding or touching legacy data', () => {
    values.set('taskflow:tasks:v1', 'existing legacy data');
    expect(readLocalTasks()).toEqual({ tasks: [], revision: 0, epoch: 0 });
    expect(values.size).toBe(1);
  });
  it('round trips all task fields and rejects stale saves', async () => {
    const task = makeTask(
      {
        title: 'My task',
        notes: ['note'],
        tags: ['work'],
        checklist: [{ id: 'step', text: 'Review', done: true }],
        dueDate: '2026-11-20',
      },
      [],
    );
    await writeLocalTasks([task], 0);
    expect(readLocalTasks().tasks).toEqual([task]);
    await expect(writeLocalTasks([], 0)).rejects.toThrow('another tab');
    expect(readLocalTasks().tasks).toEqual([task]);
  });
  it('clears only guest tasks and chat and rejects stale chat restoration', async () => {
    values.set('unrelated', 'keep');
    values.set('taskflow:tasks:v1', 'keep legacy');
    await writeLocalTasks([makeTask({ title: 'Task' }, [])], 0);
    await writeLocalChat({ feed: [{ who: 'user', text: 'Hello' }], history: [] }, 0, 0);
    expect(readLocalChat().feed).toHaveLength(1);
    await writeLocalTasks([], 1, true);
    expect(readLocalTasks().tasks).toEqual([]);
    expect(readLocalChat().feed).toEqual([]);
    await expect(writeLocalChat({ feed: [], history: [] }, 0, 1)).rejects.toThrow('another tab');
    expect(values.get('unrelated')).toBe('keep');
    expect(values.get('taskflow:tasks:v1')).toBe('keep legacy');
  });
  it('preserves corrupt data and failed/quota-limited saves', async () => {
    values.set(GUEST_STORAGE_KEY, 'broken data');
    expect(() => readLocalTasks()).toThrow('kept unchanged');
    await expect(writeLocalTasks([], 0)).rejects.toThrow();
    expect(values.get(GUEST_STORAGE_KEY)).toBe('broken data');
    values.delete(GUEST_STORAGE_KEY);
    await writeLocalTasks([makeTask({ title: 'Saved' }, [])], 0);
    const before = values.get(GUEST_STORAGE_KEY);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    await expect(writeLocalTasks([], 1)).rejects.toThrow('Quota');
    expect(values.get(GUEST_STORAGE_KEY)).toBe(before);
  });
});
