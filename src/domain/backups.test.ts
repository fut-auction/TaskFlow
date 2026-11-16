import { describe, expect, it } from 'vitest';
import { backupSchema, tasksSchema } from '../../server/schema.mjs';
import { makeTask } from './tasks';
const valid = () => makeTask({ title: 'User-created task' }, []);
describe('backup and persistence validation', () => {
  it('accepts an empty store without generating tasks', () => {
    expect(tasksSchema.parse([])).toEqual([]);
  });
  it('round trips every field in a versioned export', () => {
    const t = {
      ...valid(),
      description: 'Details',
      tags: ['work'],
      notes: ['note'],
      checklist: [{ id: 'step1', text: 'Review', done: false }],
      dueDate: '2026-11-20',
    };
    const data = { format: 'taskflow', version: 1, exportedAt: new Date().toISOString(), tasks: [t] };
    expect(backupSchema.parse(JSON.parse(JSON.stringify(data))).tasks).toEqual([t]);
  });
  it('rejects duplicate IDs, unknown fields, invalid dates and oversized collections', () => {
    const t = valid();
    for (const input of [
      [t, t],
      [{ ...t, secret: 'key' }],
      [{ ...t, dueDate: '2026-02-30' }],
      Array.from({ length: 251 }, () => valid()),
      [{ ...t, priority: 'fake' }],
    ])
      expect(() => tasksSchema.parse(input)).toThrow();
  });
  it('rejects unversioned and unsupported backups', () => {
    expect(() => backupSchema.parse({ tasks: [] })).toThrow();
    expect(() =>
      backupSchema.parse({
        format: 'taskflow',
        version: 2,
        exportedAt: new Date().toISOString(),
        tasks: [],
      }),
    ).toThrow();
  });
});
