import { tasksSchema } from './schema.mjs';
export function guestAgentAccess(req, res, next) {
  const address = req.socket.remoteAddress;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  let localHost = false;
  try {
    localHost = ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(`http://${req.headers.host}`).hostname,
    );
  } catch {
    /* Invalid hosts are rejected. */
  }
  if (process.env.NODE_ENV === 'production' || !loopback || !localHost)
    return res.status(403).json({
      error: 'Guest AI is available only on the local development server. Cloud AI requires sign-in.',
    });
  try {
    req.guestSnapshot = tasksSchema.parse(req.body?.snapshot);
  } catch {
    return res.status(400).json({ error: 'Invalid guest task snapshot.' });
  }
  next();
}
