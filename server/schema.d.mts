import type { Task } from '../src/domain/tasks';
export const tasksSchema: { parse(input: unknown): Task[] };
export const backupSchema: {
  parse(input: unknown): { format: 'taskflow'; version: 1; exportedAt: string; tasks: Task[] };
};

export const chatSchema: { parse(input: unknown): import('../src/local-store').LocalChat };
