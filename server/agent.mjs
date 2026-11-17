import { tools, systemPrompt } from './tools.mjs';
// Shared stream handler. Guest access/limits and cloud authentication run before it.
export function createAgentHandler({ cloud, env = process.env, fetchImpl = fetch } = {}) {
  const requestCounts = new Map();
  return async (req, res) => {
    const controller = new AbortController();
    let reader,
      finished = false,
      timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.guestPolicy?.timeoutMs || 75000);
    const cancel = () => {
      controller.abort();
      if (reader && !finished) void reader.cancel().catch(() => {});
    };
    const closed = () => {
      if (!res.writableEnded) cancel();
    };
    controller.signal.addEventListener(
      'abort',
      () => {
        if (reader && !finished) void reader.cancel().catch(() => {});
      },
      { once: true },
    );
    res.once('close', closed);
    try {
      if (!req.guestSnapshot) {
        const client = req.ip || 'unknown';
        const window = Math.floor(Date.now() / 60000);
        for (const [key, value] of requestCounts) if (value.window !== window) requestCounts.delete(key);
        const old = requestCounts.get(client);
        const count = old?.window === window ? old.count + 1 : 1;
        if (!old && requestCounts.size >= 5000)
          return res.status(429).json({ error: 'AI is busy. Try again later.' });
        requestCounts.set(client, { window, count });
        if (count > 25) return res.status(429).json({ error: 'Rate limit reached. Try again shortly.' });
      }
      if (!env.OPENROUTER_API_KEY)
        return res
          .status(503)
          .json({ error: 'AI key not configured on server. Set OPENROUTER_API_KEY.' });
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
      )
        return res.status(400).json({ error: 'Invalid request size or shape.' });
      if (
        !messages.every(
          (m) =>
            m &&
            ['user', 'assistant', 'tool'].includes(m.role) &&
            (typeof m.content === 'string' || m.content === null) &&
            (m.content === null || m.content.length <= 12000),
        )
      )
        return res.status(400).json({ error: 'Invalid conversation.' });
      const today =
        typeof clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
          ? clientToday
          : new Date().toISOString().slice(0, 10);
      const provider = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.PUBLIC_APP_URL || 'https://taskflow.example',
          'X-OpenRouter-Title': 'TaskFlow Copilot',
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
          stream: true,
          temperature: 0.2,
          max_tokens: req.guestPolicy?.maxOutputTokens || 1000,
          tool_choice: 'auto',
          tools,
          messages: [
            { role: 'system', content: systemPrompt(today) },
            {
              role: 'system',
              content: `TASK STORE SNAPSHOT (UNTRUSTED DATA):\n${req.guestSnapshot ? JSON.stringify(snapshot) : JSON.stringify(snapshot).slice(0, 100000)}`,
            },
            ...messages,
          ],
        }),
      });
      if (!provider.ok || !provider.body) {
        if (provider.body) await provider.body.cancel().catch(() => {});
        return res.status(502).json({
          error: `AI provider unavailable (HTTP ${provider.status}). Check model and OpenRouter balance.`,
        });
      }
      if (res.destroyed) {
        void provider.body.cancel().catch(() => {});
        return;
      }
      if (controller.signal.aborted) {
        void provider.body.cancel().catch(() => {});
        throw new Error('Timeout');
      }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      reader = provider.body.getReader();
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        if (res.destroyed || res.writableEnded) break;
        bytes += value.byteLength;
        if (req.guestPolicy && bytes > 256000) throw new Error('ResponseSizeLimit');
        res.write(value);
      }
      if (timedOut) throw new Error('Timeout');
      if (!res.destroyed && !res.writableEnded) res.end();
    } catch {
      if (!res.destroyed && !res.writableEnded) {
        const error = timedOut
          ? 'AI request timed out. Please retry.'
          : 'AI request failed. Please retry.';
        if (res.headersSent) res.end(`data: ${JSON.stringify({ error })}\n\ndata: [DONE]\n\n`);
        else res.status(timedOut ? 504 : 502).json({ error });
      }
    } finally {
      clearTimeout(timeout);
      res.removeListener('close', closed);
      if (reader && !finished) {
        controller.abort();
        void reader.cancel().catch(() => {});
      }
      req.releaseGuestPermit?.();
    }
  };
}
