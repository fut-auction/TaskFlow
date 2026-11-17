import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { tasksSchema } from './schema.mjs';

const message = z
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
            function: z.object({ name: z.string().max(100), arguments: z.string().max(12000) }).strict(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict();
const requestSchema = z
  .object({
    snapshot: tasksSchema,
    messages: z.array(message).min(1).max(60),
    today: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
const localNames = new Set(['localhost', '127.0.0.1', '[::1]']);
function origin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && localNames.has(url.hostname)))
  )
    throw new Error('Use HTTPS origins (HTTP is allowed only for localhost tests).');
  return url.origin;
}
function integer(env, name, fallback, min, max) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}; expected ${min}–${max}.`);
  return value;
}
function settings(env) {
  return {
    clientMinute: integer(env, 'GUEST_AI_REQUESTS_PER_MINUTE', 20, 1, 60),
    instanceMinute: integer(env, 'GUEST_AI_INSTANCE_REQUESTS_PER_MINUTE', 60, 1, 600),
    instanceHour: integer(env, 'GUEST_AI_INSTANCE_REQUESTS_PER_HOUR', 120, 1, 6000),
    instanceDay: integer(env, 'GUEST_AI_INSTANCE_REQUESTS_PER_DAY', 300, 1, 10000),
    concurrency: integer(env, 'GUEST_AI_MAX_CONCURRENT', 2, 1, 8),
    maxInputBytes: integer(env, 'GUEST_AI_MAX_INPUT_BYTES', 96000, 1000, 128000),
    maxOutputTokens: integer(env, 'GUEST_AI_MAX_OUTPUT_TOKENS', 1000, 128, 1000),
    timeoutMs: integer(env, 'GUEST_AI_TIMEOUT_MS', 30000, 1000, 45000),
    proxyHops: integer(env, 'GUEST_AI_TRUST_PROXY_HOPS', 0, 0, 3),
  };
}

// In-memory fixed windows: one set per process, not a distributed/global quota.
export function createGuestBudget(config, now = Date.now) {
  const clients = new Map();
  const totals = new Map();
  let active = 0;
  return (client) => {
    const time = now();
    const minute = Math.floor(time / 60000);
    for (const [key, value] of clients)
      if (value.minute !== minute && value.active === 0) clients.delete(key);
    const existing = clients.get(client);
    if (!existing && clients.size >= 5000)
      return { retryAfter: 60, error: 'Guest AI is busy. Please try later.' };
    const entry = existing || { minute, count: 0, active: 0 };
    if (entry.minute !== minute) {
      entry.minute = minute;
      entry.count = 0;
    }
    if (entry.active >= 1 || active >= config.concurrency)
      return { retryAfter: 5, error: 'Guest AI is busy. Wait for the current request to finish.' };
    const windows = [
      [60000, config.instanceMinute],
      [3600000, config.instanceHour],
      [86400000, config.instanceDay],
    ];
    const retry = Math.max(
      0,
      ...windows.map(([period, limit]) => {
        const value = totals.get(period);
        return value?.window === Math.floor(time / period) && value.count >= limit
          ? Math.ceil((period - (time % period)) / 1000)
          : 0;
      }),
      entry.count >= config.clientMinute ? Math.ceil((60000 - (time % 60000)) / 1000) : 0,
    );
    if (retry) return { retryAfter: retry, error: 'Guest AI usage limit reached. Please try later.' };
    for (const [period] of windows) {
      const window = Math.floor(time / period);
      const previous = totals.get(period);
      totals.set(period, { window, count: previous?.window === window ? previous.count + 1 : 1 });
    }
    entry.count++;
    entry.active++;
    active++;
    clients.set(client, entry);
    let released = false;
    return {
      release: () => {
        if (!released) {
          released = true;
          entry.active--;
          active--;
        }
      },
    };
  };
}
function clientAddress(req, hops) {
  const socket = req.socket.remoteAddress || 'unknown';
  if (!hops) return socket;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((v) => v.trim());
  // Explicit deployment trust setting: never use the untrusted leftmost entry blindly.
  return forwarded.length >= hops && forwarded.every((value) => isIP(value))
    ? forwarded.at(-hops)
    : socket;
}
export function createGuestAgentAccess({ env = process.env, now = Date.now } = {}) {
  let config, configError, allowedOrigins;
  try {
    config = settings(env);
    allowedOrigins = new Set(
      [env.PUBLIC_APP_URL, ...(env.GUEST_AI_ALLOWED_ORIGINS || '').split(',')]
        .filter(Boolean)
        .map((value) => origin(value.trim())),
    );
  } catch (error) {
    configError = error.message;
  }
  const admit = config && createGuestBudget(config, now);
  const salt = randomBytes(16);
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const production = env.NODE_ENV === 'production';
    const enabled = env.GUEST_AI_ENABLED === 'true';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    let localHost = false;
    try {
      localHost = localNames.has(new URL(`http://${req.headers.host}`).hostname);
    } catch {
      /* Deny malformed hosts. */
    }
    if (env.GUEST_AI_ENABLED === 'false' || (!enabled && (production || !local || !localHost)))
      return res.status(403).json({ error: 'Guest AI is not enabled on this server.' });
    if (configError || (production && !allowedOrigins?.size))
      return res.status(503).json({
        error: configError || 'Guest AI needs a configured PUBLIC_APP_URL or GUEST_AI_ALLOWED_ORIGINS.',
      });
    const supplied = req.headers.origin;
    let allowed = false;
    try {
      allowed =
        supplied &&
        (allowedOrigins.has(origin(supplied)) ||
          (!production && local && localHost && localNames.has(new URL(supplied).hostname)));
    } catch {
      /* Deny invalid origins. */
    }
    if (
      (supplied && !allowed) ||
      (production && !allowed) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: 'Guest AI request origin is not allowed.' });
    let parsed;
    try {
      parsed = requestSchema.parse(req.body);
      if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > config.maxInputBytes)
        return res
          .status(413)
          .json({ error: 'Guest AI input is too large. Shorten the chat or task data.' });
    } catch {
      return res.status(400).json({ error: 'Invalid guest AI request. Check messages and task data.' });
    }
    if (!env.OPENROUTER_API_KEY)
      return res.status(503).json({ error: 'AI key not configured on server. Set OPENROUTER_API_KEY.' });
    const client = createHash('sha256')
      .update(salt)
      .update(clientAddress(req, config.proxyHops))
      .digest('hex');
    const permit = admit(client);
    if (!permit.release) {
      res.setHeader('Retry-After', String(permit.retryAfter));
      return res.status(429).json({ error: permit.error });
    }
    req.guestSnapshot = parsed.snapshot;
    req.body = parsed;
    req.guestPolicy = config;
    req.releaseGuestPermit = permit.release;
    next();
  };
}
