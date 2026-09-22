'use strict';

const fs = require('node:fs');
const QRCode = require('qrcode');

const CONFIG = Object.freeze({
  whatsapp: Object.freeze({
    authority: 'mautrix-whatsapp',
    urlEnv: 'YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL',
    secretFileEnv: 'YANCE_MAUTRIX_WHATSAPP_PROVISIONING_SECRET_FILE',
    defaultUrl: 'http://127.0.0.1:29318/_matrix/provision'
  }),
  telegram: Object.freeze({
    authority: 'mautrix-telegram',
    urlEnv: 'YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL',
    secretFileEnv: 'YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE',
    defaultUrl: 'http://127.0.0.1:29317/_matrix/provision'
  }),
  facebook: Object.freeze({
    authority: 'mautrix-meta',
    urlEnv: 'YANCE_MAUTRIX_META_PROVISIONING_URL',
    secretFileEnv: 'YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE',
    defaultUrl: 'http://127.0.0.1:29319/_matrix/provision'
  })
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function fail(code, message, status = 409, details = {}) {
  return Object.assign(new Error(message), { code, reasonCode: code, status, details });
}
function platformOf(account) {
  const platform = clean(account && account.platform).toLowerCase();
  if (!CONFIG[platform]) throw fail('MAUTRIX_PLATFORM_UNSUPPORTED', 'Unsupported mautrix platform', 409, { platform });
  return platform;
}
function configuration(platform, options = {}) {
  const row = CONFIG[platform];
  const baseUrl = clean(process.env[row.urlEnv]) || row.defaultUrl;
  const secretFile = clean(process.env[row.secretFileEnv]);
  if (!secretFile || !fs.existsSync(secretFile)) {
    throw fail('MAUTRIX_PROVISIONING_SECRET_UNAVAILABLE', row.authority + ' provisioning secret is unavailable', 503);
  }
  const token = clean(fs.readFileSync(secretFile, 'utf8'));
  if (token.length < 16) throw fail('MAUTRIX_PROVISIONING_SECRET_INVALID', row.authority + ' provisioning secret is invalid', 503);
  const matrixUserId = clean(options.matrixUserId);
  if (!matrixUserId) {
    throw fail('MATRIX_HUMAN_IDENTITY_REQUIRED', 'The signed-in Matrix human identity is required before connecting platforms.', 409);
  }
  if (!/^@[^:]+:[^:]+$/u.test(matrixUserId)) {
    throw fail('MATRIX_HUMAN_IDENTITY_INVALID', 'The projected Matrix human identity is invalid.', 400);
  }
  return { ...row, platform, baseUrl: baseUrl.replace(/\/$/u, ''), token, matrixUserId };
}
function serviceReadiness(platform) {
  const row = CONFIG[platform];
  const secretFile = clean(process.env[row.secretFileEnv]);
  if (!secretFile || !fs.existsSync(secretFile)) {
    return { ready: false, authority: row.authority, reasonCode: 'MAUTRIX_PROVISIONING_SECRET_UNAVAILABLE' };
  }
  const token = clean(fs.readFileSync(secretFile, 'utf8'));
  if (token.length < 16) {
    return { ready: false, authority: row.authority, reasonCode: 'MAUTRIX_PROVISIONING_SECRET_INVALID' };
  }
  return { ready: true, authority: row.authority };
}
function publicConfiguration(platform) {
  return serviceReadiness(platform);
}
async function request(account, relativePath, options = {}) {
  const cfg = configuration(platformOf(account), options);
  const url = new URL(cfg.baseUrl + relativePath);
  url.searchParams.set('user_id', cfg.matrixUserId);
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + cfg.token,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal || null
  });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) {
    const upstreamCode = clean(body && (body.errcode || body.code));
    throw fail(
      upstreamCode || 'MAUTRIX_PROVISIONING_REQUEST_FAILED',
      clean(body && (body.error || body.message)) || cfg.authority + ' provisioning returned HTTP ' + response.status,
      response.status,
      { authority: cfg.authority, upstreamCode }
    );
  }
  return body && typeof body === 'object' ? body : {};
}

async function decorateLoginStep(result = {}) {
  const display = result.display_and_wait && typeof result.display_and_wait === 'object' ? result.display_and_wait : {};
  const userInput = result.user_input && typeof result.user_input === 'object' ? result.user_input : {};
  const displayType = clean(display.type).toLowerCase();
  const displayData = clean(display.data);
  let qrCode = '';
  if (displayType === 'qr' && displayData) {
    qrCode = await QRCode.toDataURL(displayData, { errorCorrectionLevel: 'M', margin: 2, width: 280 });
  }
  return {
    ...result,
    loginProcessId: clean(result.login_id || result.loginProcessId),
    stepId: clean(result.step_id || result.stepId),
    stepType: clean(result.type || result.stepType),
    prompt: clean(result.instructions || result.prompt),
    requirements: Array.isArray(userInput.fields) ? userInput.fields : [],
    waiting: clean(result.type) === 'display_and_wait',
    qrCode,
    code: displayType === 'code' ? displayData : ''
  };
}
function complete(result = {}) {
  return clean(result.type).toLowerCase() === 'complete'
    || Boolean(clean(result.complete && (result.complete.user_login_id || result.complete.userLoginId)));
}
function loginId(result = {}) {
  return clean(
    (result.complete && (result.complete.user_login_id || result.complete.userLoginId))
    || result.login_id || result.loginId
  );
}

async function resolveLoginOwnerIdentity(account, row, options = {}) {
  const platform = platformOf(account);
  const identifier = clean(row && row.id);
  if (platform !== 'facebook' || !identifier) return { remoteMatrixUserId: '', identityReasonCode: '' };
  try {
    const resolved = await request(
      account,
      '/v3/resolve_identifier/' + encodeURIComponent(identifier) + '?login_id=' + encodeURIComponent(identifier),
      { ...options, signal: options.signal || null }
    );
    return {
      remoteMatrixUserId: clean(resolved && resolved.mxid),
      identityReasonCode: clean(resolved && resolved.mxid) ? '' : 'MAUTRIX_REMOTE_MATRIX_ID_UNAVAILABLE'
    };
  } catch (error) {
    return {
      remoteMatrixUserId: '',
      identityReasonCode: clean(error && (error.reasonCode || error.code)) || 'MAUTRIX_REMOTE_IDENTITY_UNAVAILABLE'
    };
  }
}

async function observe(account, options = {}) {
  const cfg = configuration(platformOf(account), options);
  const whoami = await request(account, '/v3/whoami', { ...options, signal: options.signal || null });
  const logins = Array.isArray(whoami.logins) ? whoami.logins : [];
  const loginIdentities = await Promise.all(logins.map(row => resolveLoginOwnerIdentity(account, row, options)));
  const connected = logins.length > 0;
  return {
    state: connected ? 'connected' : 'logged-out',
    canReceive: connected,
    canAttemptSend: false,
    loginCount: logins.length,
    authority: cfg.authority,
    matrixUserId: cfg.matrixUserId,
    bridgeLogins: logins.map((row, index) => ({
      id: clean(row && row.id),
      name: clean(row && row.name),
      stateEvent: clean((row && row.state && row.state.state_event) || (row && row.state_event)),
      spaceRoom: clean(row && row.space_room),
      remoteMatrixUserId: loginIdentities[index].remoteMatrixUserId,
      identityReasonCode: loginIdentities[index].identityReasonCode
    }))
  };
}
async function getLoginFlows(account, options = {}) {
  const result = await request(account, '/v3/login/flows', { ...options, signal: options.signal || null });
  return Array.isArray(result.flows) ? result.flows : [];
}
async function beginLogin(account, flowId, options = {}) {
  const flow = clean(flowId);
  if (!flow) throw fail('MAUTRIX_LOGIN_FLOW_REQUIRED', 'A mautrix login flow is required', 400);
  const result = await request(account, '/v3/login/start/' + encodeURIComponent(flow), {
    ...options, method: 'POST', body: {}, signal: options.signal || null
  });
  return decorateLoginStep(result);
}
async function submitLoginStep(account, loginProcessId, stepId, stepType, input = {}, options = {}) {
  const processId = clean(loginProcessId);
  const step = clean(stepId);
  const type = clean(stepType || 'user_input');
  if (!processId || !step) throw fail('MAUTRIX_LOGIN_CONTINUATION_REQUIRED', 'The mautrix login continuation is incomplete', 400);
  const body = ['user_input', 'cookies', 'webauthn'].includes(type)
    ? (input && typeof input === 'object' ? input : {})
    : undefined;
  const endpoint = '/v3/login/step/' + encodeURIComponent(processId)
    + '/' + encodeURIComponent(step) + '/' + encodeURIComponent(type);
  const requestOptions = {
    ...options,
    method: 'POST',
    signal: options.signal || null,
    ...(body === undefined ? {} : { body })
  };
  const result = await request(account, endpoint, requestOptions);
  return decorateLoginStep(result);
}
async function waitLoginStep(account, loginProcessId, stepId, options = {}) {
  return submitLoginStep(account, loginProcessId, stepId, 'display_and_wait', {}, options);
}
async function cancelLogin(account, loginProcessId, options = {}) {
  const processId = clean(loginProcessId);
  if (!processId) return { cancelled: false, reasonCode: 'MAUTRIX_LOGIN_PROCESS_NOT_PRESENT' };
  await request(account, '/v3/login/cancel/' + encodeURIComponent(processId), {
    ...options, method: 'POST', body: {}, signal: options.signal || null
  });
  return { cancelled: true, loginProcessId: processId };
}
async function ensureDirectChat(account, identifier, loginId, options = {}) {
  const platform = platformOf(account);
  let target = clean(identifier);
  if (platform === 'telegram') {
    target = target.replace(/^telegram:/iu, '').replace(/^user:/iu, '');
  }
  const login = clean(loginId);
  if (!target) throw fail('MAUTRIX_DIRECT_CHAT_IDENTIFIER_REQUIRED', 'A remote direct-chat identifier is required', 400);
  if (!login) throw fail('MAUTRIX_LOGIN_ID_REQUIRED', 'An exact mautrix login identity is required', 409);
  const result = await request(
    account,
    '/v3/create_dm/' + encodeURIComponent(target) + '?login_id=' + encodeURIComponent(login),
    { ...options, method: 'POST', signal: options.signal || null }
  );
  const roomId = clean(result && (result.dm_room_mxid || result.dmRoomMxid));
  if (!roomId) throw fail('MAUTRIX_DIRECT_CHAT_ROOM_REQUIRED', 'The mautrix bridge did not return a direct-chat Matrix room', 502);
  return { ...result, roomId, peerId: clean(result && result.id) };
}
async function disconnect(account, options = {}) {
  if (options.logout !== true) return { preserved: true, authority: CONFIG[platformOf(account)].authority };
  await request(account, '/v3/logout/all', { ...options, method: 'POST', body: {}, signal: options.signal || null });
  return { loggedOut: true, state: 'logged-out', authority: CONFIG[platformOf(account)].authority };
}
async function sync(account, options = {}) {
  const projection = await observe(account, options);
  return { ...projection, syncedAt: new Date().toISOString() };
}
function status(account) {
  const platform = platformOf(account);
  const row = CONFIG[platform];
  return {
    state: account && account.paused ? 'paused' : 'logged-out',
    authority: row.authority,
    authorityReady: Boolean(clean(process.env[row.urlEnv]) && clean(process.env[row.secretFileEnv])),
    matrixUserId: '',
    canAttemptSend: false,
    canReceive: false,
    observationRequired: true
  };
}
function credentialReady(account) {
  return serviceReadiness(platformOf(account)).ready;
}
function externalTarget(value) { return clean(value); }
function adapterAccountId(account, requestedId = '') { return clean((account && account.id) || requestedId); }
function sendOwnedByElement() {
  throw fail(
    'ELEMENT_MATRIX_SEND_AUTHORITY_REQUIRED',
    'Messages for mautrix-backed accounts must be sent through the active Element Matrix RoomView.',
    409
  );
}
function create(platform) {
  const normalized = clean(platform).toLowerCase();
  if (!CONFIG[normalized]) throw fail('MAUTRIX_PLATFORM_UNSUPPORTED', 'Unsupported mautrix platform', 409);
  return Object.freeze({
    platform: normalized,
    protocolAuthority: CONFIG[normalized].authority,
    enabled: () => true,
    resolveAccountKey: account => clean(account && account.id),
    credentialState: () => null,
    credentialReady,
    status,
    observe,
    connect: observe,
    disconnect,
    sync,
    externalTarget,
    adapterAccountId,
    getLoginFlows,
    beginLogin,
    submitLoginInput: (account, loginProcessId, stepId, input, options = {}) =>
      submitLoginStep(account, loginProcessId, stepId, 'user_input', input, options),
    submitLoginStep,
    waitLoginStep,
    cancelLogin,
    ensureDirectChat,
    sendText: sendOwnedByElement,
    sendMedia: sendOwnedByElement,
    sendReaction: sendOwnedByElement,
    revokeMessage: sendOwnedByElement,
    sendNativeExpression: sendOwnedByElement,
    sendPresence: sendOwnedByElement,
    markRead: sendOwnedByElement,
    isCompleteLoginResult: complete,
    loginId
  });
}

module.exports = {
  CONFIG,
  create,
  whatsapp: create('whatsapp'),
  telegram: create('telegram'),
  facebook: create('facebook'),
  decorateLoginStep
};
