import { spawn } from 'node:child_process';
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    key.startsWith('FIREBASE_') ||
    key.startsWith('FIRESTORE_') ||
    key.startsWith('GUEST_AI_') ||
    key === 'GOOGLE_APPLICATION_CREDENTIALS'
  )
    delete env[key];
Object.assign(env, {
  NODE_ENV: 'production',
  PORT: '18190',
  GUEST_AI_ENABLED: 'true',
  PUBLIC_APP_URL: 'http://127.0.0.1:18190',
  OPENROUTER_API_KEY: 'test-production-key',
  TASKFLOW_TEST_PROVIDER: 'true',
});
const child = spawn(
  process.execPath,
  ['--import', './tests/support/openrouter-stub.mjs', 'server/index.mjs'],
  { env, stdio: 'inherit', windowsHide: true },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', (code) => process.exit(code || 0));
