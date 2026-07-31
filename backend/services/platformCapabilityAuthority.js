'use strict';

const platformContracts = require('./platformCapabilities');
const productionReadiness = require('./platformProductionReadinessAuthority');

const SCHEMA_VERSION = 1;
const AUTHORITY = 'PlatformCapabilityAuthority';

const SUPPORT = Object.freeze({
  SUPPORTED: 'supported',
  CONSTRAINED: 'constrained',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown'
});

const AVAILABILITY = Object.freeze({
  READY: 'ready',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  ONBOARDING: 'onboarding',
  NOT_CONFIGURED: 'not-configured',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown'
});

const SCOPE = Object.freeze({
  GLOBAL: 'global',
  PLATFORM: 'platform',
  ACCOUNT: 'account',
  CAPABILITY: 'capability'
});

const LEGACY_TO_CANONICAL = Object.freeze({
  text: 'message.text.send',
  image: 'message.media.image.send',
  video: 'message.media.video.send',
  gif: 'message.media.gif.send',
  sticker: 'message.media.sticker.send',
  animatedSticker: 'message.media.animated_sticker.send',
  lottieSticker: 'message.media.lottie_sticker.display',
  animatedEmojiDisplay: 'message.animated_emoji.display',
  voice: 'message.media.voice.send',
  file: 'message.media.file.send',
  quote: 'message.quote.send',
  reaction: 'message.reaction.send',
  revoke: 'message.revoke',
  readReceipt: 'message.read_receipt.send',
  typingSend: 'presence.typing.send',
  incomingTyping: 'presence.typing.receive',
  terminalPresence: 'presence.contact.receive',
  contacts: 'contacts.sync',
  groups: 'conversation.group',
  proactiveSend: 'message.proactive.send',
  historySync: 'history.sync'
});

const CANONICAL_TO_LEGACY = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_TO_CANONICAL).map(([legacy, canonical]) => [canonical, legacy])
));

const EXTRA_DEFINITIONS = Object.freeze({
  facebook: Object.freeze({
    'auth.page_token': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'auth', note: 'Facebook Page 消息链需要 Page Token 与云端授权。' }),
    'auth.qr': Object.freeze({ support: SUPPORT.UNSUPPORTED, direction: 'auth', note: 'Facebook Page 不使用二维码登录。' }),
    'identity.merge': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'identity', note: 'Page/PSID 身份可审计绑定，跨平台 Person 合并需额外证据。' }),
    'reconcile.external': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'reconcile', note: 'Business Suite Echo、新会话与历史补偿受权限和消息窗口限制。' }),
    'message.emoji.send': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'egress', note: 'Emoji-only 必须由独立真实平台 ACK 验证，不能继承普通文本发送结果。' })
  }),
  whatsapp: Object.freeze({
    'auth.qr': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'auth', note: 'WhatsApp 支持二维码认证和会话恢复。' }),
    'auth.page_token': Object.freeze({ support: SUPPORT.UNSUPPORTED, direction: 'auth', note: 'WhatsApp 不使用 Facebook Page Token。' }),
    'identity.merge': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'identity', note: 'LID、phone-JID 与历史别名由身份权威对账。' }),
    'reconcile.external': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'reconcile', note: '身份、离线队列与重连结果需要独立对账。' }),
    'message.emoji.send': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'egress', note: 'Emoji-only 必须由独立真实平台 ACK 验证，不能继承普通文本发送结果。' })
  }),
  telegram: Object.freeze({
    'auth.qr': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'auth', note: 'Telegram 支持二维码登录。' }),
    'auth.code': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'auth', note: 'Telegram 支持手机号、验证码与两步验证状态机。' }),
    'auth.password': Object.freeze({ support: SUPPORT.SUPPORTED, direction: 'auth', note: 'Telegram 两步验证需要密码阶段。' }),
    'auth.page_token': Object.freeze({ support: SUPPORT.UNSUPPORTED, direction: 'auth', note: 'Telegram 不使用 Facebook Page Token。' }),
    'identity.merge': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'identity', note: 'Telegram user id 可作为平台身份链接，跨平台合并必须由证据确认。' }),
    'reconcile.external': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'reconcile', note: '历史 catch-up 与实时更新分层执行。' }),
    'message.emoji.send': Object.freeze({ support: SUPPORT.CONSTRAINED, direction: 'egress', note: 'Emoji-only 必须由独立真实平台 ACK 验证，不能继承普通文本发送结果。' })
  })
});

const SEND_CAPABILITIES = new Set([
  'message.text.send', 'message.emoji.send', 'message.media.image.send', 'message.media.video.send',
  'message.media.gif.send', 'message.media.sticker.send', 'message.media.animated_sticker.send',
  'message.media.voice.send', 'message.media.file.send', 'message.quote.send',
  'message.reaction.send', 'message.revoke', 'message.read_receipt.send',
  'presence.typing.send', 'message.proactive.send'
]);


const DELIVERY_ACK_CAPABILITIES = new Set([
  'message.text.send', 'message.emoji.send', 'message.media.image.send', 'message.media.video.send',
  'message.media.gif.send', 'message.media.sticker.send', 'message.media.animated_sticker.send',
  'message.media.voice.send', 'message.media.file.send', 'message.reaction.send', 'message.revoke',
  'message.proactive.send', 'message.quote.send'
]);
const DELIVERY_ACK_ALIASES = Object.freeze({
  'message.proactive.send': 'message.text.send',
  'message.quote.send': 'message.text.send'
});

const RECEIVE_CAPABILITIES = new Set([
  'presence.typing.receive', 'presence.contact.receive', 'contacts.sync', 'history.sync',
  'message.media.lottie_sticker.display', 'message.animated_emoji.display'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function platformOf(value) { return clean(value).toLowerCase(); }
function canonicalCapabilityId(value) {
  const candidate = clean(value);
  return LEGACY_TO_CANONICAL[candidate] || candidate;
}
function legacyCapabilityId(value) {
  const candidate = clean(value);
  return CANONICAL_TO_LEGACY[candidate] || candidate;
}
function isOnboarding(account = {}) {
  return ['unconfigured', 'waiting-verification', 'logged-out', 'paused', 'connecting'].includes(platformOf(account.state));
}
function supportFromContract(contract = {}) {
  if (!contract || typeof contract !== 'object') return SUPPORT.UNKNOWN;
  if (contract.state === platformContracts.STATE.UNSUPPORTED) return SUPPORT.UNSUPPORTED;
  if (contract.state === platformContracts.STATE.SUPPORTED) return SUPPORT.SUPPORTED;
  if ([platformContracts.STATE.PARTIAL, platformContracts.STATE.POLICY, platformContracts.STATE.PERMISSION].includes(contract.state)) return SUPPORT.CONSTRAINED;
  return SUPPORT.UNKNOWN;
}
function directionFor(capabilityId) {
  if (SEND_CAPABILITIES.has(capabilityId)) return 'egress';
  if (RECEIVE_CAPABILITIES.has(capabilityId)) return capabilityId === 'history.sync' || capabilityId === 'contacts.sync' ? 'reconcile' : 'ingress';
  if (capabilityId.startsWith('auth.')) return 'auth';
  if (capabilityId.startsWith('identity.')) return 'identity';
  if (capabilityId.startsWith('reconcile.')) return 'reconcile';
  return 'domain';
}
function definition(platform, legacyId, contract = {}) {
  const capabilityId = canonicalCapabilityId(legacyId);
  return {
    capabilityId,
    legacyId,
    platform,
    support: supportFromContract(contract),
    direction: directionFor(capabilityId),
    route: clean(contract.route),
    adapterMethod: clean(contract.adapterMethod),
    note: clean(contract.note),
    constraints: Array.isArray(contract.constraints) ? [...contract.constraints] : []
  };
}
function definitionsForPlatform(platform) {
  const id = platformOf(platform);
  const fromContracts = Object.entries(platformContracts.publicContracts(id) || {}).map(([legacyId, contract]) => definition(id, legacyId, contract));
  const extras = Object.entries(EXTRA_DEFINITIONS[id] || {}).map(([capabilityId, item]) => ({
    capabilityId,
    legacyId: '',
    platform: id,
    support: item.support,
    direction: item.direction || directionFor(capabilityId),
    route: '',
    adapterMethod: '',
    note: clean(item.note),
    constraints: []
  }));
  return [...fromContracts, ...extras].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}
function readinessCheckMap(account = {}) {
  return new Map(productionReadiness.accountChecks(account).map(item => [clean(item.id), item]));
}
function checkForCapability(capabilityId, checks) {
  if (SEND_CAPABILITIES.has(capabilityId)) return checks.get('send') || null;
  if (capabilityId === 'history.sync') return checks.get('history') || null;
  if (capabilityId === 'contacts.sync') return checks.get('history') || checks.get('receive') || null;
  if (capabilityId === 'identity.merge') return checks.get('identity') || null;
  if (capabilityId === 'reconcile.external') return checks.get('reconciliation') || checks.get('identity') || checks.get('history') || null;
  if (capabilityId.startsWith('auth.')) return checks.get('credential') || null;
  if (RECEIVE_CAPABILITIES.has(capabilityId)) return checks.get('receive') || null;
  return null;
}
function sendAttemptReady(account = {}) {
  return account.canAttemptSend === true || (account.canAttemptSend == null && account.canSend === true);
}
function deliveryAckFor(account = {}, capabilityId = '') {
  const canonical = DELIVERY_ACK_ALIASES[capabilityId] || capabilityId;
  return account.deliveryTruth?.capabilities?.[canonical] || null;
}
function reasonCodeFrom({ support, capabilityId = '', account = {}, check = null, legacyAvailability = null }) {
  if (support === SUPPORT.UNSUPPORTED) return 'PLATFORM_CAPABILITY_UNSUPPORTED';
  if (String(capabilityId).startsWith('auth.') && isOnboarding(account)) return 'AUTHENTICATION_ACTION_AVAILABLE';
  if (isOnboarding(account)) return `ACCOUNT_${platformOf(account.state || 'onboarding').replace(/[^a-z0-9]+/g, '_').toUpperCase()}`;
  if (SEND_CAPABILITIES.has(capabilityId)) {
    if (!sendAttemptReady(account)) return 'ACCOUNT_SEND_PREFLIGHT_BLOCKED';
    if (DELIVERY_ACK_CAPABILITIES.has(capabilityId)) {
      const deliveryAck = deliveryAckFor(account, capabilityId);
      if (deliveryAck?.availability === AVAILABILITY.BLOCKED) return clean(deliveryAck.reasonCode) || 'REAL_PLATFORM_ACK_FAILED';
      if (deliveryAck?.availability !== AVAILABILITY.READY) return 'REAL_PLATFORM_ACK_REQUIRED';
    }
  }
  if (check?.status === 'fail') return `CAPABILITY_${clean(check.id).replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_FAILED`;
  if (check?.status === 'warning') return `CAPABILITY_${clean(check.id).replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_DEGRADED`;
  if (legacyAvailability?.availableNow === false) return clean(legacyAvailability.reason).replace(/[^a-z0-9]+/gi, '_').toUpperCase() || 'ACCOUNT_CAPABILITY_UNAVAILABLE';
  return '';
}
function availabilityFor(definitionRow, account = {}) {
  const support = definitionRow.support;
  if (support === SUPPORT.UNSUPPORTED) return AVAILABILITY.UNSUPPORTED;
  if (support === SUPPORT.UNKNOWN) return AVAILABILITY.UNKNOWN;
  if (SEND_CAPABILITIES.has(definitionRow.capabilityId)) {
    if (isOnboarding(account)) return AVAILABILITY.ONBOARDING;
    if (!sendAttemptReady(account)) return AVAILABILITY.BLOCKED;
    if (!DELIVERY_ACK_CAPABILITIES.has(definitionRow.capabilityId)) return AVAILABILITY.READY;
    const deliveryAck = deliveryAckFor(account, definitionRow.capabilityId);
    if (deliveryAck?.availability === AVAILABILITY.BLOCKED) return AVAILABILITY.BLOCKED;
    if (deliveryAck?.availability === AVAILABILITY.READY && deliveryAck?.evidence?.ackStatus === 'accepted') return AVAILABILITY.READY;
    return AVAILABILITY.DEGRADED;
  }
  if (definitionRow.capabilityId.startsWith('auth.')) {
    if (definitionRow.capabilityId === 'auth.page_token') return account.credentialReady === true ? AVAILABILITY.READY : (isOnboarding(account) ? AVAILABILITY.DEGRADED : AVAILABILITY.BLOCKED);
    if (definitionRow.capabilityId === 'auth.qr') return account.qrReady === true || account.credentialReady === true ? AVAILABILITY.READY : AVAILABILITY.DEGRADED;
    if (definitionRow.capabilityId === 'auth.code' || definitionRow.capabilityId === 'auth.password') return account.credentialReady === true ? AVAILABILITY.READY : AVAILABILITY.DEGRADED;
  }
  if (isOnboarding(account)) return AVAILABILITY.ONBOARDING;
  const checks = readinessCheckMap(account);
  const check = checkForCapability(definitionRow.capabilityId, checks);
  const legacyAvailability = definitionRow.legacyId ? account.capabilityAvailability?.[definitionRow.legacyId] : null;
  if (check?.status === 'fail') return AVAILABILITY.BLOCKED;
  if (check?.status === 'warning' || check?.status === 'pending') return AVAILABILITY.DEGRADED;
  if (legacyAvailability?.availableNow === false) return AVAILABILITY.BLOCKED;
  return AVAILABILITY.READY;
}
function capabilityObservation(account, definitionRow) {
  const checks = readinessCheckMap(account);
  const check = checkForCapability(definitionRow.capabilityId, checks);
  const legacyAvailability = definitionRow.legacyId ? account.capabilityAvailability?.[definitionRow.legacyId] : null;
  const availability = availabilityFor(definitionRow, account);
  const reasonCode = reasonCodeFrom({ support: definitionRow.support, capabilityId: definitionRow.capabilityId, account, check, legacyAvailability });
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    scopeType: SCOPE.CAPABILITY,
    scopeId: [platformOf(account.platform), clean(account.id), definitionRow.capabilityId].join(':'),
    platform: platformOf(account.platform),
    accountId: clean(account.id),
    capabilityId: definitionRow.capabilityId,
    legacyId: definitionRow.legacyId,
    support: definitionRow.support,
    availability,
    enabled: availability === AVAILABILITY.READY || availability === AVAILABILITY.DEGRADED,
    degraded: availability === AVAILABILITY.DEGRADED,
    reasonCode,
    reason: clean(check?.detail || legacyAvailability?.reason || definitionRow.note),
    constraints: [...definitionRow.constraints],
    evidence: {
      readinessCheck: check ? { id: check.id, status: check.status, evidence: check.evidence || {} } : null,
      deliveryAck: deliveryAckFor(account, definitionRow.capabilityId),
      canAttemptSend: sendAttemptReady(account),
      declaredContract: {
        route: definitionRow.route,
        adapterMethod: definitionRow.adapterMethod,
        support: definitionRow.support
      },
      accountState: clean(account.state),
      observedAt: new Date().toISOString()
    }
  };
}
function aggregateAvailability(observations = [], fallback = AVAILABILITY.UNKNOWN) {
  if (!observations.length) return fallback;
  const values = observations.map(row => row.availability);
  const relevant = values.filter(value => value !== AVAILABILITY.UNSUPPORTED);
  if (!relevant.length) return AVAILABILITY.UNSUPPORTED;
  const ready = relevant.filter(value => value === AVAILABILITY.READY).length;
  const degraded = relevant.filter(value => value === AVAILABILITY.DEGRADED).length;
  const blocked = relevant.filter(value => value === AVAILABILITY.BLOCKED).length;
  const onboarding = relevant.filter(value => value === AVAILABILITY.ONBOARDING).length;
  const notConfigured = relevant.filter(value => value === AVAILABILITY.NOT_CONFIGURED).length;
  const unknown = relevant.filter(value => value === AVAILABILITY.UNKNOWN).length;
  if (blocked === relevant.length) return AVAILABILITY.BLOCKED;
  if (onboarding === relevant.length) return AVAILABILITY.ONBOARDING;
  if (notConfigured === relevant.length) return AVAILABILITY.NOT_CONFIGURED;
  if (ready === relevant.length) return AVAILABILITY.READY;
  if (ready || degraded || blocked || onboarding) return AVAILABILITY.DEGRADED;
  if (unknown === relevant.length) return AVAILABILITY.UNKNOWN;
  return fallback;
}
function projectAccount(account = {}) {
  const platform = platformOf(account.platform);
  const capabilities = definitionsForPlatform(platform).map(item => capabilityObservation(account, item));
  const operationalCapabilities = capabilities.filter(item => directionFor(item.capabilityId) !== 'auth');
  const accountAvailability = aggregateAvailability(operationalCapabilities, isOnboarding(account) ? AVAILABILITY.ONBOARDING : AVAILABILITY.UNKNOWN);
  return {
    scopeType: SCOPE.ACCOUNT,
    scopeId: `${platform}:${clean(account.id)}`,
    platform,
    accountId: clean(account.id),
    displayName: clean(account.displayName || account.identityLabel || account.user?.name),
    state: clean(account.state),
    availability: accountAvailability,
    capabilities,
    counts: {
      ready: capabilities.filter(item => item.availability === AVAILABILITY.READY).length,
      degraded: capabilities.filter(item => item.availability === AVAILABILITY.DEGRADED).length,
      blocked: capabilities.filter(item => item.availability === AVAILABILITY.BLOCKED).length,
      unsupported: capabilities.filter(item => item.availability === AVAILABILITY.UNSUPPORTED).length,
      onboarding: capabilities.filter(item => item.availability === AVAILABILITY.ONBOARDING).length
    }
  };
}
function evaluate(accountState = {}, options = {}) {
  const allAccounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
  const platformFilter = platformOf(options.platform);
  const accountFilter = clean(options.accountId);
  const accounts = allAccounts.filter(account => (!platformFilter || platformOf(account.platform) === platformFilter) && (!accountFilter || clean(account.id) === accountFilter));
  const platforms = {};
  for (const platform of productionReadiness.PLATFORM_ORDER) {
    if (platformFilter && platform !== platformFilter) continue;
    const rows = accounts.filter(account => platformOf(account.platform) === platform).map(projectAccount);
    platforms[platform] = {
      scopeType: SCOPE.PLATFORM,
      scopeId: platform,
      platform,
      availability: rows.length ? aggregateAvailability(rows.map(row => ({ availability: row.availability }))) : AVAILABILITY.NOT_CONFIGURED,
      accounts: rows,
      definitions: definitionsForPlatform(platform),
      counts: {
        accounts: rows.length,
        ready: rows.filter(row => row.availability === AVAILABILITY.READY).length,
        degraded: rows.filter(row => row.availability === AVAILABILITY.DEGRADED).length,
        blocked: rows.filter(row => row.availability === AVAILABILITY.BLOCKED).length,
        onboarding: rows.filter(row => row.availability === AVAILABILITY.ONBOARDING).length
      }
    };
  }
  const configured = Object.values(platforms).filter(row => row.availability !== AVAILABILITY.NOT_CONFIGURED);
  return {
    schemaVersion: SCHEMA_VERSION,
    documentType: 'YANCE_PLATFORM_CAPABILITY_AUTHORITY',
    authority: AUTHORITY,
    generatedAt: new Date().toISOString(),
    global: {
      scopeType: SCOPE.GLOBAL,
      scopeId: 'yance',
      health: configured.length ? AVAILABILITY.READY : AVAILABILITY.NOT_CONFIGURED,
      platformFailuresDoNotEscalateToGlobal: true,
      coreHealthSource: 'SystemHealthAuthority',
      note: '平台或账号失败只影响对应范围；进程、数据库与核心队列健康由 SystemHealthAuthority 判定。'
    },
    platforms,
    summary: {
      configuredPlatforms: configured.length,
      blockedPlatforms: configured.filter(row => row.availability === AVAILABILITY.BLOCKED).length,
      degradedPlatforms: configured.filter(row => row.availability === AVAILABILITY.DEGRADED).length,
      onboardingPlatforms: configured.filter(row => row.availability === AVAILABILITY.ONBOARDING).length
    }
  };
}
function decision(accountState = {}, input = {}) {
  const platform = platformOf(input.platform);
  const accountId = clean(input.accountId);
  const capabilityId = canonicalCapabilityId(input.capabilityId || input.capability || input.name);
  const projection = evaluate(accountState, { platform, accountId });
  const account = projection.platforms?.[platform]?.accounts?.find(row => !accountId || row.accountId === accountId);
  const observation = account?.capabilities?.find(row => row.capabilityId === capabilityId) || null;
  if (observation) return observation;
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    scopeType: SCOPE.CAPABILITY,
    scopeId: [platform, accountId, capabilityId].filter(Boolean).join(':'),
    platform,
    accountId,
    capabilityId,
    legacyId: legacyCapabilityId(capabilityId),
    support: SUPPORT.UNKNOWN,
    availability: account ? AVAILABILITY.UNKNOWN : AVAILABILITY.NOT_CONFIGURED,
    enabled: false,
    degraded: false,
    reasonCode: account ? 'CAPABILITY_NOT_DECLARED' : 'ACCOUNT_NOT_CONFIGURED',
    reason: account ? '当前平台没有声明该能力。' : '当前账号尚未配置。',
    constraints: [],
    evidence: { readinessCheck: null, declaredContract: null, accountState: clean(account?.state), observedAt: new Date().toISOString() }
  };
}

module.exports = { DELIVERY_ACK_CAPABILITIES, DELIVERY_ACK_ALIASES,
  SCHEMA_VERSION,
  AUTHORITY,
  SUPPORT,
  AVAILABILITY,
  SCOPE,
  LEGACY_TO_CANONICAL,
  CANONICAL_TO_LEGACY,
  canonicalCapabilityId,
  legacyCapabilityId,
  definitionsForPlatform,
  capabilityObservation,
  projectAccount,
  evaluate,
  decision,
  aggregateAvailability
};
