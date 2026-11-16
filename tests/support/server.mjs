import { createMemoryStore } from './memory.mjs';
import express from 'express';
import { dataRouter } from '../../server/data.mjs';
// Test-only identities and storage. This server is never imported by production code.
const app = express();
app.use(express.json({ limit: '900kb' }));
const users = new Map();
export const tokenFor = (uid) =>
  `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: 'demo-taskflow', iss: 'https://securetoken.google.com/demo-taskflow', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, email: `${uid}@example.test`, firebase: { sign_in_provider: 'password' } })).toString('base64url')}.test`;
const services = {
  verify: async (token) => {
    for (const uid of ['alice', 'bob']) if (token === tokenFor(uid)) return { uid };
    // Tokens generated a few seconds earlier remain valid in this isolated fixture.
    const [, payload, suffix] = token.split('.');
    const data = JSON.parse(Buffer.from(payload || '', 'base64url').toString());
    if (suffix !== 'test' || !['alice', 'bob'].includes(data.sub)) throw new Error('Invalid test token');
    return { uid: data.sub };
  },
  ...createMemoryStore(users),
};
app.get('/api/config', (_req, res) =>
  res.json({
    firebase: {
      apiKey: 'test-api-key',
      authDomain: 'localhost',
      projectId: 'demo-taskflow',
      appId: 'test-app',
    },
  }),
);
app.post('/__test/reset', (_req, res) => {
  users.clear();
  res.json({ ok: true });
});
app.use('/api', dataRouter(services));
app.post('/api/agent/step', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const messages = _req.body.messages;
  if (!messages.some((m) => m.role === 'tool'))
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-test', function: { name: 'create_task', arguments: JSON.stringify({ title: 'Copilot test task' }) } }] } }] })}\n\n`,
    );
  else
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '**Saved** مهمة\n\n## Summary\n\n- One task\n\n1. Review\n\n| Task | Status |\n| --- | --- |\n| Test | To Do |\n\n[Project](https://example.com)\n\n```js\nconst ok = true;\n```\n\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))' } }] })}\n\n`,
    );
  res.end('data: [DONE]\n\n');
});
app.use(express.static('dist'));
app.get('*', (_req, res) => res.sendFile('index.html', { root: 'dist' }));
app.use((error, _req, res, _next) => {
  void _next;
  res
    .status(error.status || (error.name === 'ZodError' ? 400 : 500))
    .json({ error: error.status ? error.message : 'Invalid data' });
});
app.listen(4173, '127.0.0.1');
