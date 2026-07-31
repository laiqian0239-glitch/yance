'use strict';

const express = require('express');
const { getAppRuntime } = require('../runtime/runtimeSingleton');
const { normalizeRuntimeError } = require('../runtime/errors');

function contractVersion(req) { return Number(req.headers['x-yance-contract-version']); }
function sendError(res, error) {
  const normalized = normalizeRuntimeError(error);
  return res.status(normalized.status || 500).json({
    ok: false,
    reasonCode: normalized.reasonCode,
    code: normalized.reasonCode,
    message: normalized.message,
    ...(normalized.details ? { details: normalized.details } : {})
  });
}

function createApiV2Router(options = {}) {
  const router = express.Router();
  const runtimeProvider = options.runtimeProvider || getAppRuntime;
  router.use((req, res, next) => {
    if (contractVersion(req) !== 2 || (req.body && Object.prototype.hasOwnProperty.call(req.body, 'contractVersion') && req.body.contractVersion !== 2)) {
      return sendError(res, Object.assign(new Error('API contract version 2 is required'), { reasonCode: 'API_CONTRACT_MISMATCH', status: 426 }));
    }
    next();
  });
  router.get('/snapshot', (_req, res) => {
    try { res.json(runtimeProvider().snapshot()); } catch (error) { sendError(res, error); }
  });
  router.post('/commands', async (req, res) => {
    try { res.json(await runtimeProvider().executeCommand(req.body)); } catch (error) { sendError(res, error); }
  });
  router.get('/events', (req, res) => {
    try { res.json(runtimeProvider().events(req.query.afterSequence, req.query.limit)); } catch (error) { sendError(res, error); }
  });
  router.post('/wp7/event-gap', (req, res) => {
    try { res.json({ ok: true, ...runtimeProvider().injectWp7ProbeEventGap(req.body?.afterSequence) }); } catch (error) { sendError(res, error); }
  });
  return router;
}

module.exports = { createApiV2Router, sendError };
