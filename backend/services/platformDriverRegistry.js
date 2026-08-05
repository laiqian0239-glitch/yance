'use strict';

const whatsapp = require('./whatsappAdapter');
const telegram = require('./telegramAdapter');
const facebook = require('./facebookAdapter');
const facebookPersonalIdentity = require('./facebookPersonalIdentityAdapter');
const facebookPersonalMessenger = require('./facebookPersonalMessengerExperimentalAdapter');

const PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'facebook']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function assertSignalActive(signal, code = 'PLATFORM_DRIVER_OPERATION_ABORTED') {
  if (!signal?.aborted) return;
  const reason = signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Platform driver operation aborted'), { code });
  if (!reason.code) reason.code = code;
  throw reason;
}
function unsupported(platform, operation) {
  const error = new Error(`${platform || 'unknown'} 不支持平台运行操作：${operation}`);
  error.code = 'PLATFORM_DRIVER_OPERATION_UNSUPPORTED';
  error.status = 409;
  error.platform = clean(platform).toLowerCase();
  error.operation = clean(operation);
  return error;
}
function normalizePlatform(value) {
  const platform = clean(value).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw unsupported(platform, 'resolve-driver');
  return platform;
}
function mapWhatsAppState(value) {
  return ({
    online: 'connected',
    qr: 'waiting-verification',
    connecting: 'connecting',
    reconnecting: 'recovering',
    restarting: 'recovering',
    offline: 'error',
    'startup-timeout': 'error',
    replaced: 'manual-review',
    quarantined: 'manual-review',
    blocked: 'manual-review',
    'manual-review': 'manual-review',
    'unknown-disconnect': 'manual-review',
    'logged-out': 'logged-out',
    stopped: 'logged-out'
  })[String(value || '').trim().toLowerCase()] || 'manual-review';
}

const drivers = Object.freeze({
  whatsapp: Object.freeze({
    platform: 'whatsapp',
    adapter: whatsapp,
    resolveAccountKey(account) { return whatsapp.resolveAccountKey(account); },
    credentialState(account) { return whatsapp.credentialState(account); },
    status(account) {
      const key = whatsapp.resolveAccountKey(account);
      const row = whatsapp.status().find(item => item.accountId === key);
      return row ? { ...row, state: mapWhatsAppState(row.state), step: row.state === 'qr' ? 'qr' : '' } : null;
    },
    credentialReady(account) { return whatsapp.credentialState(account).usable === true; },
    async connect(account, options = {}) { return whatsapp.start(account, { manual: options.manual === true, attemptId: options.attemptId || '', signal: options.signal || null, executionGeneration: options.executionGeneration || options.operationGeneration || '' }); },
    async disconnect(account, options = {}) { assertSignalActive(options.signal, 'WHATSAPP_DISCONNECT_ABORTED'); const result = await whatsapp.stop(account, options.logout === true); assertSignalActive(options.signal, 'WHATSAPP_DISCONNECT_ABORTED'); return result; },
    async sync(account, options = {}) { return whatsapp.sync(account, options); },
    externalTarget(value) { return clean(value); },
    adapterAccountId(account, requestedId = '') { return clean(account?.adapterAccountId || requestedId || account?.id); },
    async sendText(context, input) { return whatsapp.sendText({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async sendMedia(context, input) { return whatsapp.sendMedia({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async sendReaction(context, input) { return whatsapp.sendReaction({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async revokeMessage(context, input) { return whatsapp.revokeMessage({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async sendPresence(context, input) { return whatsapp.sendPresence({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async markRead(context, input) { return whatsapp.markRead({ ...input, accountId: context.adapterAccountId, chatJid: context.target }); },
    async retryMedia(input = {}) { return whatsapp.retryMedia(input); }
  }),
  telegram: Object.freeze({
    platform: 'telegram',
    adapter: telegram,
    resolveAccountKey(account) { return clean(account?.id); },
    credentialState() { return null; },
    status(account) { return telegram.status(account.id); },
    credentialReady(_account, secret = {}) { return Boolean(secret.session); },
    async connect(account, options = {}) { return telegram.connect(account, options); },
    async disconnect(account, options = {}) { assertSignalActive(options.signal, 'TELEGRAM_DISCONNECT_ABORTED'); const result = await telegram.disconnect(account.id, options.logout === true, options); assertSignalActive(options.signal, 'TELEGRAM_DISCONNECT_ABORTED'); return result; },
    async sync(account, options = {}) { return telegram.sync(account, options); },
    externalTarget(value) { return clean(value).replace(/^telegram:/i, ''); },
    adapterAccountId(account, requestedId = '') { return clean(account?.id || requestedId); },
    async sendText(context, input) { return telegram.sendText(context.accountId, context.target, input.text, { quoted: input.quoted, localMessageId: input.localMessageId, sessionKey: input.sessionKey, signal: input.signal, executionGeneration: input.executionGeneration }); },
    async sendMedia(context, input) { return telegram.sendMedia(context.accountId, context.target, input); },
    async sendReaction(context, input) { return telegram.sendReaction(context.accountId, context.target, input.targetId, input.emoji, { signal: input.signal, executionGeneration: input.executionGeneration }); },
    async revokeMessage(context, input) { return telegram.revokeMessage(context.accountId, context.target, input.targetId, { signal: input.signal, executionGeneration: input.executionGeneration }); },
    async sendNativeExpression(context, input) { return telegram.sendNativeExpression(context.accountId, context.target, input.reference, { kind: clean(input.kind).toLowerCase(), caption: input.caption, quoted: input.quoted, sessionKey: input.sessionKey, localMessageId: input.localMessageId, signal: input.signal, executionGeneration: input.executionGeneration }); },
    async sendPresence(context, input) { return telegram.sendPresence(context.accountId, context.target, input.state, { signal: input.signal, executionGeneration: input.executionGeneration }); },
    async markRead(context, input) { return telegram.markRead(context.accountId, context.target, input.messageKeys || input.messageIds || [], { signal: input.signal, executionGeneration: input.executionGeneration }); },
    async listNativeExpressions(account, kind, options = {}) { return telegram.listNativeExpressions(clean(account?.id || account), kind, options); },
    async beginQrLogin(account, options = {}) { return telegram.beginQrLogin(account, options); },
    async beginPhoneLogin(account, phoneNumber, options = {}) { return telegram.beginPhoneLogin(account, phoneNumber, options); },
    async cancelLogin(account, options = {}) { return telegram.cancelLogin(account.id, options); },
    async submitCode(account, code, options = {}) { return telegram.submitCode(account.id, code, options); },
    async submitPassword(account, password, options = {}) { return telegram.submitPassword(account.id, password, options); }
  }),
  facebook: Object.freeze({
    platform: 'facebook',
    adapter: facebook,
    resolveAccountKey(account) { return clean(account?.id); },
    credentialState() { return null; },
    status(account) { return facebook.status(account.id); },
    credentialReady(_account, secret = {}) { return Boolean(secret.pageId && secret.cloudAccountId && secret.workerBaseUrl && secret.deviceId && secret.devicePrivateKeyPkcs8); },
    async connect(account, options = {}) { return facebook.connect(account, options); },
    async disconnect(account, options = {}) { assertSignalActive(options.signal, 'FACEBOOK_DISCONNECT_ABORTED'); const result = await facebook.disconnect(account.id, options.logout === true, account, options); assertSignalActive(options.signal, 'FACEBOOK_DISCONNECT_ABORTED'); return result; },
    async sync(account, options = {}) { return facebook.sync(account, options); },
    externalTarget(value) { return clean(value).replace(/^facebook:/i, ''); },
    adapterAccountId(account, requestedId = '') { return clean(account?.id || requestedId); },
    async sendText(context, input) { return facebook.sendText(context.account, context.target, input.text, { localMessageId: input.localMessageId, sessionKey: input.sessionKey, quoted: input.quoted, localProjectionOwnedByQueue: input.localProjectionOwnedByQueue === true, signal: input.signal, executionGeneration: input.executionGeneration }); },
    async sendMedia(context, input) { return facebook.sendMedia(context.account, context.target, input); },
    async sendPresence(context, input) { return facebook.sendPresence(context.account, context.target, input.state, { signal: input.signal, executionGeneration: input.executionGeneration }); },
    async markRead(context, input = {}) { return facebook.markRead(context.account, context.target, { signal: input.signal, executionGeneration: input.executionGeneration }); },
    verifyWebhook(mode, token, challenge, accounts) { return facebook.verifyWebhook(mode, token, challenge, accounts); },
    verifyWebhookSignature(rawBody, signature, accounts, body) { return facebook.verifyWebhookSignature(rawBody, signature, accounts, body); },
    async handleWebhook(body, accounts) { return facebook.handleWebhook(body, accounts); }
  })
});


const driverById = Object.freeze({
  'whatsapp-web-multidevice': Object.freeze({
    ...drivers.whatsapp,
    driverId: 'whatsapp-web-multidevice', accountKind: 'personal-multidevice', official: false,
    supportLevel: 'experimental', messagingSupported: true, riskDisclosureRequired: true,
    isolationModel: 'isolated-auth-directory'
  }),
  'telegram-personal-mtproto': Object.freeze({
    ...drivers.telegram,
    driverId: 'telegram-personal-mtproto', accountKind: 'personal', official: true,
    supportLevel: 'production', messagingSupported: true, riskDisclosureRequired: false,
    isolationModel: 'isolated-session-worker'
  }),
  'facebook-page-official': Object.freeze({
    ...drivers.facebook,
    driverId: 'facebook-page-official', accountKind: 'page', official: true,
    supportLevel: 'production', messagingSupported: true, riskDisclosureRequired: false,
    isolationModel: 'page-account-worker'
  }),
  'facebook-personal-identity-official': Object.freeze({
    platform: 'facebook', adapter: facebookPersonalIdentity,
    driverId: 'facebook-personal-identity-official', accountKind: 'personal-identity', official: true,
    supportLevel: 'identity-only', messagingSupported: false, riskDisclosureRequired: false,
    isolationModel: 'oauth-identity',
    resolveAccountKey(account) { return clean(account?.id); }, credentialState() { return null; },
    status(account) { return facebookPersonalIdentity.status(account); },
    credentialReady(account, secret = {}) { return facebookPersonalIdentity.credentialReady(account, secret); },
    async connect(account, options = {}) { return facebookPersonalIdentity.connect(account, options); },
    async disconnect(account, options = {}) { return facebookPersonalIdentity.disconnect(account, options); },
    async sync(account, options = {}) { return facebookPersonalIdentity.sync(account, options); },
    externalTarget(value) { return clean(value).replace(/^facebook:/i, ''); },
    adapterAccountId(account, requestedId = '') { return clean(account?.id || requestedId); },
    sendText(context, input) { return facebookPersonalIdentity.sendText(context, input); },
    sendMedia(context, input) { return facebookPersonalIdentity.sendMedia(context, input); },
    sendPresence(context, input) { return facebookPersonalIdentity.sendPresence(context, input); },
    markRead(context, input) { return facebookPersonalIdentity.markRead(context, input); }
  }),
  'facebook-personal-messenger-experimental': Object.freeze({
    platform: 'facebook', adapter: facebookPersonalMessenger,
    driverId: 'facebook-personal-messenger-experimental', accountKind: 'personal-messenger', official: false,
    supportLevel: 'experimental', messagingSupported: true, riskDisclosureRequired: true,
    isolationModel: 'isolated-browser-session',
    resolveAccountKey(account) { return clean(account?.id); }, credentialState() { return null; },
    status(account) { return facebookPersonalMessenger.status(account); },
    credentialReady(account, secret = {}) { return facebookPersonalMessenger.credentialReady(account, secret); },
    async connect(account, options = {}) { return facebookPersonalMessenger.connect(account, options); },
    async disconnect(account, options = {}) { return facebookPersonalMessenger.disconnect(account, options); },
    async sync(account, options = {}) { return facebookPersonalMessenger.sync(account, options); },
    externalTarget(value) { return clean(value).replace(/^facebook:/i, ''); },
    adapterAccountId(account, requestedId = '') { return clean(account?.id || requestedId); },
    async sendText(context, input) { return facebookPersonalMessenger.sendText(context, input); },
    async sendMedia(context, input) { return facebookPersonalMessenger.sendMedia(context, input); },
    async sendPresence(context, input) { return facebookPersonalMessenger.sendPresence(context, input); },
    async markRead(context, input) { return facebookPersonalMessenger.markRead(context, input); }
  })
});

function resolveDriverId(account = {}) {
  const platform = normalizePlatform(account.platform);
  const explicit = clean(account?.metadata?.driverId || account?.driverId);
  if (explicit) {
    if (!driverById[explicit]) throw unsupported(platform, `resolve-driver:${explicit}`);
    return explicit;
  }
  const kind = clean(account?.metadata?.accountKind || account?.accountKind).toLowerCase();
  if (platform === 'facebook') {
    if (kind === 'personal-identity') return 'facebook-personal-identity-official';
    if (kind === 'personal-messenger') return 'facebook-personal-messenger-experimental';
    return 'facebook-page-official';
  }
  if (platform === 'telegram') return 'telegram-personal-mtproto';
  return 'whatsapp-web-multidevice';
}
function getForAccount(account = {}) { return driverById[resolveDriverId(account)]; }
function driverContracts() {
  return Object.fromEntries(Object.entries(driverById).map(([driverId, driver]) => {
    const featureEnabled = typeof driver.adapter?.enabled === 'function' ? driver.adapter.enabled() : true;
    const browserBridgePending = driverId === 'facebook-personal-messenger-experimental';
    return [driverId, {
      driverId, platform: driver.platform, accountKind: driver.accountKind, official: driver.official === true,
      supportLevel: driver.supportLevel, messagingSupported: driver.messagingSupported === true,
      riskDisclosureRequired: driver.riskDisclosureRequired === true, isolationModel: driver.isolationModel,
      featureEnabled,
      onboardingAvailable: featureEnabled && !browserBridgePending,
      onboardingReason: !featureEnabled ? 'FEATURE_FLAG_DISABLED' : browserBridgePending ? 'FACEBOOK_PERSONAL_MESSENGER_BROWSER_BRIDGE_PENDING' : '',
      operations: Object.keys(driver).filter(key => typeof driver[key] === 'function').sort()
    }];
  }));
}

function get(platform) { return drivers[normalizePlatform(platform)]; }
function call(platform, operation, ...args) {
  const driver = get(platform);
  if (typeof driver[operation] !== 'function') throw unsupported(platform, operation);
  return driver[operation](...args);
}
function contracts() {
  return Object.fromEntries(Object.entries(drivers).map(([platform, driver]) => [platform, {
    platform,
    operations: Object.keys(driver).filter(key => typeof driver[key] === 'function' && !['externalTarget','adapterAccountId','resolveAccountKey','credentialState','credentialReady','status'].includes(key)).sort()
  }]));
}

module.exports = { PLATFORMS, drivers, driverById, get, getForAccount, resolveDriverId, call, contracts, driverContracts, unsupported, normalizePlatform, mapWhatsAppState };
