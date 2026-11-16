import { z } from 'zod';
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid date',
  );
const stamp = z.string().datetime();
export const taskSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10000),
    status: z.enum(['todo', 'inprogress', 'done']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    dueDate: date.nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    checklist: z
      .array(z.object({ id: identifier, text: z.string().min(1).max(2000), done: z.boolean() }).strict())
      .max(100)
      .refine((v) => new Set(v.map((x) => x.id)).size === v.length, 'Duplicate checklist IDs'),
    notes: z.array(z.string().max(2000)).max(100),
    createdAt: stamp,
    updatedAt: stamp,
    order: z.number().int().nonnegative().max(1000000),
  })
  .strict();
export const tasksSchema = z
  .array(taskSchema)
  .max(250)
  .refine((v) => new Set(v.map((t) => t.id)).size === v.length, 'Duplicate task IDs');
export const backupSchema = z
  .object({
    format: z.literal('taskflow'),
    version: z.literal(1),
    exportedAt: stamp,
    tasks: tasksSchema,
  })
  .strict();
export function validateSize(tasks) {
  if (Buffer.byteLength(JSON.stringify(tasks), 'utf8') > 700000)
    throw Object.assign(new Error('Task storage limit is 700 KB. Export and reduce your data.'), {
      status: 413,
    });
}

export const chatSchema = z
  .object({
    feed: z
      .array(
        z
          .object({
            who: z.enum(['user', 'assistant']),
            text: z.string().max(12000),
            actions: z.array(z.string().max(1000)).max(100).optional(),
            error: z.boolean().optional(),
          })
          .strict(),
      )
      .max(30),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant', 'tool']),
            content: z.string().max(12000).nullable(),
            tool_call_id: z.string().max(200).optional(),
            tool_calls: z
              .array(
                z
                  .object({
                    id: z.string().max(200),
                    type: z.literal('function'),
                    function: z
                      .object({ name: z.string().max(100), arguments: z.string().max(12000) })
                      .strict(),
                  })
                  .strict(),
              )
              .max(30)
              .optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 150000,
    'Chat history is too large',
  );
