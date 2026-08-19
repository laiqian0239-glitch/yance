'use strict';

const crypto = require('crypto');
const fs = require('fs');
const messageStore = require('../repositories/messageRepository');
const eventBus = require('./eventBus');
const { getSecurityGuard } = require('../core/securityGuardSingleton');

const PROTOCOL_AUTHORITY = 'mautrix-meta';
const NATIVE_LOGIN_FLOW = 'messenger-lite';
const SESSION_RESTORE = 'SESSION_RESTORE';
const runtimeClients = Object.create(null);

function clean(value, fallback = '') { const text = String(value == null ? '' : value).trim(); return text || fallback; }
function fail(code, message, status = 409, details = {}) { const error = new Error(message); error.code = code; error.status = status; error.details = details; return error; }
function assertActive(signal, code = 'FACEBOOK_PERSONAL_MESSENGER_OPERATION_ABORTED') {
  if (!signal?.aborted) return;
  const error = signal.reason instanceof Error ? signal.reason : fail(code, 'Facebook Personal Messenger operation aborted', 499);
  if (!error.code) error.code = code;
  throw error;
}
function matrixSdk() { return require('matrix-js-sdk'); }
function securityGuard() { return getSecurityGuard(); }
function env(name, fallback = '') { return clean(process.env[name], fallback); }
function secretFile(name) {
  const filePath = env(name);
  if (!filePath) return '';
  try { return clean(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw fail('PLATFORM_RUNTIME_SECRET_FILE_UNAVAILABLE', `Runtime secret file ${name} is unavailable.`, 503, { name, causeCode: clean(error?.code) }); }
}
function accountIdOf(account) { return clean(account?.id || account); }
function credentialRefOf(account) { return clean(account?.credentialRef, `account:${accountIdOf(account)}`); }
function configuredSecret(account, supplied = {}) {
  const persisted = securityGuard().credentials.get(credentialRefOf(account), { actor: 'platform-adapter' }) || {};
  return { ...persisted, ...(supplied || {}) };
}
function matrixBaseUrl(secret = {}) { return clean(secret.matrixBaseUrl || env('YANCE_MATRIX_BASE_URL'), 'http://127.0.0.1:8008'); }
function bridgeProvisioningBaseUrl(secret = {}) { return clean(secret.mautrixMetaProvisioningUrl || env('YANCE_MAUTRIX_META_PROVISIONING_URL'), 'http://127.0.0.1:29319/_matrix/provision'); }
function bridgeProvisioningToken(secret = {}) { return clean(secret.mautrixMetaProvisioningToken || secretFile('YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE')); }
function matrixServerName() { return env('YANCE_MATRIX_SERVER_NAME', 'yance.local'); }
function matrixIdentityFor(account) {
  const digest = crypto.createHash('sha256').update(accountIdOf(account)).digest('hex').slice(0, 24);
  return `@yance_fb_${digest}:${matrixServerName()}`;
}
function runtimeFor(account) { return runtimeClients[accountIdOf(account)] || null; }
function publicRuntime(row) {
  if (!row) return null;
  return {
    state: row.state,
    connectedAt: row.connectedAt || '',
    lastSyncAt: row.lastSyncAt || '',
    lastError: row.lastError || '',
    reasonCode: row.reasonCode || '',
    canSend: row.state === 'connected',
    canReceive: row.state === 'connected',
    matrixUserId: row.matrixUserId || '',
    protocolAuthority: PROTOCOL_AUTHORITY,
    nativeLoginFlow: NATIVE_LOGIN_FLOW,
    supportLevel: 'production',
    SESSION_RESTORE
  };
}
function status(account) {
  const row = runtimeFor(account);
  if (row) return publicRuntime(row);
  const secret = configuredSecret(account);
  return {
    state: credentialReady(account, secret) ? 'logged-out' : 'unconfigured',
    connectedAt: '', lastSyncAt: '', lastError: '', reasonCode: '',
    canSend: false, canReceive: false,
    matrixUserId: clean(secret.matrixUserId), protocolAuthority: PROTOCOL_AUTHORITY,
    nativeLoginFlow: NATIVE_LOGIN_FLOW, supportLevel: 'production', SESSION_RESTORE
  };
}
function credentialReady(account, secret = {}) {
  const merged = configuredSecret(account, secret);
  return Boolean(clean(merged.matrixUserId) && clean(merged.matrixAccessToken));
}

async function jsonResponse(response, code) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { message: text }; }
  if (!response.ok) throw fail(code, clean(body.error || body.message, `HTTP ${response.status}`), response.status, { body });
  return body;
}
async function synapseRegister(account, signal = null) {
  const sharedSecret = secretFile('YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE');
  if (!sharedSecret) throw fail('MATRIX_REGISTRATION_SHARED_SECRET_REQUIRED', 'Synapse registration shared secret is required to provision an isolated Matrix identity.', 503);
  const baseUrl = matrixBaseUrl({});
  assertActive(signal);
  const nonceBody = await jsonResponse(await fetch(`${baseUrl}/_synapse/admin/v1/register`, { signal }), 'MATRIX_REGISTRATION_NONCE_FAILED');
  const nonce = clean(nonceBody.nonce);
  if (!nonce) throw fail('MATRIX_REGISTRATION_NONCE_MISSING', 'Synapse registration did not return a nonce.', 502);
  const matrixUserId = matrixIdentityFor(account);
  const username = matrixUserId.slice(1, matrixUserId.indexOf(':'));
  const password = crypto.randomBytes(32).toString('base64url');
  const mac = crypto.createHmac('sha1', sharedSecret).update(`${nonce}\0${username}\0${password}\0notadmin`).digest('hex');
  const body = await jsonResponse(await fetch(`${baseUrl}/_synapse/admin/v1/register`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, username, password, admin: false, mac })
  }), 'MATRIX_ACCOUNT_REGISTRATION_FAILED');
  const accessToken = clean(body.access_token);
  if (!accessToken) throw fail('MATRIX_ACCOUNT_ACCESS_TOKEN_MISSING', 'Synapse registration did not return an access token.', 502);
  return { matrixUserId: clean(body.user_id, matrixUserId), matrixAccessToken: accessToken, matrixBaseUrl: baseUrl };
}
async function ensureMatrixBinding(account, options = {}) {
  let secret = configuredSecret(account, options.secret || {});
  const expectedUserId = matrixIdentityFor(account);
  if (clean(secret.matrixUserId) && clean(secret.matrixUserId) !== expectedUserId) {
    throw fail('FACEBOOK_PERSONAL_MATRIX_IDENTITY_SCOPE_MISMATCH', 'Facebook Personal account is bound to a Matrix identity owned by another account.', 409, { accountId: accountIdOf(account) });
  }
  if (!clean(secret.matrixUserId) || !clean(secret.matrixAccessToken)) {
    const provisioned = await synapseRegister(account, options.signal || null);
    secret = { ...secret, ...provisioned };
    await securityGuard().credentials.persist(credentialRefOf(account), secret, { actor: 'platform-adapter' });
  }
  return secret;
}
function createClient(account, secret) {
  return matrixSdk().createClient({
    baseUrl: matrixBaseUrl(secret),
    accessToken: clean(secret.matrixAccessToken),
    userId: clean(secret.matrixUserId)
  });
}
function eventIdOf(event) { return clean(event?.getId?.() || event?.event?.event_id || event?.event_id); }
function eventTypeOf(event) { return clean(event?.getType?.() || event?.event?.type || event?.type); }
function eventContentOf(event) { return event?.getContent?.() || event?.event?.content || event?.content || {}; }
function eventSenderOf(event) { return clean(event?.getSender?.() || event?.event?.sender || event?.sender); }
function eventTimestampOf(event) {
  const value = Number(event?.getTs?.() || event?.event?.origin_server_ts || event?.origin_server_ts || Date.now());
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}
function attachmentFromMatrix(content = {}) {
  if (!['m.image', 'm.video', 'm.audio', 'm.file'].includes(clean(content.msgtype)) || !clean(content.url)) return [];
  return [{
    id: clean(content.url), kind: clean(content.msgtype).slice(2), mediaUrl: clean(content.url),
    mimeType: clean(content.info?.mimetype), filename: clean(content.body, 'attachment'),
    size: Number(content.info?.size || 0), downloadStatus: 'remote'
  }];
}
async function projectMatrixEvent(account, room, event) {
  if (!event || eventTypeOf(event) !== 'm.room.message') return { handled: false };
  const externalEventId = eventIdOf(event);
  if (!externalEventId) return { handled: false };
  const content = eventContentOf(event);
  const ownUserId = clean(runtimeFor(account)?.matrixUserId);
  const sender = eventSenderOf(event);
  const fromMe = sender === ownUserId;
  const roomId = clean(room?.roomId || room?.room_id || room);
  const conversationId = `facebook:${accountIdOf(account)}:${roomId}`;
  const text = clean(content.body, content.msgtype === 'm.text' ? '' : `[${clean(content.msgtype, 'attachment')}]`);
  const message = {
    id: externalEventId,
    externalMessageId: externalEventId,
    externalEventId,
    idempotencyKey: `facebook:${accountIdOf(account)}:matrix:${externalEventId}`,
    dedupeKey: `facebook:${accountIdOf(account)}:${externalEventId}`,
    accountId: accountIdOf(account),
    platform: 'facebook',
    chatJid: roomId,
    conversationId,
    direction: fromMe ? 'outbound' : 'inbound',
    fromMe,
    type: attachmentFromMatrix(content).length ? clean(content.msgtype).slice(2) : 'text',
    text,
    sender,
    senderName: sender,
    contactName: sender,
    timestamp: eventTimestampOf(event),
    attachments: attachmentFromMatrix(content),
    deliveryStatus: fromMe ? 'sent' : '',
    source: 'mautrix-meta-matrix-js-sdk',
    rawMessage: null,
    rawMeta: { roomId, matrixEventType: eventTypeOf(event), protocolAuthority: PROTOCOL_AUTHORITY }
  };
  require('./platformAdapterPorts').singleton.ingest({
    platform: 'facebook', sourceAccountId: accountIdOf(account), eventType: fromMe ? 'message.sent.observed' : 'message.received',
    externalEventId, idempotencyKey: message.idempotencyKey, occurredAt: message.timestamp,
    payload: { roomId, sender, content, messageId: externalEventId, direction: message.direction }
  });
  const outcome = await messageStore.upsert(message);
  if (outcome?.inserted && !fromMe) eventBus.publish('facebook:message', { accountId: accountIdOf(account), conversationId, externalEventId, source: PROTOCOL_AUTHORITY });
  return { handled: true, inserted: outcome?.inserted === true, message };
}
function attachLiveIngress(account, client) {
  client.on('Room.timeline', (event, room, toStartOfTimeline) => {
    if (toStartOfTimeline) return;
    projectMatrixEvent(account, room, event).catch(error => eventBus.publish('facebook:ingest-error', { accountId: accountIdOf(account), code: error.code || 'FACEBOOK_PERSONAL_MATRIX_INGEST_FAILED', error: error.message }));
  });
}
function attachSyncState(account, client, row) {
  client.on('sync', (state, _previousState, data = {}) => {
    const next = clean(state).toUpperCase();
    const errorCode = clean(data?.error?.errcode || data?.error?.code);
    if (next === 'PREPARED' || next === 'SYNCING') {
      row.state = 'connected'; row.lastSyncAt = new Date().toISOString(); row.lastError = ''; row.reasonCode = '';
    } else if (next === 'RECONNECTING' || next === 'CATCHUP') {
      row.state = 'reconnecting'; row.reasonCode = `MATRIX_${next}`;
    } else if (next === 'ERROR') {
      const reauth = ['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN'].includes(errorCode);
      row.state = reauth ? 'reauth-required' : 'reconnecting';
      row.lastError = clean(data?.error?.message || data?.error, 'Matrix sync error');
      row.reasonCode = reauth ? 'MATRIX_ACCESS_TOKEN_INVALID' : 'MATRIX_SYNC_ERROR';
      eventBus.publish('facebook:session-state', { accountId: accountIdOf(account), state: row.state, reasonCode: row.reasonCode, protocolAuthority: PROTOCOL_AUTHORITY });
    }
  });
}
function waitForMatrixReady(client, signal = null) {
  const current = clean(client.getSyncState?.()).toUpperCase();
  if (current === 'PREPARED' || current === 'SYNCING') return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(fail('FACEBOOK_PERSONAL_MATRIX_INITIAL_SYNC_TIMEOUT', 'matrix-js-sdk initial sync did not become ready in time.', 504)), 45_000);
    const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : fail('FACEBOOK_PERSONAL_SESSION_RESTORE_ABORTED', 'Facebook Personal Messenger session restore aborted.', 499));
    const onSync = (state, _previous, data = {}) => {
      const next = clean(state).toUpperCase();
      const errorCode = clean(data?.error?.errcode || data?.error?.code);
      if (next === 'PREPARED' || next === 'SYNCING') finish(null, next);
      else if (next === 'ERROR' && ['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN'].includes(errorCode)) finish(fail('FACEBOOK_PERSONAL_MATRIX_REAUTH_REQUIRED', 'Matrix access token is no longer valid.', 401, { errorCode }));
    };
    function finish(error, value = '') {
      if (settled) return; settled = true;
      clearTimeout(timeout); client.off('sync', onSync); signal?.removeEventListener?.('abort', onAbort);
      if (error) reject(error); else resolve(value);
    }
    client.on('sync', onSync);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  });
}
async function bridgeLoginState(account, secret, signal = null) {
  const loginId = clean(account?.metadata?.mautrixMetaLoginId);
  if (!loginId) return { state: 'not-logged-in', login: null };
  const whoami = await provisioningRequest(account, secret, '/v3/whoami', { signal });
  const login = Array.isArray(whoami?.logins) ? whoami.logins.find(item => clean(item?.id) === loginId) : null;
  if (!login) throw fail('FACEBOOK_PERSONAL_MESSENGER_REAUTH_REQUIRED', 'mautrix/meta no longer has the persisted Facebook Personal login.', 401, { loginId });
  const state = clean(login?.state?.state_event || login?.state?.stateEvent).toUpperCase();
  if (state === 'BAD_CREDENTIALS') {
    throw fail('FACEBOOK_PERSONAL_MESSENGER_REAUTH_REQUIRED', clean(login?.state?.message, 'Facebook Personal Messenger session expired.'), 401, { loginId, bridgeState: state, bridgeError: clean(login?.state?.error) });
  }
  return { state: state || 'UNKNOWN', login };
}
async function connect(account, options = {}) {
  assertActive(options.signal, 'FACEBOOK_PERSONAL_SESSION_RESTORE_ABORTED');
  const secret = await ensureMatrixBinding(account, options);
  const id = accountIdOf(account);
  const existing = runtimeClients[id];
  if (existing?.client) { try { existing.client.stopClient(); } catch (_) {} }
  const client = createClient(account, secret);
  const row = runtimeClients[id] = {
    client, state: 'connecting', connectedAt: '', lastSyncAt: '', lastError: '', reasonCode: '',
    matrixUserId: clean(secret.matrixUserId), SESSION_RESTORE, operationGeneration: clean(options.executionGeneration || options.operationGeneration)
  };
  attachLiveIngress(account, client);
  attachSyncState(account, client, row);
  try {
    await client.startClient({ initialSyncLimit: 50, lazyLoadMembers: true });
    await waitForMatrixReady(client, options.signal || null);
    assertActive(options.signal, 'FACEBOOK_PERSONAL_SESSION_RESTORE_ABORTED');
    const remote = await bridgeLoginState(account, secret, options.signal || null);
    row.state = 'connected'; row.connectedAt = new Date().toISOString(); row.lastSyncAt = row.lastSyncAt || row.connectedAt;
    row.reasonCode = remote.state === 'CONNECTED' ? '' : `MAUTRIX_META_${remote.state}`;
    return publicRuntime(row);
  } catch (error) {
    try { client.stopClient(); } catch (_) {}
    delete runtimeClients[id];
    throw error;
  }
}

async function disconnect(account, options = {}) {
  const id = accountIdOf(account);
  const row = runtimeClients[id];
  assertActive(options.signal, 'FACEBOOK_PERSONAL_DISCONNECT_ABORTED');
  if (row?.client) row.client.stopClient();
  delete runtimeClients[id];
  if (options.logout === true) {
    const secret = configuredSecret(account, options.secret || {});
    const loginId = clean(secret.mautrixMetaLoginId || account?.metadata?.mautrixMetaLoginId);
    if (loginId) await provisioningRequest(account, secret, `/v3/logout/${encodeURIComponent(loginId)}`, { method: 'POST', signal: options.signal });
  }
  return { state: 'logged-out', canSend: false, canReceive: false, protocolAuthority: PROTOCOL_AUTHORITY, SESSION_RESTORE };
}
function requireClient(account) {
  const row = runtimeFor(account);
  if (!row?.client || row.state !== 'connected') throw fail('FACEBOOK_PERSONAL_MESSENGER_REAUTH_REQUIRED', 'Facebook Personal Messenger Matrix session is not connected.', 409);
  return row;
}
async function provisioningRequest(account, secret, pathname, options = {}) {
  const token = bridgeProvisioningToken(secret);
  if (!token) throw fail('MAUTRIX_META_PROVISIONING_TOKEN_REQUIRED', 'mautrix/meta provisioning token is not configured.', 503);
  const matrixUserId = clean(secret.matrixUserId) || matrixIdentityFor(account);
  const base = bridgeProvisioningBaseUrl(secret).replace(/\/$/u, '');
  const separator = pathname.includes('?') ? '&' : '?';
  const response = await fetch(`${base}${pathname}${separator}user_id=${encodeURIComponent(matrixUserId)}`, {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}) }
  });
  return jsonResponse(response, 'MAUTRIX_META_PROVISIONING_REQUEST_FAILED');
}
async function beginLogin(account, username = '', options = {}) {
  const secret = await ensureMatrixBinding(account, options);
  assertActive(options.signal, 'FACEBOOK_PERSONAL_LOGIN_START_ABORTED');
  const started = await provisioningRequest(account, secret, `/v3/login/start/${encodeURIComponent(NATIVE_LOGIN_FLOW)}`, { method: 'POST', signal: options.signal });
  return { ...started, username: clean(username), protocolAuthority: PROTOCOL_AUTHORITY, nativeLoginFlow: NATIVE_LOGIN_FLOW };
}
async function submitLoginInput(account, loginProcessId, stepId, input = {}, options = {}) {
  const secret = await ensureMatrixBinding(account, options);
  const processId = clean(loginProcessId);
  const step = clean(stepId);
  if (!processId || !step) throw fail('FACEBOOK_PERSONAL_LOGIN_STEP_REQUIRED', 'mautrix/meta login continuation requires loginProcessId and stepId.', 400);
  assertActive(options.signal, 'FACEBOOK_PERSONAL_LOGIN_INPUT_ABORTED');
  // Username/password/challenge values are deliberately transient. They are sent only to the pinned
  // messenger-lite upstream step and are never written to Yance account metadata or credential storage.
  const txnId = clean(options.txnId);
  const suffix = txnId ? `?txn_id=${encodeURIComponent(txnId)}` : '';
  return provisioningRequest(account, secret, `/v3/login/step/${encodeURIComponent(processId)}/${encodeURIComponent(step)}/user_input${suffix}`, {
    method: 'POST', signal: options.signal, body: JSON.stringify(input && typeof input === 'object' ? input : {})
  });
}
async function waitLoginStep(account, loginProcessId, stepId, options = {}) {
  const secret = await ensureMatrixBinding(account, options);
  const processId = clean(loginProcessId);
  const step = clean(stepId);
  if (!processId || !step) throw fail('FACEBOOK_PERSONAL_LOGIN_STEP_REQUIRED', 'mautrix/meta login continuation requires loginProcessId and stepId.', 400);
  const txnId = clean(options.txnId);
  const suffix = txnId ? `?txn_id=${encodeURIComponent(txnId)}` : '';
  return provisioningRequest(account, secret, `/v3/login/step/${encodeURIComponent(processId)}/${encodeURIComponent(step)}/display_and_wait${suffix}`, { method: 'POST', signal: options.signal });
}
async function cancelLogin(account, loginProcessId, options = {}) {
  const secret = await ensureMatrixBinding(account, options);
  const processId = clean(loginProcessId);
  if (!processId) return { cancelled: false, reasonCode: 'LOGIN_PROCESS_ID_MISSING' };
  return provisioningRequest(account, secret, `/v3/login/cancel/${encodeURIComponent(processId)}`, { method: 'POST', signal: options.signal });
}
async function resolveRoom(account, target, options = {}) {
  const value = clean(target);
  if (!value) throw fail('FACEBOOK_PERSONAL_TARGET_REQUIRED', 'Facebook Personal Messenger target is required.', 400);
  if (value.startsWith('!')) return value;
  const secret = configuredSecret(account, options.secret || {});
  const created = await provisioningRequest(account, secret, `/v3/create_dm/${encodeURIComponent(value)}`, { method: 'POST', signal: options.signal });
  const roomId = clean(created.dm_room_mxid || created.room_id);
  if (!roomId) throw fail('FACEBOOK_PERSONAL_DM_ROOM_MISSING', 'mautrix/meta did not return a Matrix DM room.', 502);
  return roomId;
}
function transactionId(input = {}) {
  return clean(input.idempotencyKey || input.localMessageId || input.commandId || input.physicalAttemptContext?.attemptId) || crypto.randomUUID();
}
async function sendText(context = {}, input = {}) {
  const account = context.account || { id: context.accountId };
  const row = requireClient(account);
  assertActive(input.signal, 'FACEBOOK_PERSONAL_SEND_ABORTED');
  const roomId = await resolveRoom(account, context.target, input);
  const txnId = transactionId(input);
  const response = await row.client.sendMessage(roomId, { msgtype: 'm.text', body: clean(input.text) }, txnId);
  const messageId = clean(response?.event_id);
  if (!messageId) throw fail('FACEBOOK_PERSONAL_SEND_ACK_MISSING', 'Matrix send completed without event_id.', 502);
  return { success: true, id: messageId, messageId, platformMessageId: messageId, externalEventId: messageId, idempotency: txnId, roomId };
}
async function bytesForMedia(input = {}) {
  if (Buffer.isBuffer(input.buffer)) return input.buffer;
  if (input.data instanceof Uint8Array) return Buffer.from(input.data);
  if (clean(input.path)) return require('fs').promises.readFile(clean(input.path));
  const url = clean(input.url || input.mediaUrl);
  if (!url) throw fail('FACEBOOK_PERSONAL_MEDIA_REQUIRED', 'Facebook Personal Messenger media requires bytes, path, or URL.', 400);
  const response = await fetch(url, { signal: input.signal || null });
  if (!response.ok) throw fail('FACEBOOK_PERSONAL_MEDIA_FETCH_FAILED', `Media fetch failed: HTTP ${response.status}`, 502);
  return Buffer.from(await response.arrayBuffer());
}
async function sendMedia(context = {}, input = {}) {
  const account = context.account || { id: context.accountId };
  const row = requireClient(account);
  const roomId = await resolveRoom(account, context.target, input);
  const bytes = await bytesForMedia(input);
  const uploaded = await row.client.uploadContent(bytes, { name: clean(input.filename, 'attachment'), type: clean(input.mimeType, 'application/octet-stream') });
  const contentUri = clean(uploaded?.content_uri || uploaded?.contentUri || uploaded);
  if (!contentUri) throw fail('FACEBOOK_PERSONAL_MEDIA_UPLOAD_URI_MISSING', 'Matrix media upload completed without content_uri.', 502);
  const mime = clean(input.mimeType).toLowerCase();
  const msgtype = mime.startsWith('image/') ? 'm.image' : mime.startsWith('video/') ? 'm.video' : mime.startsWith('audio/') ? 'm.audio' : 'm.file';
  const txnId = transactionId(input);
  const response = await row.client.sendMessage(roomId, { msgtype, body: clean(input.filename, 'attachment'), url: contentUri, info: { mimetype: clean(input.mimeType), size: bytes.length } }, txnId);
  const messageId = clean(response?.event_id);
  if (!messageId) throw fail('FACEBOOK_PERSONAL_SEND_ACK_MISSING', 'Matrix media send completed without event_id.', 502);
  return { success: true, id: messageId, messageId, platformMessageId: messageId, externalEventId: messageId, idempotency: txnId, roomId, contentUri };
}
async function fetchHistory(account, target = '', options = {}) {
  const row = requireClient(account);
  const roomId = await resolveRoom(account, target, options);
  const room = row.client.getRoom(roomId);
  if (!room) throw fail('FACEBOOK_PERSONAL_MATRIX_ROOM_NOT_JOINED', 'Matrix DM room is not joined for this account.', 409, { roomId });
  await row.client.scrollback(room, Math.max(1, Math.min(Number(options.limit || 50), 200)));
  const events = room.getLiveTimeline().getEvents();
  let projected = 0;
  for (const event of events) if ((await projectMatrixEvent(account, room, event)).handled) projected += 1;
  row.lastSyncAt = new Date().toISOString();
  return { state: 'connected', syncedAt: row.lastSyncAt, roomId, projected, externalEventId: clean(events.at(-1)?.getId?.()), accountId: accountIdOf(account) };
}
async function sync(account, options = {}) {
  const row = requireClient(account);
  assertActive(options.signal, 'FACEBOOK_PERSONAL_HISTORY_SYNC_ABORTED');
  const secret = configuredSecret(account, options.secret || {});
  const remote = await bridgeLoginState(account, secret, options.signal || null);
  let projected = 0;
  for (const room of row.client.getRooms()) {
    const events = room.getLiveTimeline().getEvents();
    for (const event of events) if ((await projectMatrixEvent(account, room, event)).handled) projected += 1;
  }
  row.lastSyncAt = new Date().toISOString();
  row.reasonCode = remote.state === 'CONNECTED' ? '' : `MAUTRIX_META_${remote.state}`;
  return { state: 'connected', bridgeState: remote.state, syncedAt: row.lastSyncAt, projected, accountId: accountIdOf(account), SESSION_RESTORE };
}
async function markRead(context = {}, input = {}) {
  const account = context.account || { id: context.accountId };
  const row = requireClient(account);
  const roomId = await resolveRoom(account, context.target, input);
  const eventId = clean((input.messageKeys || input.messageIds || [])[0] || input.messageId || input.targetId);
  if (!eventId) throw fail('FACEBOOK_PERSONAL_READ_EVENT_REQUIRED', 'Read receipt requires a Matrix event ID.', 400);
  const room = row.client.getRoom(roomId);
  let event = room?.findEventById?.(eventId) || null;
  if (!event) {
    const rawEvent = await row.client.fetchRoomEvent(roomId, eventId);
    event = new (matrixSdk().MatrixEvent)(rawEvent);
  }
  await row.client.sendReadReceipt(event);
  return { success: true, roomId, eventId };
}
async function setTyping(context = {}, input = {}) {
  const account = context.account || { id: context.accountId };
  const row = requireClient(account);
  const roomId = await resolveRoom(account, context.target, input);
  const typing = ['composing', 'typing', 'available'].includes(clean(input.state).toLowerCase());
  await row.client.sendTyping(roomId, typing, typing ? Math.max(1000, Math.min(Number(input.timeoutMs || 5000), 30000)) : 0);
  return { success: true, roomId, typing };
}
async function sendPresence(context = {}, input = {}) { return setTyping(context, input); }
function externalTarget(value) { return clean(value).replace(/^facebook:/iu, ''); }
function adapterAccountId(account, requestedId = '') { return accountIdOf(account) || clean(requestedId); }

module.exports = Object.freeze({
  supportLevel: 'production', official: false, messagingSupported: true, riskDisclosureRequired: false,
  protocolAuthority: PROTOCOL_AUTHORITY, isolationModel: 'matrix-application-service', nativeLoginFlow: NATIVE_LOGIN_FLOW,
  credentialReady, status, connect, disconnect, sync, sendText, sendMedia, fetchHistory, markRead, setTyping, sendPresence,
  beginLogin, submitLoginInput, waitLoginStep, cancelLogin, externalTarget, adapterAccountId, matrixIdentityFor
});
