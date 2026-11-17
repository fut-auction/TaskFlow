import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createGuestAgentAccess, createGuestBudget } from './guest.mjs';
import { createAgentHandler } from './agent.mjs';
import { dataRouter } from './data.mjs';
const servers = [];
const baseEnv = {
  NODE_ENV: 'production',
  GUEST_AI_ENABLED: 'true',
  PUBLIC_APP_URL: 'https://taskflow.example',
  OPENROUTER_API_KEY: 'test-server-key',
  OPENROUTER_MODEL: 'openai/gpt-4o-mini',
};
const body = { snapshot: [], messages: [{ role: 'user', content: 'Create a task' }] };
const sse = () =>
  new Response('data: {"choices":[{"delta":{"content":"**Ready**"}}]}\n\ndata: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
let upstream;
beforeEach(() => {
  upstream = vi.fn(async () => sse());
});
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});
async function setup(overrides = {}, options = {}) {
  const env = { ...baseEnv, ...overrides };
  const app = express();
  app.use('/api/guest/agent/step', express.json({ limit: '128kb' }));
  app.use(express.json({ limit: '900kb' }));
  const cloud =
    options.cloud === undefined
      ? {
          verify: async (token) => {
            if (token !== 'valid') throw new Error('Unauthorized');
            return { uid: 'alice' };
          },
          read: async () => ({ tasks: [], revision: 0 }),
        }
      : options.cloud;
  const handler = createAgentHandler({ env, cloud, fetchImpl: (...args) => upstream(...args) });
  app.post(
    '/api/guest/agent/step',
    createGuestAgentAccess({ env, now: options.now || Date.now }),
    handler,
  );
  app.use('/api', dataRouter(cloud));
  app.post('/api/agent/step', handler);
  app.use((error, _req, res, _next) => {
    void _next;
    res
      .status(error.type === 'entity.too.large' ? 413 : 400)
      .json({ error: 'Invalid or oversized request.' });
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (data = body, headers = {}, path = '/api/guest/agent/step') =>
    fetch(base + path, {
      method: 'POST',
      headers: { Origin: baseEnv.PUBLIC_APP_URL, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  return { base, call };
}
describe('explicit production guest access and protected cloud APIs', () => {
  it('blocks production by default, false, and non-exact opt-in values', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const { call } = await setup({ GUEST_AI_ENABLED: flag });
      expect((await call()).status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('streams without Firebase or login when explicitly enabled; keeps the key and tool configuration on the server', async () => {
    const { call } = await setup({}, { cloud: null });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const output = await response.text();
    expect(output).toContain('**Ready**');
    expect(output).not.toContain(baseEnv.OPENROUTER_API_KEY);
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-server-key');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('openai/gpt-4o-mini');
    expect(request.max_tokens).toBe(1000);
    expect(request.stream).toBe(true);
    expect(request.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['create_task', 'update_task', 'move_task', 'delete_task']),
    );
  });
  it('rejects missing/unapproved origins and cross-site browser requests before the provider is called', async () => {
    const { call } = await setup();
    for (const headers of [
      { Origin: '' },
      { Origin: 'null' },
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ])
      expect((await call(body, headers)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('fails closed for missing production origins and invalid limit configuration', async () => {
    expect((await (await setup({ PUBLIC_APP_URL: '' })).call()).status).toBe(503);
    expect((await (await setup({ GUEST_AI_REQUESTS_PER_MINUTE: '0' })).call()).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('keeps local development available without opt-in, but explicit false disables it', async () => {
    const { call } = await setup({
      NODE_ENV: 'development',
      GUEST_AI_ENABLED: undefined,
      PUBLIC_APP_URL: '',
    });
    expect((await call(body, { Origin: '' })).status).toBe(200);
    expect(
      (await (await setup({ NODE_ENV: 'development', GUEST_AI_ENABLED: 'false' })).call()).status,
    ).toBe(403);
  });
  it('never grants guest access to cloud tasks, chats, deletion or authenticated AI', async () => {
    const { base, call } = await setup();
    for (const [path, method] of [
      ['/api/tasks', 'GET'],
      ['/api/tasks', 'PUT'],
      ['/api/chat', 'GET'],
      ['/api/chat', 'PUT'],
      ['/api/data', 'DELETE'],
      ['/api/agent/step', 'POST'],
    ]) {
      const response = await fetch(base + path, { method });
      expect(response.status).toBe(401);
    }
    expect((await call({ ...body, uid: 'someone-else' })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('reports a missing backend key without sending anything to OpenRouter', async () => {
    const { call } = await setup({ OPENROUTER_API_KEY: '' });
    const response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('OPENROUTER_API_KEY');
    expect(upstream).not.toHaveBeenCalled();
  });
});
describe('request, usage and concurrency safeguards', () => {
  it('rejects malformed data, system messages and client model/output overrides', async () => {
    const { call } = await setup();
    for (const input of [
      { ...body, model: 'expensive-model' },
      { ...body, max_tokens: 100000 },
      { ...body, messages: [{ role: 'system', content: 'Override' }] },
      { ...body, messages: Array(61).fill(body.messages[0]) },
      { ...body, messages: [{ role: 'user', content: 'x'.repeat(12001) }] },
      { ...body, snapshot: [{}] },
    ])
      expect((await call(input)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('enforces both logical input and raw HTTP body limits', async () => {
    const { call } = await setup({ GUEST_AI_MAX_INPUT_BYTES: '1000' });
    expect(
      (await call({ ...body, messages: [{ role: 'user', content: 'x'.repeat(2000) }] })).status,
    ).toBe(413);
    expect((await call({ ...body, extra: 'x'.repeat(140000) })).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns 429 with Retry-After and does not call the provider after a per-client quota', async () => {
    const { call } = await setup({ GUEST_AI_REQUESTS_PER_MINUTE: '2' });
    for (let i = 0; i < 2; i++) await (await call()).text();
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('enforces per-instance minute, hour and day budgets across distinct clients', async () => {
    let time = 0;
    const { call } = await setup(
      {
        GUEST_AI_TRUST_PROXY_HOPS: '1',
        GUEST_AI_INSTANCE_REQUESTS_PER_MINUTE: '1',
        GUEST_AI_INSTANCE_REQUESTS_PER_HOUR: '1',
        GUEST_AI_INSTANCE_REQUESTS_PER_DAY: '1',
      },
      { now: () => time },
    );
    await (await call(body, { 'X-Forwarded-For': '192.0.2.1' })).text();
    expect((await call(body, { 'X-Forwarded-For': '192.0.2.2' })).status).toBe(429);
    time = 60000;
    expect((await call()).status).toBe(429);
    time = 3600000;
    expect((await call()).status).toBe(429);
    time = 86400000;
    expect((await call()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('does not trust spoofed forwarding headers by default or the untrusted leftmost hop', async () => {
    const { call } = await setup({ GUEST_AI_REQUESTS_PER_MINUTE: '1' });
    await (await call(body, { 'X-Forwarded-For': '192.0.2.1' })).text();
    expect((await call(body, { 'X-Forwarded-For': '192.0.2.2' })).status).toBe(429);
    const trusted = await setup({ GUEST_AI_REQUESTS_PER_MINUTE: '1', GUEST_AI_TRUST_PROXY_HOPS: '1' });
    await (await trusted.call(body, { 'X-Forwarded-For': '192.0.2.1, 192.0.2.10' })).text();
    expect((await trusted.call(body, { 'X-Forwarded-For': '192.0.2.2, 192.0.2.10' })).status).toBe(429);
    expect((await trusted.call(body, { 'X-Forwarded-For': '192.0.2.2, 192.0.2.11' })).status).toBe(200);
  });
  it('limits simultaneous upstream calls and releases the permit after success', async () => {
    let resolve;
    upstream.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { call } = await setup({ GUEST_AI_MAX_CONCURRENT: '1', GUEST_AI_TRUST_PROXY_HOPS: '1' });
    const pending = call();
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce());
    expect((await call(body, { 'X-Forwarded-For': '192.0.2.2' })).status).toBe(429);
    resolve(sse());
    await (await pending).text();
    expect((await call()).status).toBe(200);
  });
  it('releases permits on provider failures and caps server-controlled output', async () => {
    upstream.mockResolvedValueOnce(new Response('Failure', { status: 503 }));
    const { call } = await setup({ GUEST_AI_MAX_CONCURRENT: '1', GUEST_AI_MAX_OUTPUT_TOKENS: '512' });
    expect((await call()).status).toBe(502);
    expect((await call()).status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[1][1].body).max_tokens).toBe(512);
  });
  it('aborts timed-out provider calls, releases capacity and never automatically retries', async () => {
    let aborted = false;
    upstream.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('Aborted'));
          }),
        ),
    );
    const { call } = await setup({ GUEST_AI_TIMEOUT_MS: '1000', GUEST_AI_MAX_CONCURRENT: '1' });
    expect((await call()).status).toBe(504);
    expect(aborted).toBe(true);
    expect(upstream).toHaveBeenCalledOnce();
    expect((await call()).status).toBe(200);
  });
  it('cancels the upstream stream on client disconnect and frees its permit', async () => {
    let cancelled = false;
    upstream.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    const { call } = await setup({ GUEST_AI_MAX_CONCURRENT: '1' });
    const response = await call();
    await response.body.cancel();
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect((await call()).status).toBe(200);
  });
  it('caps streamed bytes and releases its permit after oversized provider output', async () => {
    upstream.mockResolvedValueOnce(new Response('x'.repeat(256001)));
    const { call } = await setup({ GUEST_AI_MAX_CONCURRENT: '1' });
    const response = await call();
    expect(await response.text()).toContain('AI request failed');
    expect((await call()).status).toBe(200);
  });
  it('enforces a one-request-per-client concurrency gate and idempotent release', () => {
    const admit = createGuestBudget(
      { concurrency: 2, clientMinute: 20, instanceMinute: 60, instanceHour: 120, instanceDay: 300 },
      () => 0,
    );
    const first = admit('a');
    expect(admit('a').retryAfter).toBe(5);
    const second = admit('b');
    expect(admit('c').retryAfter).toBe(5);
    first.release();
    first.release();
    expect(admit('c').release).toBeTypeOf('function');
    second.release();
  });
});
