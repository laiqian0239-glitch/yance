'use strict';

const express = require('express');
const conversations = require('../repositories/conversationQueryRepository');
const messageStore = require('../services/messageStore');
const { getAppRuntime } = require('../runtime/runtimeSingleton');

function createR32ConversationRouter(options = {}) {
  const router = express.Router();
  const repository = options.repository || conversations;
  const coreRuntime = options.appRuntime || options.coreRuntime || getAppRuntime();

  router.get('/api/conversations', (req, res, next) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
      res.json({ ok: true, source: 'sqlite-r32', conversations: repository.list(limit) });
    } catch (error) { next(error); }
  });

  router.get('/api/conversations/:sessionKey/messages', (req, res, next) => {
    try {
      const sessionKey = String(req.params.sessionKey || '').trim();
      if (!sessionKey) return res.status(400).json({ ok: false, code: 'SESSION_KEY_REQUIRED', error: 'sessionKey is required' });
      const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 2000)));
      res.json({ ok: true, source: 'sqlite-r32', sessionKey, messages: messageStore.listMessages(sessionKey, { limit, before: req.query.before }) });
    } catch (error) { next(error); }
  });

  router.post('/api/conversations/:sessionKey/read', async (req, res, next) => {
    try {
      const output = await coreRuntime.executeBusinessCommand({
        command: 'message.markRead',
        payload: { conversationId: req.params.sessionKey, ...(req.body || {}) },
        context: { actor: 'legacy-read-route', correlationId: req.headers['x-correlation-id'] || '' }
      });
      res.json({ ok: true, ...(output.result || {}) });
    } catch (error) { next(error); }
  });

  router.get('/api/messages/search', (req, res, next) => {
    try {
      const query = String(req.query.q || '').trim();
      if (!query) return res.json({ ok: true, source: 'sqlite-r32', query: '', messages: [] });
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
      res.json({ ok: true, source: 'sqlite-r32', query, messages: repository.search(query, { limit }) });
    } catch (error) { next(error); }
  });

  router.get('/api/r32/storage/status', (_req, res, next) => {
    try {
      const status = repository.storageStatus();
      res.json({ ok: true, ...status });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createR32ConversationRouter };
