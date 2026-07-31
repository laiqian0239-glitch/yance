'use strict';

const { authorizeHeaders } = require('../security/apiSessionAuth');

function isLoopback(value) {
  const ip = String(value || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function createR32LocalApiSecurity(options = {}) {
  const port = process.env.YANCE_PORT || process.env.PORT || 27632;
  const allowedOrigins = new Set((options.allowedOrigins || [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`
  ]).map(value => String(value).replace(/\/$/, '')));
  const maxJsonBytes = Math.max(64 * 1024, Number(options.maxJsonBytes || 2 * 1024 * 1024));
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const maxRequests = Math.max(30, Number(options.maxRequests || 900));
  const readMaxRequests = Math.max(maxRequests, Number(options.readMaxRequests || maxRequests));
  const buckets = new Map();

  return function r32LocalApiSecurity(req, res, next) {
    if (!String(req.path || req.url || '').startsWith('/api/')) return next();

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');

    const remote = req.socket?.remoteAddress || req.ip || '';
    const localRequest = isLoopback(remote);
    if (!localRequest && process.env.WORKBUDDY_ALLOW_REMOTE !== '1') {
      return res.status(403).json({ ok: false, reasonCode: 'LOCAL_API_ONLY', code: 'LOCAL_API_ONLY', error: 'Local API only' });
    }

    const now = Date.now();
    const requestClass = /^(GET|HEAD)$/i.test(String(req.method || 'GET')) ? 'read' : 'write';
    const requestLimit = requestClass === 'read' ? readMaxRequests : maxRequests;
    const key = `${String(remote || 'unknown')}:${requestClass}`;
    const bucket = buckets.get(key) || { start: now, count: 0 };
    if (now - bucket.start >= windowMs) { bucket.start = now; bucket.count = 0; }
    bucket.count += 1;
    buckets.set(key, bucket);
    const retryAfterMs = Math.max(1000, windowMs - (now - bucket.start));
    res.setHeader('X-RateLimit-Limit', String(requestLimit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, requestLimit - bucket.count)));
    if (bucket.count > requestLimit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({ ok: false, reasonCode: 'RATE_LIMITED', code: 'RATE_LIMITED', error: 'Too many requests', retryAfterMs, requestClass });
    }

    const origin = String(req.headers.origin || '').replace(/\/$/, '');
    let sameHostRemoteOrigin = false;
    if (origin && process.env.WORKBUDDY_ALLOW_REMOTE === '1') {
      try { sameHostRemoteOrigin = new URL(origin).host === String(req.headers.host || ''); } catch (_) {}
    }
    if (origin && !allowedOrigins.has(origin) && !sameHostRemoteOrigin) {
      return res.status(403).json({ ok: false, reasonCode: 'ORIGIN_REJECTED', code: 'ORIGIN_REJECTED', error: 'Origin is not allowed' });
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json') && contentLength > maxJsonBytes) {
      return res.status(413).json({ ok: false, reasonCode: 'JSON_BODY_TOO_LARGE', code: 'JSON_BODY_TOO_LARGE', error: `JSON body exceeds ${maxJsonBytes} bytes` });
    }

    const requestPath = String(req.path || req.url || '').split('?')[0];
    const tokenExempt = req.method === 'GET' && requestPath === '/api/health';
    if (!tokenExempt && !authorizeHeaders(req.headers || {})) {
      return res.status(401).json({ ok: false, reasonCode: 'API_SESSION_UNAUTHORIZED', code: 'API_SESSION_UNAUTHORIZED', error: 'Valid local application session is required' });
    }
    if (!tokenExempt) res.setHeader('X-Yance-Api-Session-Auth', 'apiSessionAuth');

    next();
  };
}

module.exports = { createR32LocalApiSecurity, isLoopback };
