import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestAgentAccess } from './guest.mjs';
afterEach(() => vi.unstubAllEnvs());
const request = (address = '127.0.0.1', host = 'localhost:8080', snapshot = []) => ({
  socket: { remoteAddress: address },
  headers: { host },
  body: { snapshot },
});
const response = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
describe('guest AI stays separate from cloud authorization', () => {
  it('allows a validated snapshot only on the local development server', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const req = request();
    const next = vi.fn();
    guestAgentAccess(req, response(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.guestSnapshot).toEqual([]);
  });
  it('rejects production, remote clients and non-local hostnames', () => {
    for (const [env, req] of [
      ['production', request()],
      ['development', request('10.0.0.2')],
      ['development', request('127.0.0.1', 'public.example')],
    ]) {
      vi.stubEnv('NODE_ENV', env);
      const res = response();
      const next = vi.fn();
      guestAgentAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
  it('rejects invalid guest task data', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = response();
    guestAgentAccess(request('127.0.0.1', 'localhost', [{}]), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
