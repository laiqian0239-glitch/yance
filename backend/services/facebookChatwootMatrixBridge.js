'use strict';

const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');

const RUNTIME = 'chatwoot-facebook-page';
const BINDING_EVENT_TYPE = 'com.yance.multibridge.binding';
const BINDING_STATE_KEY = 'facebook_ads';
const WEBHOOK_FRESHNESS_MS = 300000;
const CHATWOOT_SIGNATURE_HEADER = 'X-Chatwoot-Signature';
const CHATWOOT_TIMESTAMP_HEADER = 'X-Chatwoot-Timestamp';
const syncTokens = Object.create(null);
const runtimeStates = Object.create(null);
const bindingGates = Object.create(null);

function clean(value, fallback = '') {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || fallback;
}
function fail(code, message, status = 409, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}
function stripTrailingSlash(value) { return clean(value).replace(/\/+$/u, ''); }
function assertActive(signal, code = 'FACEBOOK_CHATWOOT_OPERATION_ABORTED') {
  if (!signal?.aborted) return;
  const reason = signal.reason instanceof Error ? signal.reason : fail(code, 'Facebook Page Chatwoot operation aborted', 499);
  if (!reason.code) reason.code = code;
  throw reason;
}
function requirePersistedAttempt(input = {}) {
  const attempt = input?.physicalAttemptContext;
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt) || !Object.isFrozen(attempt)) {
    throw fail('FACEBOOK_CHATWOOT_PERSISTED_ATTEMPT_REQUIRED', 'Facebook Page Chatwoot physical egress requires the frozen persisted WP-B attempt before any network call', 409);
  }
  for (const field of ['executionId', 'intentId', 'attemptId', 'claimId', 'ownerId', 'idempotencyKey', 'requestContentSha256']) {
    if (!clean(attempt[field])) {
      throw fail('FACEBOOK_CHATWOOT_PERSISTED_ATTEMPT_REQUIRED', 'Facebook Page Chatwoot persisted attempt identity is incomplete', 409, { field });
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(clean(attempt.requestContentSha256))) {
    throw fail('FACEBOOK_CHATWOOT_PERSISTED_ATTEMPT_REQUIRED', 'Facebook Page Chatwoot persisted request fingerprint is invalid', 409, { field: 'requestContentSha256' });
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const value = Number(attempt[field]);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw fail('FACEBOOK_CHATWOOT_PERSISTED_ATTEMPT_REQUIRED', 'Facebook Page Chatwoot persisted fencing identity is invalid', 409, { field });
    }
  }
  return attempt;
}

function runtimeConfig() {
  return {
    chatwootBaseUrl: stripTrailingSlash(process.env.CHATWOOT_BASE_URL),
    chatwootAccountId: clean(process.env.CHATWOOT_ACCOUNT_ID),
    chatwootApiAccessToken: clean(process.env.CHATWOOT_API_ACCESS_TOKEN),
    chatwootWebhookSecret: clean(process.env.CHATWOOT_WEBHOOK_SECRET),
    matrixBaseUrl: stripTrailingSlash(process.env.MATRIX_BASE_URL),
    matrixAccessToken: clean(process.env.MATRIX_ACCESS_TOKEN),
    matrixInviteUser: clean(process.env.MATRIX_INVITE_USER)
  };
}
function enabled() {
  const config = runtimeConfig();
  return Boolean(config.chatwootBaseUrl && config.chatwootAccountId && config.chatwootApiAccessToken && config.chatwootWebhookSecret && config.matrixBaseUrl && config.matrixAccessToken);
}
function requireRuntimeConfig({ webhook = false } = {}) {
  const config = runtimeConfig();
  const required = {
    CHATWOOT_BASE_URL: config.chatwootBaseUrl,
    CHATWOOT_ACCOUNT_ID: config.chatwootAccountId,
    CHATWOOT_API_ACCESS_TOKEN: config.chatwootApiAccessToken,
    MATRIX_BASE_URL: config.matrixBaseUrl,
    MATRIX_ACCESS_TOKEN: config.matrixAccessToken,
    ...(webhook ? { CHATWOOT_WEBHOOK_SECRET: config.chatwootWebhookSecret } : {})
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw fail('FACEBOOK_CHATWOOT_RUNTIME_NOT_CONFIGURED', `Facebook Page Chatwoot runtime is missing required configuration: ${missing.join(', ')}`, 503, { missing });
  return config;
}

async function fetchResponse(url, options = {}, operation = {}) {
  assertActive(operation.signal);
  const response = await fetch(url, { ...options, signal: operation.signal || options.signal });
  assertActive(operation.signal);
  return response;
}
async function responseError(response, fallbackCode) {
  const text = await response.text().catch(() => '');
  let message = clean(text);
  try {
    const parsed = text ? JSON.parse(text) : {};
    message = clean(parsed?.message || parsed?.error, message);
  } catch (_) {}
  return fail(fallbackCode, message || `Upstream returned HTTP ${response.status}`, response.status, { upstreamStatus: response.status });
}
async function jsonResponse(response, fallbackCode) {
  if (!response.ok) throw await responseError(response, fallbackCode);
  return response.json().catch(() => ({}));
}
async function binaryResponse(response, fallbackCode) {
  if (!response.ok) throw await responseError(response, fallbackCode);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: clean(response.headers.get('content-type'), 'application/octet-stream')
  };
}
function chatwootPath(config, relativePath) { return `${config.chatwootBaseUrl}${relativePath}`; }
function matrixPath(config, relativePath) { return `${config.matrixBaseUrl}${relativePath}`; }
async function chatwootJson(config, relativePath, options = {}, operation = {}) {
  const response = await fetchResponse(chatwootPath(config, relativePath), {
    ...options,
    headers: { accept: 'application/json', api_access_token: config.chatwootApiAccessToken, ...(options.headers || {}) }
  }, operation);
  return jsonResponse(response, 'FACEBOOK_CHATWOOT_UPSTREAM_ERROR');
}
async function matrixJson(config, relativePath, options = {}, operation = {}) {
  const response = await fetchResponse(matrixPath(config, relativePath), {
    ...options,
    headers: { accept: 'application/json', authorization: `Bearer ${config.matrixAccessToken}`, ...(options.headers || {}) }
  }, operation);
  return jsonResponse(response, 'FACEBOOK_CHATWOOT_MATRIX_ERROR');
}
async function matrixBinary(config, relativePath, operation = {}) {
  const response = await fetchResponse(matrixPath(config, relativePath), {
    headers: { authorization: `Bearer ${config.matrixAccessToken}` }
  }, operation);
  return binaryResponse(response, 'FACEBOOK_CHATWOOT_MATRIX_MEDIA_ERROR');
}
async function remoteBinary(url, operation = {}) {
  const response = await fetchResponse(url, {}, operation);
  return binaryResponse(response, 'FACEBOOK_CHATWOOT_MEDIA_FETCH_ERROR');
}

function listPayload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.payload)) return value.payload;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
async function listFacebookInboxes(config, operation = {}) {
  const data = await chatwootJson(config, `/api/v1/accounts/${encodeURIComponent(config.chatwootAccountId)}/inboxes`, {}, operation);
  return listPayload(data).filter(row => clean(row?.channel_type) === 'Channel::FacebookPage' && clean(row?.page_id));
}
function pageIdForAccount(account = {}) {
  const metadataPageId = clean(account?.metadata?.pageId || account?.pageId || account?.metadata?.facebookPageId);
  if (metadataPageId) return metadataPageId;
  for (const candidate of [account?.adapterAccountId, account?.id]) {
    const match = /^facebook_ads:(.+)$/iu.exec(clean(candidate));
    if (match?.[1]) return clean(match[1]);
  }
  return '';
}
function accountInstanceId(pageId) {
  const normalized = clean(pageId);
  if (!normalized) throw fail('FACEBOOK_CHATWOOT_PAGE_ID_REQUIRED', 'Facebook Page identity requires an exact Page ID');
  return `facebook_ads:${normalized}`;
}
async function resolveFacebookInbox(config, { inboxId = '', pageId = '' } = {}, operation = {}) {
  const normalizedInboxId = clean(inboxId);
  const normalizedPageId = clean(pageId);
  const matches = (await listFacebookInboxes(config, operation)).filter(row => {
    if (normalizedInboxId && clean(row.id) !== normalizedInboxId) return false;
    if (normalizedPageId && clean(row.page_id) !== normalizedPageId) return false;
    return true;
  });
  if (matches.length !== 1) throw fail('FACEBOOK_CHATWOOT_INBOX_IDENTITY_AMBIGUOUS', 'Facebook Page must resolve to exactly one Chatwoot Facebook inbox', 409, { inboxId: normalizedInboxId, pageId: normalizedPageId, matchCount: matches.length });
  return matches[0];
}

function rawBodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  throw fail('FACEBOOK_CHATWOOT_WEBHOOK_RAW_BODY_REQUIRED', 'Chatwoot webhook verification requires the exact raw request body', 400);
}
function verifySignedWebhook({ rawBody, signature, timestamp, nowMs = Date.now(), secret = '' } = {}) {
  const webhookSecret = clean(secret || runtimeConfig().chatwootWebhookSecret);
  if (!webhookSecret) throw fail('FACEBOOK_CHATWOOT_WEBHOOK_SECRET_MISSING', 'Chatwoot webhook secret is not configured', 503);
  const raw = rawBodyBuffer(rawBody);
  const timestampText = clean(timestamp);
  if (!/^\d{10,13}$/u.test(timestampText)) throw fail('FACEBOOK_CHATWOOT_WEBHOOK_TIMESTAMP_INVALID', `${CHATWOOT_TIMESTAMP_HEADER} is missing or invalid`, 401);
  const numericTimestamp = Number(timestampText);
  const timestampMs = timestampText.length <= 10 ? numericTimestamp * 1000 : numericTimestamp;
  if (!Number.isFinite(timestampMs) || Math.abs(Number(nowMs) - timestampMs) > WEBHOOK_FRESHNESS_MS) {
    throw fail('FACEBOOK_CHATWOOT_WEBHOOK_STALE', 'Chatwoot webhook timestamp is outside the 300-second freshness window', 401);
  }
  const received = clean(signature).toLowerCase();
  if (!/^sha256=[0-9a-f]{64}$/u.test(received)) throw fail('FACEBOOK_CHATWOOT_WEBHOOK_SIGNATURE_INVALID', `${CHATWOOT_SIGNATURE_HEADER} is missing or invalid`, 401);
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(`${timestampText}.${raw.toString('utf8')}`).digest('hex')}`;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) throw fail('FACEBOOK_CHATWOOT_WEBHOOK_SIGNATURE_INVALID', 'Chatwoot webhook signature verification failed', 401);
  return raw;
}

function bindingFromState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const binding = {
    runtime: clean(value.runtime), accountInstanceId: clean(value.accountInstanceId), pageId: clean(value.pageId),
    chatwootAccountId: clean(value.chatwootAccountId), chatwootInboxId: clean(value.chatwootInboxId),
    remoteConversationId: clean(value.remoteConversationId), matrixRoomId: clean(value.matrixRoomId)
  };
  if (binding.runtime !== RUNTIME || !binding.accountInstanceId || !binding.pageId || !binding.chatwootInboxId || !binding.remoteConversationId) return null;
  return binding;
}
async function getRoomBinding(config, roomId, operation = {}) {
  try {
    const relativePath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(BINDING_EVENT_TYPE)}/${encodeURIComponent(BINDING_STATE_KEY)}`;
    const data = await matrixJson(config, relativePath, {}, operation);
    return bindingFromState({ ...(data || {}), matrixRoomId: clean(data?.matrixRoomId || roomId) });
  } catch (error) {
    if (Number(error.status) === 404) return null;
    throw error;
  }
}
async function joinedRooms(config, operation = {}) {
  const data = await matrixJson(config, '/_matrix/client/v3/joined_rooms', {}, operation);
  return Array.isArray(data?.joined_rooms) ? data.joined_rooms.map(clean).filter(Boolean) : [];
}
async function findBindingByConversation(config, identity, conversationId, operation = {}) {
  const matches = [];
  for (const roomId of await joinedRooms(config, operation)) {
    assertActive(operation.signal);
    const binding = await getRoomBinding(config, roomId, operation);
    if (binding?.accountInstanceId === identity && binding.remoteConversationId === clean(conversationId)) matches.push({ ...binding, matrixRoomId: roomId });
  }
  if (matches.length > 1) throw fail('FACEBOOK_CHATWOOT_MATRIX_BINDING_AMBIGUOUS', 'One Chatwoot conversation resolved to multiple Matrix rooms', 409, { accountInstanceId: identity, conversationId: clean(conversationId), roomCount: matches.length });
  return matches[0] || null;
}
async function createBoundRoom(config, inbox, conversationId, label, operation = {}) {
  const pageId = clean(inbox.page_id);
  const identity = accountInstanceId(pageId);
  const data = await matrixJson(config, '/_matrix/client/v3/createRoom', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset: 'private_chat', is_direct: true, name: clean(label, `Facebook Page ${pageId}`), invite: config.matrixInviteUser ? [config.matrixInviteUser] : [] })
  }, operation);
  const roomId = clean(data?.room_id);
  if (!roomId) throw fail('FACEBOOK_CHATWOOT_MATRIX_ROOM_CREATE_FAILED', 'Matrix createRoom response did not include room_id', 502);
  const binding = { runtime: RUNTIME, accountInstanceId: identity, pageId, chatwootAccountId: config.chatwootAccountId, chatwootInboxId: clean(inbox.id), remoteConversationId: clean(conversationId), matrixRoomId: roomId };
  const statePath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(BINDING_EVENT_TYPE)}/${encodeURIComponent(BINDING_STATE_KEY)}`;
  await matrixJson(config, statePath, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(binding) }, operation);
  return binding;
}
async function ensureBinding(config, inbox, conversationId, label, operation = {}) {
  const identity = accountInstanceId(inbox.page_id);
  const key = `${identity}:${clean(conversationId)}`;
  if (bindingGates[key]) return bindingGates[key];
  const task = (async () => {
    const existing = await findBindingByConversation(config, identity, conversationId, operation);
    if (existing) {
      if (existing.chatwootInboxId !== clean(inbox.id)) throw fail('FACEBOOK_CHATWOOT_INBOX_BINDING_MISMATCH', 'Existing Matrix room is bound to another Chatwoot inbox', 409);
      return existing;
    }
    return createBoundRoom(config, inbox, conversationId, label, operation);
  })();
  bindingGates[key] = task;
  try { return await task; } finally { delete bindingGates[key]; }
}

async function sendMatrixMessage(config, roomId, content, operation = {}) {
  const relativePath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`chatwoot-${randomUUID()}`)}`;
  return matrixJson(config, relativePath, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(content) }, operation);
}
async function uploadMatrixMedia(config, bytes, filename, mimeType, operation = {}) {
  const query = filename ? `?filename=${encodeURIComponent(filename)}` : '';
  const response = await fetchResponse(matrixPath(config, `/_matrix/media/v3/upload${query}`), {
    method: 'POST',
    headers: { authorization: `Bearer ${config.matrixAccessToken}`, 'content-type': clean(mimeType, 'application/octet-stream') },
    body: bytes
  }, operation);
  const data = await jsonResponse(response, 'FACEBOOK_CHATWOOT_MATRIX_MEDIA_UPLOAD_FAILED');
  const contentUri = clean(data?.content_uri);
  if (!contentUri) throw fail('FACEBOOK_CHATWOOT_MATRIX_MEDIA_UPLOAD_FAILED', 'Matrix media upload response did not include content_uri', 502);
  return contentUri;
}
function matrixMsgType(fileType, mimeType) {
  const kind = clean(fileType).toLowerCase();
  const mime = clean(mimeType).toLowerCase();
  if (kind === 'image' || mime.startsWith('image/')) return 'm.image';
  if (kind === 'video' || mime.startsWith('video/')) return 'm.video';
  if (kind === 'audio' || mime.startsWith('audio/')) return 'm.audio';
  return 'm.file';
}
async function projectInboundAttachment(config, roomId, attachment, operation = {}) {
  const sourceUrl = clean(attachment?.data_url || attachment?.dataUrl || attachment?.download_url || attachment?.url);
  if (!sourceUrl) return null;
  const media = await remoteBinary(sourceUrl, operation);
  const mimeType = clean(attachment?.content_type || attachment?.contentType, media.mimeType);
  const filename = clean(attachment?.file_name || attachment?.filename || attachment?.extension, 'attachment');
  const contentUri = await uploadMatrixMedia(config, media.bytes, filename, mimeType, operation);
  await sendMatrixMessage(config, roomId, { msgtype: matrixMsgType(attachment?.file_type, mimeType), body: filename, url: contentUri, info: { mimetype: mimeType, size: media.bytes.length } }, operation);
  return contentUri;
}

function webhookInboxId(body = {}) { return clean(body?.inbox?.id || body?.conversation?.inbox_id || body?.conversation?.inbox?.id || body?.message?.inbox_id); }
function webhookConversationId(body = {}) { return clean(body?.conversation?.id || body?.conversation_id || body?.message?.conversation_id); }
function webhookLabel(body = {}) { return clean(body?.conversation?.meta?.sender?.name || body?.sender?.name || body?.contact?.name || body?.conversation?.display_id, 'Facebook Page conversation'); }
function incomingMessage(body = {}) {
  const value = body?.message_type ?? body?.message?.message_type;
  return value === 0 || clean(value).toLowerCase() === 'incoming';
}
async function handleWebhookBody(config, body, operation = {}) {
  const event = clean(body?.event).toLowerCase();
  if (!['message_created', 'message_updated'].includes(event)) return { handled: false, reason: 'event-not-owned' };
  const receivedAccountId = clean(body?.account?.id || body?.conversation?.account_id);
  if (receivedAccountId && receivedAccountId !== config.chatwootAccountId) throw fail('FACEBOOK_CHATWOOT_ACCOUNT_MISMATCH', 'Webhook belongs to another Chatwoot account', 409);
  const conversationId = webhookConversationId(body);
  const inboxId = webhookInboxId(body);
  if (!conversationId || !inboxId) throw fail('FACEBOOK_CHATWOOT_WEBHOOK_IDENTITY_MISSING', 'Chatwoot webhook is missing inbox or conversation identity', 400);
  const inbox = await resolveFacebookInbox(config, { inboxId }, operation);
  if (event === 'message_updated') return { handled: true, event, accountInstanceId: accountInstanceId(inbox.page_id), conversationId, projected: false };
  if (!incomingMessage(body)) return { handled: true, event, accountInstanceId: accountInstanceId(inbox.page_id), conversationId, projected: false, reason: 'outgoing-or-activity' };
  const binding = await ensureBinding(config, inbox, conversationId, webhookLabel(body), operation);
  const content = clean(body?.content || body?.message?.content);
  if (content) await sendMatrixMessage(config, binding.matrixRoomId, { msgtype: 'm.text', body: content }, operation);
  const attachments = Array.isArray(body?.attachments) ? body.attachments : Array.isArray(body?.message?.attachments) ? body.message.attachments : [];
  let mediaCount = 0;
  for (const attachment of attachments) {
    assertActive(operation.signal);
    if (await projectInboundAttachment(config, binding.matrixRoomId, attachment, operation)) mediaCount += 1;
  }
  return { handled: true, event, accountInstanceId: binding.accountInstanceId, conversationId, matrixRoomId: binding.matrixRoomId, projected: Boolean(content || mediaCount), mediaCount };
}
async function handleSignedWebhook({ rawBody, signature, timestamp, signal = null } = {}) {
  const config = requireRuntimeConfig({ webhook: true });
  const raw = verifySignedWebhook({ rawBody, signature, timestamp, secret: config.chatwootWebhookSecret });
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch (_) { throw fail('FACEBOOK_CHATWOOT_WEBHOOK_JSON_INVALID', 'Signed Chatwoot webhook body is not valid JSON', 400); }
  return handleWebhookBody(config, body, { signal });
}

async function chatwootSendText(config, conversationId, text, operation = {}) {
  const content = clean(text);
  if (!content) throw fail('FACEBOOK_CHATWOOT_MESSAGE_TEXT_REQUIRED', 'Facebook Page text message must not be empty', 400);
  const relativePath = `/api/v1/accounts/${encodeURIComponent(config.chatwootAccountId)}/conversations/${encodeURIComponent(conversationId)}/messages`;
  const data = await chatwootJson(config, relativePath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, message_type: 'outgoing', private: false }) }, operation);
  const messageId = clean(data?.id || data?.message?.id);
  return { ok: true, id: messageId, messageId, platformMessageId: messageId, conversationId: clean(conversationId) };
}
async function bytesForMedia(input = {}, operation = {}) {
  if (Buffer.isBuffer(input.buffer)) return { bytes: input.buffer, mimeType: clean(input.mimeType, 'application/octet-stream'), filename: clean(input.filename, 'attachment') };
  if (input.data instanceof Uint8Array) return { bytes: Buffer.from(input.data), mimeType: clean(input.mimeType, 'application/octet-stream'), filename: clean(input.filename, 'attachment') };
  const sourceUrl = clean(input.url || input.mediaUrl);
  if (!sourceUrl) throw fail('FACEBOOK_CHATWOOT_MEDIA_BYTES_REQUIRED', 'Chatwoot media send requires bytes or a fetchable media URL', 400);
  const media = await remoteBinary(sourceUrl, operation);
  return { bytes: media.bytes, mimeType: clean(input.mimeType, media.mimeType), filename: clean(input.filename, 'attachment') };
}
async function chatwootSendMedia(config, conversationId, input = {}, operation = {}) {
  const media = await bytesForMedia(input, operation);
  const relativePath = `/api/v1/accounts/${encodeURIComponent(config.chatwootAccountId)}/conversations/${encodeURIComponent(conversationId)}/messages`;
  const form = new FormData();
  form.append('message_type', 'outgoing');
  form.append('private', 'false');
  if (clean(input.caption || input.text)) form.append('content', clean(input.caption || input.text));
  form.append('attachments[]', new Blob([media.bytes], { type: media.mimeType }), media.filename);
  const data = await chatwootJson(config, relativePath, { method: 'POST', body: form }, operation);
  const messageId = clean(data?.id || data?.message?.id);
  return { ok: true, id: messageId, messageId, platformMessageId: messageId, conversationId: clean(conversationId) };
}
async function resolveConversationTarget(config, target, operation = {}) {
  const value = clean(target);
  const direct = /^chatwoot:(\d+)$/u.exec(value);
  if (direct) return { conversationId: direct[1], binding: null };
  if (value.startsWith('!')) {
    const binding = await getRoomBinding(config, value, operation);
    if (!binding) throw fail('FACEBOOK_CHATWOOT_MATRIX_BINDING_MISSING', 'Matrix room has no Facebook Page Chatwoot binding', 409);
    return { conversationId: binding.remoteConversationId, binding };
  }
  throw fail('FACEBOOK_PAGE_LEGACY_TARGET_RETIRED', 'Legacy Facebook recipient targets are retired; use a bound Matrix room or explicit chatwoot:<conversation-id> target', 409);
}
function mxcParts(value) {
  const match = /^mxc:\/\/([^/]+)\/(.+)$/u.exec(clean(value));
  return match ? { server: match[1], mediaId: match[2] } : null;
}
async function downloadMatrixMedia(config, mxc, operation = {}) {
  const parts = mxcParts(mxc);
  if (!parts) throw fail('FACEBOOK_CHATWOOT_MATRIX_MEDIA_URI_INVALID', 'Matrix media event has an invalid mxc URI', 400);
  return matrixBinary(config, `/_matrix/media/v3/download/${encodeURIComponent(parts.server)}/${encodeURIComponent(parts.mediaId)}`, operation);
}
async function processMatrixEvent(config, roomId, event, ownUserId, operation = {}) {
  if (!event || clean(event.sender) === ownUserId || clean(event.type) !== 'm.room.message') return { handled: false };
  const binding = await getRoomBinding(config, roomId, operation);
  if (!binding) return { handled: false };
  const content = event.content || {};
  const msgtype = clean(content.msgtype);
  if (msgtype === 'm.text' || msgtype === 'm.notice') {
    await chatwootSendText(config, binding.remoteConversationId, clean(content.body), operation);
    return { handled: true, conversationId: binding.remoteConversationId };
  }
  if (['m.image', 'm.video', 'm.audio', 'm.file'].includes(msgtype) && clean(content.url)) {
    const media = await downloadMatrixMedia(config, content.url, operation);
    await chatwootSendMedia(config, binding.remoteConversationId, { buffer: media.bytes, mimeType: clean(content?.info?.mimetype, media.mimeType), filename: clean(content.body, 'attachment') }, operation);
    return { handled: true, conversationId: binding.remoteConversationId };
  }
  return { handled: false };
}

function syncKey(account = {}) {
  const pageId = pageIdForAccount(account);
  return pageId ? accountInstanceId(pageId) : clean(account?.id || account?.adapterAccountId, 'facebook-page');
}
async function bootstrapSyncToken(config, key, operation = {}) {
  const data = await matrixJson(config, '/_matrix/client/v3/sync?timeout=0', {}, operation);
  const nextBatch = clean(data?.next_batch);
  if (!nextBatch) throw fail('FACEBOOK_CHATWOOT_MATRIX_SYNC_TOKEN_MISSING', 'Matrix sync did not return next_batch', 502);
  syncTokens[key] = nextBatch;
  return nextBatch;
}
async function sync(account = {}, options = {}) {
  const config = requireRuntimeConfig();
  assertActive(options.signal, 'FACEBOOK_CHATWOOT_SYNC_ABORTED');
  const key = syncKey(account);
  if (!syncTokens[key]) {
    const nextBatch = await bootstrapSyncToken(config, key, options);
    return { state: 'connected', bootstrapped: true, nextBatch, processed: 0, failures: [] };
  }
  const data = await matrixJson(config, `/_matrix/client/v3/sync?timeout=0&since=${encodeURIComponent(syncTokens[key])}`, {}, options);
  const whoami = await matrixJson(config, '/_matrix/client/v3/account/whoami', {}, options);
  const ownUserId = clean(whoami?.user_id);
  const joined = data?.rooms?.join && typeof data.rooms.join === 'object' ? data.rooms.join : {};
  let processed = 0;
  const failures = [];
  for (const [roomId, room] of Object.entries(joined)) {
    const events = Array.isArray(room?.timeline?.events) ? room.timeline.events : [];
    for (const event of events) {
      assertActive(options.signal, 'FACEBOOK_CHATWOOT_SYNC_ABORTED');
      try {
        if ((await processMatrixEvent(config, roomId, event, ownUserId, options)).handled) processed += 1;
      } catch (error) {
        failures.push({ roomId, eventId: clean(event?.event_id), code: clean(error?.code || error?.message, 'FACEBOOK_CHATWOOT_EVENT_FAILED') });
      }
    }
  }
  const nextBatch = clean(data?.next_batch);
  if (nextBatch) syncTokens[key] = nextBatch;
  return { state: 'connected', bootstrapped: false, nextBatch, processed, failures };
}
async function connect(account = {}, options = {}) {
  const config = requireRuntimeConfig();
  assertActive(options.signal, 'FACEBOOK_CHATWOOT_CONNECT_ABORTED');
  const pageId = pageIdForAccount(account);
  if (!pageId) throw fail('FACEBOOK_CHATWOOT_PAGE_ID_REQUIRED', 'Facebook Page account must carry its Page ID before Chatwoot connection');
  const inbox = await resolveFacebookInbox(config, { pageId }, options);
  const whoami = await matrixJson(config, '/_matrix/client/v3/account/whoami', {}, options);
  if (!clean(whoami?.user_id)) throw fail('FACEBOOK_CHATWOOT_MATRIX_IDENTITY_MISSING', 'Matrix whoami did not return a user_id', 502);
  const key = accountInstanceId(pageId);
  await bootstrapSyncToken(config, key, options);
  const state = { state: 'connected', connectedAt: new Date().toISOString(), lastError: '', page: { id: pageId, name: clean(inbox.name, 'Facebook Page') }, chatwootInboxId: clean(inbox.id), accountInstanceId: key, canSend: true, canReceive: true };
  runtimeStates[key] = state;
  return state;
}
async function disconnect(account = {}) {
  const key = syncKey(account);
  delete syncTokens[key];
  const state = { state: 'stopped', connectedAt: '', lastError: '', canSend: false, canReceive: false };
  runtimeStates[key] = state;
  return state;
}
function status(account = {}) {
  const key = syncKey(account);
  if (runtimeStates[key]) return { ...runtimeStates[key] };
  return enabled() ? { state: 'configured', connectedAt: '', lastError: '', canSend: false, canReceive: false } : { state: 'unconfigured', connectedAt: '', lastError: 'Chatwoot/Matrix runtime configuration is incomplete', canSend: false, canReceive: false };
}
function credentialState(account = {}) {
  const pageId = pageIdForAccount(account);
  const usable = enabled() && Boolean(pageId);
  return { usable, source: 'chatwoot-sidecar', pageId, accountInstanceId: pageId ? accountInstanceId(pageId) : '' };
}
function credentialReady(account = {}) { return credentialState(account).usable; }
function resolveAccountKey(account = {}) {
  const pageId = pageIdForAccount(account);
  return pageId ? accountInstanceId(pageId) : clean(account?.id || account?.adapterAccountId);
}
function externalTarget(value) { return clean(value).replace(/^facebook:/iu, ''); }
function adapterAccountId(account = {}, requestedId = '') { return resolveAccountKey(account) || clean(requestedId); }
async function sendText(context = {}, input = {}) {
  requirePersistedAttempt(input);
  const config = requireRuntimeConfig();
  const target = await resolveConversationTarget(config, context.target, input);
  return chatwootSendText(config, target.conversationId, input.text, input);
}
async function sendMedia(context = {}, input = {}) {
  requirePersistedAttempt(input);
  const config = requireRuntimeConfig();
  const target = await resolveConversationTarget(config, context.target, input);
  return chatwootSendMedia(config, target.conversationId, input, input);
}
function unsupportedOperation(operation) { throw fail('FACEBOOK_CHATWOOT_OPERATION_UNSUPPORTED', `Chatwoot Facebook Page adapter does not claim unsupported operation: ${operation}`, 409, { operation }); }
async function sendPresence() { return unsupportedOperation('sendPresence'); }
async function markRead() { return unsupportedOperation('markRead'); }

module.exports = {
  RUNTIME, BINDING_EVENT_TYPE, BINDING_STATE_KEY, WEBHOOK_FRESHNESS_MS,
  CHATWOOT_SIGNATURE_HEADER, CHATWOOT_TIMESTAMP_HEADER,
  enabled, runtimeConfig, verifySignedWebhook, handleSignedWebhook,
  listFacebookInboxes, resolveFacebookInbox, getRoomBinding, findBindingByConversation,
  resolveAccountKey, credentialState, credentialReady, status, connect, disconnect, sync,
  externalTarget, adapterAccountId, sendText, sendMedia, sendPresence, markRead
};
