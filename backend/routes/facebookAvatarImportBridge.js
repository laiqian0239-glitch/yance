'use strict';

const express = require('express');
const { isLoopback } = require('../middleware/r32LocalApiSecurity');
const importer = require('../services/facebookBusinessSuiteAvatarImportService');

const router = express.Router();
const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 180;

function extensionGuard(req, res, next) {
  const remote = req.socket?.remoteAddress || req.ip || '';
  if (!isLoopback(remote)) return res.status(403).json({ ok: false, code: 'AVATAR_IMPORT_LOCAL_ONLY', message: '网页头像导入桥仅允许本机访问' });
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const extensionHeader = String(req.headers['x-yance-extension-id'] || '');
  const preflight = String(req.method || '').toUpperCase() === 'OPTIONS';
  if (origin !== importer.EXTENSION_ORIGIN || (!preflight && extensionHeader !== importer.EXTENSION_ID)) {
    return res.status(403).json({ ok: false, code: 'AVATAR_IMPORT_EXTENSION_REJECTED', message: '仅允许言策官方浏览器扩展访问' });
  }
  const now = Date.now();
  const key = String(remote || 'loopback');
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start >= WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > MAX_REQUESTS) return res.status(429).json({ ok: false, code: 'AVATAR_IMPORT_RATE_LIMITED', message: '导入请求过于频繁，请稍后重试' });
  res.setHeader('Access-Control-Allow-Origin', importer.EXTENSION_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-yance-extension-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.options('*', extensionGuard, (_req, res) => res.status(204).end());
router.use(extensionGuard);
router.use(express.json({ limit: '48mb' }));

router.get('/status', (req, res, next) => {
  try {
    const session = importer.activeForExtension(req.query.sessionId || '');
    res.json({ ok: true, session: importer.statusForAccount(session.accountId) });
  } catch (error) { next(error); }
});

router.post('/preview', (req, res, next) => {
  try { res.json({ ok: true, ...importer.preview(req.body?.sessionId, req.body?.contacts) }); }
  catch (error) { next(error); }
});

router.post('/import', async (req, res, next) => {
  try { res.json({ ok: true, ...(await importer.import(req.body?.sessionId, req.body?.entries)) }); }
  catch (error) { next(error); }
});

router.use((error, _req, res, _next) => {
  res.status(Number(error?.status || 400)).json({
    ok: false,
    code: String(error?.code || 'AVATAR_IMPORT_BRIDGE_FAILED'),
    message: String(error?.message || '网页头像导入失败')
  });
});

module.exports = router;
