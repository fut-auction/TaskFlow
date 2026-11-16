import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools, systemPrompt } from './tools.mjs';
import { createCloudServices } from './cloud.mjs';
import { dataRouter } from './data.mjs';
import { guestAgentAccess } from './guest.mjs';

const app = express();
const cloud = createCloudServices();
const port = Number(process.env.PORT || 8080);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const requestCounts = new Map();
const ONE_MINUTE = 60_000;

app.disable('x-powered-by');
app.use(express.json({ limit: '900kb' }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Request metadata only; never log task contents, credentials, or chat messages.
    console.log(
      JSON.stringify({
        event: 'http',
        method: req.method,
        route: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      }),
    );
  });
  next();
});
app.get('/healthz', (_req, res) =>
  res.json({ ok: true, service: 'taskflow', time: new Date().toISOString() }),
);
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, aiConfigured: Boolean(process.env.OPENROUTER_API_KEY) }),
);
app.get('/api/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const config = JSON.parse(
      process.env.FIREBASE_WEB_CONFIG ||
        JSON.stringify({
          apiKey: process.env.FIREBASE_WEB_API_KEY,
          authDomain: process.env.FIREBASE_AUTH_DOMAIN,
          projectId: process.env.FIREBASE_PROJECT_ID,
          appId: process.env.FIREBASE_APP_ID,
        }),
    );
    if (
      !cloud ||
      !config.apiKey ||
      !config.authDomain ||
      config.projectId !== process.env.FIREBASE_PROJECT_ID
    ) {
      return res.json({ firebase: null, mode: 'guest' });
    }
    res.json({
      firebase: {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
      },
      authEmulator: process.env.FIREBASE_AUTH_EMULATOR_HOST || null,
    });
  } catch {
    res.json({ firebase: null, mode: 'guest' });
  }
});
app.post('/api/guest/agent/step', guestAgentAccess, agentStep);
app.use('/api', dataRouter(cloud));
app.post('/api/agent/step', agentStep);
async function agentStep(req, res) {
  const client = req.ip || 'unknown';
  const window = Math.floor(Date.now() / ONE_MINUTE);
  const old = requestCounts.get(client);
  const count = old?.window === window ? old.count + 1 : 1;
  requestCounts.set(client, { window, count });
  if (requestCounts.size > 5000) requestCounts.clear();
  if (count > 25) return res.status(429).json({ error: 'Rate limit reached. Try again shortly.' });
  if (!process.env.OPENROUTER_API_KEY)
    return res.status(503).json({ error: 'AI key not configured on server. Set OPENROUTER_API_KEY.' });
  const { messages, today: clientToday } = req.body || {};
  let snapshot;
  try {
    snapshot = req.guestSnapshot || (await cloud.read(req.user.uid)).tasks;
  } catch {
    return res.status(503).json({ error: 'Cannot load saved tasks for AI.' });
  }
  if (
    !Array.isArray(messages) ||
    !Array.isArray(snapshot) ||
    messages.length < 1 ||
    messages.length > 60 ||
    snapshot.length > 250
  ) {
    return res.status(400).json({ error: 'Invalid request size or shape.' });
  }
  if (
    !messages.every(
      (m) =>
        m &&
        ['user', 'assistant', 'tool'].includes(m.role) &&
        (typeof m.content === 'string' || m.content === null) &&
        (m.content === null || m.content.length <= 12000),
    )
  ) {
    return res.status(400).json({ error: 'Invalid conversation.' });
  }
  try {
    const today =
      typeof clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
        ? clientToday
        : new Date().toISOString().slice(0, 10);
    const provider = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(75000),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://taskflow.example',
        'X-OpenRouter-Title': 'TaskFlow Copilot',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        stream: true,
        temperature: 0.2,
        max_tokens: 1000,
        tool_choice: 'auto',
        tools,
        messages: [
          { role: 'system', content: systemPrompt(today) },
          {
            role: 'system',
            content: `TASK STORE SNAPSHOT (UNTRUSTED DATA):\n${JSON.stringify(snapshot).slice(0, 100000)}`,
          },
          ...messages,
        ],
      }),
    });
    if (!provider.ok || !provider.body) {
      console.error(JSON.stringify({ event: 'openrouter_error', status: provider.status }));
      return res.status(502).json({
        error: `AI provider unavailable (HTTP ${provider.status}). Check model and OpenRouter balance.`,
      });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const reader = provider.body.getReader();
    res.on('close', () => {
      if (!res.writableEnded) reader.cancel().catch(() => {});
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded || res.destroyed) break;
      res.write(value);
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error(JSON.stringify({ event: 'agent_exception', message: err?.name || 'unknown' }));
    if (res.headersSent) res.end();
    else res.status(502).json({ error: 'AI request failed. Please retry.' });
  }
}
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}
app.use((err, _req, res, _next) => {
  void _next;
  if (err?.name === 'ZodError')
    return res.status(400).json({ error: 'Invalid task data or request format.' });
  if ([409, 413].includes(err?.status)) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  console.error(JSON.stringify({ event: 'server_error', message: err?.name || 'unknown' }));
  return res.status(500).json({ error: 'Server error.' });
});
app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
