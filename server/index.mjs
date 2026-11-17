import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentHandler } from './agent.mjs';
import { createCloudServices } from './cloud.mjs';
import { dataRouter } from './data.mjs';
import { createGuestAgentAccess } from './guest.mjs';

const app = express();
const cloud = createCloudServices();
const port = Number(process.env.PORT || 8080);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const agentStep = createAgentHandler({ cloud });

app.disable('x-powered-by');
app.use('/api/guest/agent/step', express.json({ limit: '128kb' }));
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
app.post('/api/guest/agent/step', createGuestAgentAccess(), agentStep);
app.use('/api', dataRouter(cloud));
app.post('/api/agent/step', agentStep);
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
