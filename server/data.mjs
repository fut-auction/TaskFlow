import express from 'express';
import { z } from 'zod';
import { tasksSchema, validateSize, chatSchema } from './schema.mjs';

export function dataRouter(services) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!services)
      return res.status(503).json({ error: 'Cloud storage is not configured. See README.' });
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Sign in to continue.' });
    try {
      req.user = await services.verify(match[1]);
      next();
    } catch {
      res.status(401).json({ error: 'Session expired. Sign in again.' });
    }
  });
  router.get('/tasks', async (req, res, next) => {
    try {
      res.json(await services.read(req.user.uid));
    } catch (error) {
      next(error);
    }
  });
  router.put('/tasks', async (req, res, next) => {
    try {
      const { tasks, revision } = z
        .object({ tasks: tasksSchema, revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      validateSize(tasks);
      res.json(await services.write(req.user.uid, tasks, revision));
    } catch (error) {
      next(error);
    }
  });
  router.delete('/data', async (req, res, next) => {
    try {
      const { revision } = z
        .object({ confirmation: z.literal('DELETE'), revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      res.json(await services.clear(req.user.uid, revision));
    } catch (error) {
      next(error);
    }
  });

  router.get('/chat', async (req, res, next) => {
    try {
      res.json(await services.readChat(req.user.uid));
    } catch (error) {
      next(error);
    }
  });
  router.put('/chat', async (req, res, next) => {
    try {
      const { chat, epoch, chatRevision } = z
        .object({
          chat: chatSchema,
          epoch: z.number().int().nonnegative(),
          chatRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
      res.json(await services.writeChat(req.user.uid, chat, epoch, chatRevision));
    } catch (error) {
      next(error);
    }
  });
  // Authentication also protects /agent/step; no client-supplied UID is used.
  return router;
}
