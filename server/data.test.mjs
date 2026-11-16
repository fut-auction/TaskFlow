import { createMemoryStore } from '../tests/support/memory.mjs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { dataRouter } from './data.mjs';
const stores = new Map();
const services = {
  verify: async (token) => {
    if (!['alice', 'bob'].includes(token)) throw new Error('Invalid');
    return { uid: token };
  },
  ...createMemoryStore(stores),
};
const app = express();
app.use(express.json());
app.use('/api', dataRouter(services));
app.use((error, _req, res, _next) => {
  void _next;
  res.status(error.status || 400).json({ error: 'Rejected' });
});
let server;
let base;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
const request = (path, token, method = 'GET', body) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
describe('backend authorization and atomic data API', () => {
  it('rejects missing and invalid authentication', async () => {
    expect((await request('/tasks')).status).toBe(401);
    expect((await request('/tasks', 'invalid')).status).toBe(401);
    expect((await request('/agent/step', '', 'POST', {})).status).toBe(401);
  });
  it('uses verified identity, rejects UID injection, stale writes and weak deletion confirmation', async () => {
    expect(
      (await request('/tasks', 'alice', 'PUT', { tasks: [], revision: 0, uid: 'bob' })).status,
    ).toBe(400);
    expect((await request('/tasks', 'alice', 'PUT', { tasks: [], revision: 0 })).status).toBe(200);
    expect((await request('/tasks', 'alice', 'PUT', { tasks: [], revision: 0 })).status).toBe(409);
    expect(
      (await request('/data', 'alice', 'DELETE', { confirmation: 'delete', revision: 1 })).status,
    ).toBe(400);
    expect(
      (await request('/data', 'alice', 'DELETE', { confirmation: 'DELETE', revision: 1 })).status,
    ).toBe(200);
    expect(await (await request('/tasks', 'bob')).json()).toEqual({ tasks: [], revision: 0, epoch: 0 });
  });
  it('rejects malformed task input before writing', async () => {
    expect(
      (await request('/tasks', 'alice', 'PUT', { revision: 2, tasks: [{ id: '../bob', title: 'bad' }] }))
        .status,
    ).toBe(400);
    expect((await services.read('alice')).revision).toBe(2);
  });
});

describe('private chat and deletion epochs', () => {
  it('saves chat only for the caller and prevents stale chat restoration after clear', async () => {
    const chat = {
      feed: [{ who: 'user', text: 'Private conversation' }],
      history: [{ role: 'user', content: 'Private conversation' }],
    };
    expect((await request('/chat', 'alice', 'PUT', { chat, epoch: 1, chatRevision: 0 })).status).toBe(
      200,
    );
    expect((await (await request('/chat', 'alice')).json()).feed).toHaveLength(1);
    expect((await (await request('/chat', 'bob')).json()).feed).toEqual([]);
    expect((await request('/chat', 'alice', 'PUT', { chat, epoch: 1, chatRevision: 0 })).status).toBe(
      409,
    );
    expect(
      (await request('/data', 'alice', 'DELETE', { revision: 2, confirmation: 'DELETE' })).status,
    ).toBe(200);
    expect((await (await request('/chat', 'alice')).json()).feed).toEqual([]);
    expect((await request('/chat', 'alice', 'PUT', { chat, epoch: 1, chatRevision: 1 })).status).toBe(
      409,
    );
  });
});
