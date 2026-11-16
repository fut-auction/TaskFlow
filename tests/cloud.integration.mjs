import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCloudServices } from '../server/cloud.mjs';
import { dataRouter } from '../server/data.mjs';
import { deleteApp, getApps } from 'firebase-admin/app';
const projectId = process.env.FIREBASE_PROJECT_ID;
if (
  !projectId?.startsWith('demo-') ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:') ||
  !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')
)
  throw new Error(
    'This destructive test only runs with localhost Auth/Firestore emulators and a demo- project.',
  );
test('real emulator tokens, persistence, user isolation, conflicts and clear', async () => {
  const cloud = createCloudServices();
  const app = express();
  app.use(express.json());
  app.use('/api', dataRouter(cloud));
  app.use((e, _req, res, _next) => {
    void _next;
    res.status(e.status || 400).json({ error: 'Rejected' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const signup = async (name) => {
      const response = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `${name}-${Date.now()}@example.test`,
            password: 'test-password',
            returnSecureToken: true,
          }),
        },
      );
      assert.equal(response.status, 200);
      return response.json();
    };
    const a = await signup('alice');
    const b = await signup('bob');
    const url = `http://127.0.0.1:${server.address().port}/api`;
    const call = (path, token, method = 'GET', body) =>
      fetch(url + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    const task = {
      id: 'real-test',
      title: 'Emulator task',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      tags: [],
      notes: [],
      checklist: [],
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    assert.equal((await call('/tasks', 'invalid')).status, 401);
    assert.equal((await call('/tasks', a.idToken, 'PUT', { revision: 0, tasks: [task] })).status, 200);
    assert.deepEqual((await cloud.read(a.localId)).tasks, [task]);
    await cloud.writeChat(
      a.localId,
      {
        feed: [{ who: 'user', text: 'Private chat' }],
        history: [{ role: 'user', content: 'Private chat' }],
      },
      0,
      0,
    );
    assert.equal((await cloud.readChat(a.localId)).feed.length, 1);
    assert.equal((await cloud.readChat(b.localId)).feed.length, 0);
    assert.deepEqual((await (await call('/tasks', b.idToken)).json()).tasks, []);
    const results = await Promise.all([
      call('/tasks', a.idToken, 'PUT', { revision: 1, tasks: [task] }),
      call('/tasks', a.idToken, 'PUT', { revision: 1, tasks: [task] }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await call('/data', a.idToken, 'DELETE', { revision: 2, confirmation: 'no' })).status,
      400,
    );
    assert.equal(
      (await call('/data', a.idToken, 'DELETE', { revision: 2, confirmation: 'DELETE' })).status,
      200,
    );
    assert.deepEqual((await cloud.read(a.localId)).tasks, []);
    assert.equal((await cloud.readChat(a.localId)).feed.length, 0);
    await assert.rejects(() => cloud.writeChat(a.localId, { feed: [], history: [] }, 0, 1), {
      status: 409,
    });
    assert.equal((await cloud.read(b.localId)).revision, 0);
  } finally {
    await new Promise((r) => server.close(r));
    await Promise.all(getApps().map(deleteApp));
  }
});
