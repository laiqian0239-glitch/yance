'use strict';

const express = require('express');
const { getAppRuntime } = require('../runtime/runtimeSingleton');

const router = express.Router();

function requestContext(req) {
  return {
    actor: 'desktop-renderer',
    correlationId: req.get('x-correlation-id') || '',
    remoteAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.get('user-agent') || ''
  };
}

router.get('/snapshot', (_req, res) => {
  res.json({ ok: true, ...getAppRuntime().snapshot() });
});

router.post('/command', async (req, res, next) => {
  try {
    const output = await getAppRuntime().executeBusinessCommand({
      command: req.body?.command,
      payload: req.body?.payload || {},
      context: { ...requestContext(req), ...(req.body?.context || {}) }
    });
    res.json(output);
  } catch (error) { next(error); }
});

module.exports = router;
