'use strict';

const mautrix = require('./mautrixProvisioningAdapter');
const facebookChatwoot = require('./facebookChatwootMatrixBridge');
const facebookPersonalIdentity = require('./facebookPersonalIdentityAdapter');
const facebookRelayClient = require('./facebookRelayClient');
const syncCheckpoint = require('./syncCheckpointService');

const PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'facebook']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function assertSignalActive(signal, code = 'PLATFORM_DRIVER_OPERATION_ABORTED') {
  if (!signal?.aborted) return;
  const reason = signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Platform driver operation aborted'), { code });
  if (!reason.code) reason.code = code;
  throw reason;
}
function unsupported(platform, operation) {
  const error = new Error(String(platform || 'unknown') + ' unsupported platform runtime operation: ' + String(operation || ''));
  error.code = 'PLATFORM_DRIVER_OPERATION_UNSUPPORTED';
  error.status = 409;
  error.platform = clean(platform).toLowerCase();
  error.operation = clean(operation);
  return error;
}
function withPersistedOperationContext(options = {}, work) {
  return syncCheckpoint.withPhysicalOperationContext(options.physicalOperationContext, work);
}
function normalizePlatform(value) {
  const platform = clean(value).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw unsupported(platform, 'resolve-driver');
  return platform;
}

function mautrixDriver(platform, adapter) {
  return Object.freeze({
    platform,
    adapter,
    protocolAuthority: adapter.protocolAuthority,
    resolveAccountKey(account) { return adapter.resolveAccountKey(account); },
    credentialState(account) { return adapter.credentialState(account); },
    status(account) { return adapter.status(account); },
    credentialReady(account) { return adapter.credentialReady(account); },
    async observe(account, options = {}) { return adapter.observe(account, options); },
    async connect(account, options = {}) { return adapter.connect(account, options); },
    async disconnect(account, options = {}) { return adapter.disconnect(account, options); },
    async sync(account, options = {}) {
      return withPersistedOperationContext(options, () => adapter.sync(account, options));
    },
    externalTarget(value) { return adapter.externalTarget(value); },
    adapterAccountId(account, requestedId = '') { return adapter.adapterAccountId(account, requestedId); },
    async getLoginFlows(account, options = {}) { return adapter.getLoginFlows(account, options); },
    async beginLogin(account, flowId, options = {}) { return adapter.beginLogin(account, flowId, options); },
    async submitLoginInput(account, loginProcessId, stepId, input, options = {}) {
      return adapter.submitLoginInput(account, loginProcessId, stepId, input, options);
    },
    async waitLoginStep(account, loginProcessId, stepId, options = {}) {
      return adapter.waitLoginStep(account, loginProcessId, stepId, options);
    },
    async cancelLogin(account, loginProcessId, options = {}) {
      return adapter.cancelLogin(account, loginProcessId, options);
    },
    isCompleteLoginResult(result) { return adapter.isCompleteLoginResult(result); },
    loginId(result) { return adapter.loginId(result); },
    async sendText(context, input) { return adapter.sendText(context, input); },
    async sendMedia(context, input) { return adapter.sendMedia(context, input); },
    async sendReaction(context, input) { return adapter.sendReaction(context, input); },
    async revokeMessage(context, input) { return adapter.revokeMessage(context, input); },
    async sendNativeExpression(context, input) { return adapter.sendNativeExpression(context, input); },
    async sendPresence(context, input) { return adapter.sendPresence(context, input); },
    async markRead(context, input) { return adapter.markRead(context, input); }
  });
}

const drivers = Object.freeze({
  whatsapp: mautrixDriver('whatsapp', mautrix.whatsapp),
  telegram: mautrixDriver('telegram', mautrix.telegram),
  facebook: Object.freeze({
    platform: 'facebook',
    adapter: facebookChatwoot,
    resolveAccountKey(account) { return facebookChatwoot.resolveAccountKey(account); },
    credentialState(account) { return facebookChatwoot.credentialState(account); },
    status(account) { return facebookChatwoot.status(account); },
    credentialReady(account) { return facebookChatwoot.credentialReady(account); },
    async connect(account, options = {}) { return facebookChatwoot.connect(account, options); },
    async disconnect(account, options = {}) {
      assertSignalActive(options.signal, 'FACEBOOK_DISCONNECT_ABORTED');
      const result = await facebookChatwoot.disconnect(account, options);
      assertSignalActive(options.signal, 'FACEBOOK_DISCONNECT_ABORTED');
      return result;
    },
    async sync(account, options = {}) {
      return withPersistedOperationContext(options, () => facebookChatwoot.sync(account, options));
    },
    async listFacebookPageInboxes(options = {}) {
      assertSignalActive(options.signal, 'FACEBOOK_CHATWOOT_DISCOVERY_ABORTED');
      return facebookChatwoot.discoverFacebookPageInboxes(options);
    },
    async resolveFacebookPageInbox(identity = {}, options = {}) {
      assertSignalActive(options.signal, 'FACEBOOK_CHATWOOT_DISCOVERY_ABORTED');
      return facebookChatwoot.resolveFacebookPageInbox(identity, options);
    },
    externalTarget(value) { return facebookChatwoot.externalTarget(value); },
    adapterAccountId(account, requestedId = '') {
      return facebookChatwoot.adapterAccountId(account, requestedId);
    },
    async sendText(context, input) { return facebookChatwoot.sendText(context, input); },
    async sendMedia(context, input) { return facebookChatwoot.sendMedia(context, input); },
    async sendPresence(context, input) { return facebookChatwoot.sendPresence(context, input); },
    async markRead(context, input = {}) { return facebookChatwoot.markRead(context, input); },
    async cacheWebhookAttachments(account, baseMessage, rawAttachments = [], options = {}) {
      return facebookRelayClient.cacheWebhookAttachments(account, baseMessage, rawAttachments, options);
    }
  })
});

const driverById = Object.freeze({
  'whatsapp-personal-mautrix-whatsapp': Object.freeze({
    ...drivers.whatsapp,
    driverId: 'whatsapp-personal-mautrix-whatsapp',
    accountKind: 'personal-multidevice',
    official: false,
    supportLevel: 'production',
    messagingSupported: true,
    riskDisclosureRequired: false,
    protocolAuthority: 'mautrix-whatsapp',
    isolationModel: 'matrix-application-service',
    preserveLocalRuntimeCredentialOnLogout: true
  }),
  'telegram-personal-mautrix-telegram': Object.freeze({
    ...drivers.telegram,
    driverId: 'telegram-personal-mautrix-telegram',
    accountKind: 'personal',
    official: false,
    supportLevel: 'production',
    messagingSupported: true,
    riskDisclosureRequired: false,
    protocolAuthority: 'mautrix-telegram',
    isolationModel: 'matrix-application-service',
    preserveLocalRuntimeCredentialOnLogout: true
  }),
  'facebook-page-official': Object.freeze({
    ...drivers.facebook,
    adapter: facebookChatwoot,
    driverId: 'facebook-page-official',
    accountKind: 'page',
    official: true,
    supportLevel: 'production',
    messagingSupported: true,
    riskDisclosureRequired: false,
    isolationModel: 'chatwoot-facebook-page-sidecar'
  }),
  'facebook-personal-identity-official': Object.freeze({
    platform: 'facebook',
    adapter: facebookPersonalIdentity,
    driverId: 'facebook-personal-identity-official',
    accountKind: 'personal-identity',
    official: true,
    supportLevel: 'identity-only',
    messagingSupported: false,
    riskDisclosureRequired: false,
    isolationModel: 'oauth-identity',
    resolveAccountKey(account) { return clean(account?.id); },
    credentialState() { return null; },
    status(account) { return facebookPersonalIdentity.status(account); },
    credentialReady(account, secret = {}) { return facebookPersonalIdentity.credentialReady(account, secret); },
    async connect(account, options = {}) { return facebookPersonalIdentity.connect(account, options); },
    async disconnect(account, options = {}) { return facebookPersonalIdentity.disconnect(account, options); },
    async sync(account, options = {}) {
      return withPersistedOperationContext(options, () => facebookPersonalIdentity.sync(account, options));
    },
    externalTarget(value) { return clean(value).replace(/^facebook:/i, ''); },
    adapterAccountId(account, requestedId = '') { return clean(account?.id || requestedId); },
    sendText(context, input) { return facebookPersonalIdentity.sendText(context, input); },
    sendMedia(context, input) { return facebookPersonalIdentity.sendMedia(context, input); },
    sendPresence(context, input) { return facebookPersonalIdentity.sendPresence(context, input); },
    markRead(context, input) { return facebookPersonalIdentity.markRead(context, input); }
  }),
  'facebook-personal-messenger-mautrix-meta': Object.freeze({
    ...mautrixDriver('facebook', mautrix.facebook),
    driverId: 'facebook-personal-messenger-mautrix-meta',
    accountKind: 'personal-messenger',
    official: false,
    supportLevel: 'production',
    messagingSupported: true,
    riskDisclosureRequired: false,
    protocolAuthority: 'mautrix-meta',
    isolationModel: 'matrix-application-service',
    preserveLocalRuntimeCredentialOnLogout: true
  })
});

function resolveDriverId(account = {}) {
  const platform = normalizePlatform(account.platform);
  const explicit = clean(account?.metadata?.driverId || account?.driverId);
  if (explicit) {
    if (!driverById[explicit]) throw unsupported(platform, 'resolve-driver:' + explicit);
    return explicit;
  }
  const kind = clean(account?.metadata?.accountKind || account?.accountKind).toLowerCase();
  if (platform === 'facebook') {
    if (kind === 'personal-identity') return 'facebook-personal-identity-official';
    if (kind === 'personal-messenger') return 'facebook-personal-messenger-mautrix-meta';
    return 'facebook-page-official';
  }
  if (platform === 'telegram') return 'telegram-personal-mautrix-telegram';
  return 'whatsapp-personal-mautrix-whatsapp';
}
function getForAccount(account = {}) {
  return driverById[resolveDriverId(account)];
}

function driverContracts() {
  return Object.fromEntries(Object.entries(driverById).map(([driverId, driver]) => {
    const featureEnabled = typeof driver.adapter?.enabled === 'function'
      ? driver.adapter.enabled()
      : true;
    return [driverId, {
      driverId,
      platform: driver.platform,
      accountKind: driver.accountKind,
      official: driver.official === true,
      supportLevel: driver.supportLevel,
      messagingSupported: driver.messagingSupported === true,
      riskDisclosureRequired: driver.riskDisclosureRequired === true,
      isolationModel: driver.isolationModel,
      protocolAuthority: clean(driver.protocolAuthority),
      featureEnabled,
      onboardingAvailable: featureEnabled,
      onboardingReason: !featureEnabled ? 'FEATURE_FLAG_DISABLED' : '',
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
    operations: Object.keys(driver)
      .filter(key => typeof driver[key] === 'function'
        && !['externalTarget', 'adapterAccountId', 'resolveAccountKey', 'credentialState', 'credentialReady', 'status'].includes(key))
      .sort()
  }]));
}

module.exports = {
  PLATFORMS,
  drivers,
  driverById,
  get,
  getForAccount,
  resolveDriverId,
  call,
  contracts,
  driverContracts,
  unsupported,
  normalizePlatform
};
