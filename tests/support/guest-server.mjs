import { spawn } from 'node:child_process';
// Run the real backend without reading .env or using any real cloud/API credentials.
const env = { ...process.env, NODE_ENV: 'development', PORT: '18188', OPENROUTER_API_KEY: '' };
for (const key of Object.keys(env))
  if (key.startsWith('FIREBASE_') || key.startsWith('GUEST_AI_') || key === 'FIRESTORE_EMULATOR_HOST')
    delete env[key];
const child = spawn(process.execPath, ['server/index.mjs'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', (code) => process.exit(code || 0));
