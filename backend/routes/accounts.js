'use strict';

const express = require('express');
const { getAppRuntime } = require('../runtime/runtimeSingleton');
const facebookChatwootMatrixBridge = require('../services/facebookChatwootMatrixBridge');

const router = express.Router();
const runtime = () => getAppRuntime();

function context(req) {
  return {
    actor: 'accounts-route',
    correlationId: req.get('x-correlation-id') || '',
    remoteAddress: req.ip || req.socket?.remoteAddress || ''
  };
}

async function execute(req, command, payload = {}) {
  const output = await runtime().executeBusinessCommand({ command, payload, context: context(req) });
  return output.result || {};
}

function quotedFromBody(body = {}) {
  if (body.quoted?.key) return body.quoted;
  const id = String(body.quotedMessageId || body.quoted?.id || '').trim();
  if (!id) return undefined;
  return {
    key: {
      remoteJid: String(body.chatJid || body.recipientId || body.quoted?.remoteJid || '').trim(),
      id,
      fromMe: body.quotedFromMe === true || body.quoted?.fromMe === true,
      participant: String(body.quotedParticipant || body.quoted?.participant || '').trim() || undefined
    },
    message: body.quotedMessage || body.quoted?.message || undefined
  };
}

router.get('/', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.list')) }); } catch (error) { next(error); } });
router.get('/audit', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.audit', { limit: req.query.limit })) }); } catch (error) { next(error); } });
router.get('/capabilities', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.capabilities')) }); } catch (error) { next(error); } });
router.post('/migration/scan', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.migration.scan', req.body || {})) }); } catch (error) { next(error); } });
router.post('/migration/import', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.migration.import', req.body || {})) }); } catch (error) { next(error); } });

router.post('/', async (req, res, next) => { try { res.status(201).json({ ok: true, ...(await execute(req, 'account.create', req.body || {})) }); } catch (error) { next(error); } });
router.patch('/:id', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.update', { id: req.params.id, patch: req.body || {} })) }); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.body?.confirm !== req.params.id) return res.status(400).json({ ok: false, error: 'CONFIRM_ACCOUNT_ID_REQUIRED', message: '删除账号前需要确认账号ID' });
    res.json({ ok: true, ...(await execute(req, 'account.remove', { id: req.params.id, clearCredentials: req.body?.clearCredentials === true, logout: req.body?.logout === true })) });
  } catch (error) { next(error); }
});
router.post('/:id/default', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.setDefault', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/connect', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.connect', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/authorization/discard-pending', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.authorization.discardPending', { id: req.params.id, reason: req.body?.reason })) }); } catch (error) { next(error); } });
router.post('/:id/reconnect', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.reconnect', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/actions/sync-all', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.syncAll')) }); } catch (error) { next(error); } });
router.post('/:id/sync', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.sync', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/actions/reconnect-all', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.reconnectAll')) }); } catch (error) { next(error); } });
router.post('/:id/pause', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.pause', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/resume', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.resume', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/logout', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.logout', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/diagnose', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.diagnose', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/bind-conversation', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.bindConversation', { id: req.params.id, ...(req.body || {}) })) }); } catch (error) { next(error); } });
router.get('/:id/runtime', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.getRuntime', { id: req.params.id })) }); } catch (error) { next(error); } });
router.get('/:id/auth-challenge', async (req, res, next) => { try { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...(await execute(req, 'account.getAuthChallenge', { id: req.params.id })) }); } catch (error) { next(error); } });
router.get('/:id/credential-state', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.getCredentialState', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/avatar-load-failure', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.avatarLoadFailure', { id: req.params.id, ...(req.body || {}) })) }); } catch (error) { next(error); } });

router.post('/:id/telegram/qr/start', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.telegram.qr.start', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/telegram/phone/start', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.telegram.phone.start', { id: req.params.id, phoneNumber: req.body?.phoneNumber })) }); } catch (error) { next(error); } });
router.post('/:id/telegram/cancel', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.telegram.cancel', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/telegram/code', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.telegram.code', { id: req.params.id, code: req.body?.code })) }); } catch (error) { next(error); } });
router.post('/:id/telegram/password', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.telegram.password', { id: req.params.id, password: req.body?.password })) }); } catch (error) { next(error); } });

router.post('/:id/facebook/oauth/start', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.oauth.start', { id: req.params.id })) }); } catch (error) { next(error); } });
router.get('/:id/facebook/oauth/status', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.oauth.status', { id: req.params.id, flowId: req.query.flowId })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/oauth/select-page', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.oauth.selectPage', { id: req.params.id, flowId: req.body?.flowId, pageId: req.body?.pageId })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/oauth/cancel', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.oauth.cancel', { id: req.params.id, flowId: req.body?.flowId })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/messenger/start', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.messenger.start', { id: req.params.id, username: req.body?.username })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/messenger/input', async (req, res, next) => { try { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...(await execute(req, 'account.facebook.messenger.input', { id: req.params.id, loginProcessId: req.body?.loginProcessId, stepId: req.body?.stepId, txnId: req.body?.txnId, input: req.body?.input || {} })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/messenger/wait', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.messenger.wait', { id: req.params.id, loginProcessId: req.body?.loginProcessId, stepId: req.body?.stepId, txnId: req.body?.txnId })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/messenger/cancel', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.messenger.cancel', { id: req.params.id, loginProcessId: req.body?.loginProcessId })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/avatar-closure/diagnose', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.avatarClosure.diagnose', { id: req.params.id, limit: req.body?.limit })) }); } catch (error) { next(error); } });
router.get('/:id/facebook/avatar-import/session', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.avatarImport.status', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/avatar-import/session', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.avatarImport.start', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/:id/facebook/avatar-import/session/stop', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.facebook.avatarImport.stop', { id: req.params.id })) }); } catch (error) { next(error); } });

router.get('/facebook/webhook', (_req, res) => {
  res.status(405).json({
    ok: false,
    error: 'FACEBOOK_PAGE_WEBHOOK_OWNED_BY_CHATWOOT',
    message: 'Facebook Page webhook is delivered by Chatwoot as a signed account webhook.'
  });
});
router.post('/facebook/webhook', async (req, res, next) => {
  try {
    const result = await facebookChatwootMatrixBridge.handleSignedWebhook({
      rawBody: req.rawBody,
      signature: req.get('x-chatwoot-signature'),
      timestamp: req.get('x-chatwoot-timestamp')
    });
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

router.post('/:id/send-text', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await execute(req, 'message.sendText', {
      accountId: req.params.id,
      conversationId: req.body?.conversationId,
      recipientId: req.body?.recipientId,
      text: req.body?.text,
      quoted: quotedFromBody(req.body || {}),
      idempotencyKey: req.get('idempotency-key') || req.body?.idempotencyKey || ''
    })) });
  } catch (error) { next(error); }
});

module.exports = router;
