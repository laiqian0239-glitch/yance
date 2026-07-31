'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const messageStore = require('../services/messageStore');
const { getAppRuntime } = require('../runtime/runtimeSingleton');
const mediaPipeline = require('../services/mediaPipeline');
const { CONFIG, PATHS } = require('../config');
const platformCapabilities = require('../services/platformCapabilities');
const performancePolicy = require('../services/performancePolicy');
const expressionLibrary = require('../services/expressionLibraryService');
const platformDrivers = require('../services/platformDriverRegistry');
const accountManager = require('../services/accountManager');
const platformCapabilityAuthority = require('../services/platformCapabilityAuthority');

const router = express.Router();
const coreRuntime = () => getAppRuntime();
async function execute(req, command, payload = {}) {
  const output = await coreRuntime().executeBusinessCommand({ command, payload, context: { actor: 'messages-route', correlationId: req.get('x-correlation-id') || '', remoteAddress: req.ip || req.socket?.remoteAddress || '' } });
  return output.result || {};
}
const INCOMING_MEDIA_ROOT = path.join(PATHS.tmp, 'incoming-media');
const WAIT_MS = Math.max(100, Math.min(15000, Number(process.env.YANCE_SEND_HTTP_WAIT_MS || 4500)));
const PLATFORMS = new Set(['whatsapp', 'telegram', 'facebook']);

function decodeHeader(value) { try { return decodeURIComponent(String(value || '')); } catch (_) { return String(value || ''); } }
function idempotencyKey(req) { return String(req.headers['idempotency-key'] || req.headers['x-yance-idempotency-key'] || req.body?.idempotencyKey || '').trim() || crypto.randomUUID(); }
function assertPlatform(value) { const platform = String(value || '').toLowerCase(); if (!PLATFORMS.has(platform)) throw Object.assign(new Error('不支持的平台'), { code: 'UNSUPPORTED_PLATFORM', status: 400 }); return platform; }
async function receiveMediaStream(req) {
  fs.mkdirSync(INCOMING_MEDIA_ROOT, { recursive: true });
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > CONFIG.mediaMaxBytes) throw Object.assign(new Error(`媒体超过大小限制（${Math.round(CONFIG.mediaMaxBytes / 1024 / 1024)}MB）`), { code: 'MEDIA_TOO_LARGE', status: 413 });
  const file = path.join(INCOMING_MEDIA_ROOT, `${Date.now()}-${process.pid}-${crypto.randomUUID()}.upload`); const hash = crypto.createHash('sha256'); let bytes = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > CONFIG.mediaMaxBytes) return callback(Object.assign(new Error(`媒体超过大小限制（${Math.round(CONFIG.mediaMaxBytes / 1024 / 1024)}MB）`), { code: 'MEDIA_TOO_LARGE', status: 413 })); hash.update(chunk); callback(null, chunk); } });
  try { await pipeline(req, limiter, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 })); if (!bytes) throw Object.assign(new Error('媒体内容为空'), { code: 'MEDIA_EMPTY', status: 400 }); return { file, bytes, sha256: hash.digest('hex') }; }
  catch (error) { try { fs.rmSync(file, { force: true }); } catch (_) {} throw error; }
}
function quotedFromBody(body = {}) {
  if (!body.quoted && !body.quotedMessageId) return undefined; if (body.quoted?.key) return body.quoted;
  return { key: { remoteJid: body.chatJid, id: body.quotedMessageId || body.quoted?.id, fromMe: Boolean(body.quotedFromMe ?? body.quoted?.fromMe), participant: body.quotedParticipant || body.quoted?.participant || undefined }, message: body.quotedMessage || body.quoted?.message || undefined };
}
function sendQueueResponse(res, output, extra = {}) { const queue = output?.queue || output, state = queue?.state || 'pending', status = state === 'failed' ? 502 : (state === 'sent' ? 200 : 202); return res.status(status).json({ ok: state !== 'failed', accepted: true, queued: state !== 'sent', state, queue, result: output?.result || null, error: output?.error || null, ...extra }); }

router.get('/capabilities', (req, res) => {
  const accountState = accountManager.list();
  res.json({
    ok: true,
    matrix: platformCapabilities.MATRIX,
    contracts: platformCapabilities.publicContracts(),
    authority: platformCapabilityAuthority.evaluate(accountState, {
      platform: req.query.platform,
      accountId: req.query.accountId
    })
  });
});
router.get('/conversations', (_req, res) => res.json({ ok: true, conversations: messageStore.listConversations() }));
router.get('/conversations/:id/messages/stream', async (req, res, next) => {
  try {
    const policy = performancePolicy.read();
    const result = messageStore.listMessagePage(req.params.id, req.query);
    res.status(200);
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-store, max-age=0');
    res.setHeader('x-content-type-options', 'nosniff');
    res.flushHeaders?.();
    const write = value => res.write(`${JSON.stringify(value)}\n`);
    write({ type: 'meta', ok: true, page: { ...result.page, streamed: true } });
    const chunkSize = policy.streamChunkSize;
    for (let index = 0; index < result.messages.length && !res.destroyed; index += chunkSize) {
      write({ type: 'messages', messages: result.messages.slice(index, index + chunkSize) });
      await new Promise(resolve => setImmediate(resolve));
    }
    if (!res.destroyed) { write({ type: 'end', count: result.messages.length }); res.end(); }
  } catch (error) { next(error); }
});
router.get('/conversations/:id/messages', (req, res) => {
  const result = messageStore.listMessagePage(req.params.id, req.query);
  res.json({ ok: true, ...result });
});
router.get('/expressions/recent', async (req, res, next) => { try { res.json({ ok: true, ...(await expressionLibrary.recent({ platform: req.query.platform, accountId: req.query.accountId, kind: req.query.kind, limit: req.query.limit })) }); } catch (error) { next(error); } });
router.post('/expressions/send', async (req, res, next) => {
  try {
    const platform = assertPlatform(req.body?.platform);
    const output = await execute(req, 'message.sendExpression', {
      platform,
      accountId: req.body?.accountId,
      sessionKey: req.body?.sessionKey,
      chatJid: req.body?.chatJid,
      kind: req.body?.kind,
      reference: req.body?.reference || req.body?.sendReference,
      caption: req.body?.caption,
      quoted: quotedFromBody(req.body),
      idempotencyKey: idempotencyKey(req)
    });
    res.status(200).json({ ok: true, accepted: true, queued: false, state: output.state || 'sent', result: output.result || null, localMessageId: output.localMessageId || '' });
  } catch (error) { next(error); }
});
router.get('/search', (req, res) => res.json({ ok: true, results: messageStore.search(req.query.q || '', { limit: Number(req.query.limit || 100) }) }));
router.post('/conversations/:id/read', async (req, res, next) => {
  try {
    const output = await execute(req, 'message.markRead', {
      conversationId: req.params.id,
      platform: req.body?.platform,
      accountId: req.body?.accountId,
      chatJid: req.body?.chatJid,
      messageKeys: req.body?.messageKeys || []
    });
    res.json({ ok: true, state: output.local || null, platform: output.platform || null, platformWarning: output.platformWarning || null });
  } catch (error) { next(error); }
});
router.get('/send-queue', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'message.queue.list', { state: req.query.state, limit: req.query.limit })) }); } catch (error) { next(error); } });
router.post('/send-queue/:id/retry', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'message.queue.retry', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/send-queue/:id/cancel', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'message.queue.cancel', { id: req.params.id })) }); } catch (error) { next(error); } });
router.post('/send-queue/:id/resolve-outcome', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'message.queue.resolveOutcome', { id: req.params.id, resolution: req.body?.resolution })) }); } catch (error) { next(error); } });

async function sendText(req, res, next) {
  try {
    const platform = assertPlatform(req.params.platform);
    const output = await execute(req, 'message.sendText', {
      platform, accountId: req.params.accountId, sessionKey: req.body?.sessionKey,
      chatJid: req.body?.chatJid, text: req.body?.text, quoted: quotedFromBody(req.body),
      idempotencyKey: idempotencyKey(req)
    });
    return sendQueueResponse(res, output);
  } catch (error) { next(error); }
}
async function sendMediaJson(req, res, next) {
  try {
    const platform = assertPlatform(req.params.platform);
    const buffer = Buffer.from(String(req.body?.base64 || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, ''), 'base64');
    mediaPipeline.verifyBuffer(buffer);
    const output = await execute(req, 'message.sendMedia', {
      platform, accountId: req.params.accountId, sessionKey: req.body?.sessionKey, chatJid: req.body?.chatJid,
      kind: req.body?.kind, buffer, mimeType: req.body?.mimeType, filename: req.body?.filename,
      caption: req.body?.caption, quoted: quotedFromBody(req.body), idempotencyKey: idempotencyKey(req)
    });
    return sendQueueResponse(res, output, { upload: output.upload });
  } catch (error) { next(error); }
}
async function sendMediaStream(req, res, next) {
  let upload = null;
  try {
    const platform = assertPlatform(req.params.platform);
    upload = await receiveMediaStream(req);
    const chatJid = decodeHeader(req.headers['x-yance-chat-jid']);
    const sessionKey = decodeHeader(req.headers['x-yance-session-key']);
    const kind = decodeHeader(req.headers['x-yance-media-kind']);
    const mimeType = decodeHeader(req.headers['x-yance-mime-type']) || req.headers['content-type'];
    const filename = decodeHeader(req.headers['x-yance-filename']);
    const caption = decodeHeader(req.headers['x-yance-caption']);
    const quotedMessageId = decodeHeader(req.headers['x-yance-quoted-message-id']);
    const quotedParticipant = decodeHeader(req.headers['x-yance-quoted-participant']);
    const output = await execute(req, 'message.sendMediaFile', {
      platform, accountId: req.params.accountId, sessionKey, chatJid, kind, filePath: upload.file,
      bytes: upload.bytes, sha256: upload.sha256, mimeType, filename, caption,
      quoted: quotedMessageId ? quotedFromBody({ chatJid, quotedMessageId, quotedFromMe: req.headers['x-yance-quoted-from-me'] === '1', quotedParticipant }) : undefined,
      idempotencyKey: idempotencyKey(req)
    });
    upload = null;
    return sendQueueResponse(res, output, { upload: output.upload });
  } catch (error) {
    if (upload?.file) { try { fs.rmSync(upload.file, { force: true }); } catch (_) {} }
    next(error);
  }
}

router.post('/:platform/:accountId/send-text', sendText);
router.post('/:platform/:accountId/send-media', sendMediaJson);
router.post('/:platform/:accountId/send-media-stream', sendMediaStream);
router.post('/:platform/:accountId/presence', async (req, res, next) => { try { const platform = assertPlatform(req.params.platform); res.json({ ok: true, ...(await execute(req, 'message.presence', { platform, accountId: req.params.accountId, chatJid: req.body?.chatJid, state: req.body?.state })) }); } catch (error) { next(error); } });
router.post('/:platform/:accountId/reaction', async (req, res, next) => { try { const platform = assertPlatform(req.params.platform); res.json({ ok: true, ...(await execute(req, 'message.sendReaction', { platform, accountId: req.params.accountId, chatJid: req.body?.chatJid, targetId: req.body?.targetId, emoji: req.body?.emoji, targetFromMe: req.body?.targetFromMe, participant: req.body?.participant })) }); } catch (error) { next(error); } });
router.post('/:platform/:accountId/revoke', async (req, res, next) => { try { const platform = assertPlatform(req.params.platform); res.json({ ok: true, ...(await execute(req, 'message.revoke', { platform, accountId: req.params.accountId, chatJid: req.body?.chatJid, targetId: req.body?.targetId, targetFromMe: req.body?.targetFromMe !== false, participant: req.body?.participant })) }); } catch (error) { next(error); } });

router.get('/whatsapp/status', async (req, res, next) => { try { const output = await execute(req, 'account.list'); res.json({ ok: true, accounts: (output.accounts || []).filter(row => row.platform === 'whatsapp') }); } catch (error) { next(error); } });
router.post('/whatsapp/:accountId/start', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.connect', { id: req.params.accountId })) }); } catch (error) { next(error); } });
router.post('/whatsapp/:accountId/restart', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, 'account.reconnect', { id: req.params.accountId })) }); } catch (error) { next(error); } });
router.post('/whatsapp/:accountId/stop', async (req, res, next) => { try { res.json({ ok: true, ...(await execute(req, req.body?.logout === true ? 'account.logout' : 'account.pause', { id: req.params.accountId })) }); } catch (error) { next(error); } });

router.post('/media/:accountId/:conversationId/:messageId/retry', async (req, res, next) => {
  try {
    const result = await platformDrivers.call('whatsapp', 'retryMedia', { accountId: req.params.accountId, conversationId: req.params.conversationId, messageId: req.params.messageId });
    res.status(result.ok === false ? 409 : 202).json({ ok: result.ok !== false, result });
  } catch (error) { next(error); }
});
router.get('/media/:accountId/:conversationId/:fileName', (req, res) => { const file = mediaPipeline.resolveFile(req.params.accountId, req.params.conversationId, req.params.fileName); if (!file) return res.status(404).json({ ok: false, error: 'MEDIA_NOT_FOUND' }); res.sendFile(file); });
module.exports = router;
