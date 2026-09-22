'use strict';

const crypto = require('crypto');
const accountStore = require('./accountStore');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const systemPolicy = require('./systemPolicy');
const platformDrivers = require('./platformDriverRegistry');
const facebookOAuth = require('./facebookOAuthService');
const messageStore = require('./messageStore');
const eventBus = require('./eventBus');
const logger = require('./logger');
const notificationPolicy = require('./notificationPolicy');
const sendQueue = require('./sendQueueService');
const { stateLabel, healthFromState } = require('./accountState');
const accountLifecycle = require('./accountLifecycle');
const canonicalIdentity = require('./canonicalIdentityService');
const { safeDisplayName, normalizeJid, normalizePhone } = require('./whatsappIdentity');
const platformAuthConfig = require('./platformAuthConfig');
const authChallenges = require('./authChallengeService');
const { buildAccountSummary } = require('./accountSummaryProjection');
const { evaluateAccountDiagnostic } = require('./accountDiagnosticPolicy');
const facebookBusinessSuiteAvatarImport = require('./facebookBusinessSuiteAvatarImportService');
const platformDeliveryAuthority = require('./platformDeliveryAuthority').singleton;
const accountLifecycleSaga = require('./accountLifecycleSagaService').singleton;

const { MATRIX: CAPABILITY_MATRIX, publicContracts, resolveForAccount } = require('./platformCapabilities');
const RECEIVE_DEPENDENT_CAPABILITIES = new Set(['incomingTyping', 'terminalPresence', 'contacts', 'historySync', 'lottieSticker', 'animatedEmojiDisplay']);
const BIDIRECTIONAL_CAPABILITIES = new Set(['sticker', 'animatedSticker']);

function driverFor(account) { return platformDrivers.getForAccount ? platformDrivers.getForAccount(account) : platformDrivers.get(account.platform); }
function matureLifecycleAuthority(driver = {}) {
  return Boolean(String(driver.protocolAuthority || '').trim())
    || String(driver.isolationModel || '').trim() === 'chatwoot-facebook-page-sidecar';
}

function observedMatureBridgeLoginId(row = {}, platform = '') {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const explicit = String(metadata.mautrixLoginId || metadata.mautrixMetaLoginId || '').trim();
  if (explicit) return explicit;
  if (String(platform || row.platform || '').trim().toLowerCase() === 'telegram') {
    return String(metadata.liveUser?.id || '').trim();
  }
  return '';
}

function isSyntheticMatureBridgeProjection(row = {}) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return String(row.source || '').trim() === 'mature-bridge-projection'
    || String(metadata.projectionSource || '').trim() === 'mautrix-whoami';
}

function logCriticalFailure(operation, error, detail = {}) {
  logger.warn('accounts', 'critical-operation-failed', {
    operation,
    accountId: String(detail.accountId || ''),
    conversationId: String(detail.conversationId || ''),
    reasonCode: String(error?.code || detail.reasonCode || 'ACCOUNT_OPERATION_FAILED'),
    httpStatus: Number(error?.status || error?.httpStatus || 0),
    attempt: Number(detail.attempt || error?.attempt || 1),
    nextRetryAt: String(detail.nextRetryAt || error?.nextRetryAt || ''),
    error: String(error?.message || error || ''),
    ...detail
  });
}

function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function withAbortSignal(promise, signal, fallbackCode = 'ACCOUNT_OPERATION_ABORTED') {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    return Promise.reject(operationAbortError(signal, fallbackCode));
  }
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      reject(operationAbortError(signal, fallbackCode));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([Promise.resolve(promise), aborted])
    .finally(() => signal.removeEventListener?.('abort', onAbort));
}


function operationAbortError(signal, fallbackCode = 'ACCOUNT_OPERATION_ABORTED') {
  const reason = signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Account operation aborted'), { code: fallbackCode });
  if (!reason.code) reason.code = fallbackCode;
  return reason;
}

function assertOperationActive(signal, fallbackCode = 'ACCOUNT_OPERATION_ABORTED') {
  if (signal?.aborted) throw operationAbortError(signal, fallbackCode);
}

class AccountManager {
  constructor() {
    this.runtime = new Map();
    this.hydration = { phase: 'booting', ready: false, startedAt: new Date().toISOString(), completedAt: '', errorCode: '' };
    eventBus.on('whatsapp:state', event => this.onWhatsAppEvent(event.payload || {}));
    eventBus.on('whatsapp:qr', event => this.onWhatsAppEvent({ ...(event.payload || {}), state: 'qr' }));
    eventBus.on('account:state', event => this.onAdapterState(event.payload || {}));
    securityGuard.onCredentialChanged( () => this.publishSummary());
  }

  beginHydration() {
    this.hydration = { phase: 'account-reconciling', ready: false, startedAt: new Date().toISOString(), completedAt: '', errorCode: '' };
    return { ...this.hydration };
  }

  async hydrateAndRecover() {
    if (this.hydration.ready && this.hydration.phase === 'ready') return { ...this.hydration };
    try {
      await accountStore.migrateRetiredDriverIds?.();
      for (const account of accountStore.listAll()) {
        try { driverFor(account).status(account); }
        catch (error) {
          logCriticalFailure('platformDriver.status.hydration', error, { accountId: account.id, platform: account.platform });
        }
      }
      this.hydration = { ...this.hydration, phase: 'ready', ready: true, completedAt: new Date().toISOString(), errorCode: '' };
      this.publishSummary();
      return { ...this.hydration };
    } catch (error) {
      this.hydration = { ...this.hydration, phase: 'degraded', ready: false, completedAt: new Date().toISOString(), errorCode: error.code || 'ACCOUNT_HYDRATION_FAILED' };
      throw error;
    }
  }

  whatsappAuthKey(account) {
    try { return platformDrivers.get('whatsapp').resolveAccountKey(account); } catch (error) { logCriticalFailure('whatsapp.resolveAccountKey', error, { accountId: account?.id || account?.adapterAccountId || '' }); return account?.adapterAccountId || ''; }
  }

  accountUnread(accountId) {
    const account = accountStore.get(accountId);
    const authKey = account?.platform === 'whatsapp' ? this.whatsappAuthKey(account) : '';
    return messageStore.listConversations().filter(row => row.accountId === accountId || row.accountId === account?.adapterAccountId || (authKey && row.accountId === authKey)).reduce((sum, row) => sum + Number(row.unread || 0), 0);
  }

  rawRuntime(account) {
    try {
      const ownerState = driverFor(account).status(account);
      return ownerState || this.runtime.get(account.id) || {
        state: account.paused ? 'paused' : 'logged-out',
        lastError: '',
        connectedAt: '',
        user: null
      };
    } catch (error) {
      logCriticalFailure('platformDriver.status', error, { accountId: account?.id || '', platform: account?.platform || '' });
      return this.runtime.get(account.id) || { state: 'unconfigured', lastError: error.message || '' };
    }
  }

  publicAccount(account, runtimeOverride = null) {
    if (!this.hydration.ready) {
      return {
        ...account,
        state: 'recovering',
        stateLabel: '正在恢复账号状态',
        health: 'degraded',
        canAttemptSend: false,
        sendVerified: false,
        canSend: false,
        canReceive: false,
        sendReadiness: 'recovering',
        authorityPending: true,
        hydrationPhase: this.hydration.phase,
        hydrationErrorCode: this.hydration.errorCode || ''
      };
    }
    const runtime = runtimeOverride || this.rawRuntime(account);
    const runtimeState = String(runtime.state || 'unconfigured').trim().toLowerCase();
    const explicitlyLoggedOut = ['logged-out', 'logged_out'].includes(runtimeState) || account.metadata?.loggedOut === true;
    const state = explicitlyLoggedOut ? 'logged-out' : (account.paused ? 'paused' : runtimeState);
    const authorizationPending = account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true;
    const latestSaga = accountLifecycleSaga.latest(account.id);
    const projectedLifecycleSaga = latestSaga && !['connect', 'disconnect', 'logout'].includes(String(latestSaga.operation_type || latestSaga.operationType || '').toLowerCase())
      ? latestSaga
      : null;
    const lifecycleAuthorityPending = Boolean(projectedLifecycleSaga && ['running', 'compensating', 'manual_review'].includes(projectedLifecycleSaga.state));
    const authorityPending = authorizationPending || lifecycleAuthorityPending;
    const unread = this.accountUnread(account.id);
    const driver = driverFor(account);
    const whatsappCredential = account.platform === 'whatsapp' ? driver.credentialState(account) : null;
    const platformSecret = account.platform === 'whatsapp' ? null : (securityGuard.credentials.get(account.credentialRef) || {});
    const credentialReady = driver.credentialReady(account, platformSecret);
    const messagingSupported = driver.messagingSupported !== false;
    const accountCapabilityProfile = resolveForAccount(account);
    const capabilities = messagingSupported
      ? Object.fromEntries(Object.entries(CAPABILITY_MATRIX[account.platform] || {}).map(([name, declared]) => [name, Object.prototype.hasOwnProperty.call(accountCapabilityProfile, name) ? accountCapabilityProfile[name] : declared]))
      : Object.fromEntries(Object.keys(CAPABILITY_MATRIX[account.platform] || {}).map(name => [name, false]));
    const personalMessenger = account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || '').toLowerCase() === 'personal-messenger';
    const directChallenge = ['whatsapp', 'telegram'].includes(account.platform)
      ? authChallenges.status(account.id)
      : { ready: false, expiresAt: '', version: 0 };
    const challengeStatus = directChallenge.ready || account.platform !== 'whatsapp'
      ? directChallenge
      : authChallenges.status(this.whatsappAuthKey(account));
    const connectedNow = state === 'connected' || state === 'limited';
    const runtimeSendReady = typeof runtime.canAttemptSend === 'boolean'
      ? runtime.canAttemptSend
      : (typeof runtime.canSend === 'boolean' ? runtime.canSend : connectedNow);
    const canAttemptSend = authorityPending || !messagingSupported ? false : Boolean(runtimeSendReady && credentialReady && connectedNow);
    const canReceive = authorityPending || !messagingSupported ? false : (typeof runtime.canReceive === 'boolean' ? runtime.canReceive : connectedNow);
    const deliveryTruth = platformDeliveryAuthority.accountTruth({ platform: account.platform, accountId: account.id });
    const sendVerified = Boolean(canAttemptSend && deliveryTruth.sendVerified === true);
    const canSend = sendVerified;
    const sendReadiness = !canAttemptSend ? 'blocked' : sendVerified ? 'verified' : deliveryTruth.status === 'failed' ? 'failed' : 'probe-required';
    const capabilityAvailability = Object.fromEntries(Object.entries(capabilities).map(([name, declared]) => {
      const runtimeReady = BIDIRECTIONAL_CAPABILITIES.has(name) ? (canAttemptSend && canReceive) : RECEIVE_DEPENDENT_CAPABILITIES.has(name) ? canReceive : canAttemptSend;
      return [name, {
        declared,
        availableNow: runtimeReady && declared !== false,
        reason: declared === false ? 'platform-unsupported' : (runtimeReady ? 'ready' : `account-${state}`)
      }];
    }));
    return {
      ...account,
      driverId: driver.driverId || account.driverId || account.metadata?.driverId || '',
      accountKind: driver.accountKind || account.accountKind || account.metadata?.accountKind || '',
      officialDriver: driver.official === true,
      supportLevel: driver.supportLevel || 'production',
      messagingSupported,
      riskDisclosureRequired: driver.riskDisclosureRequired === true,
      isolationModel: driver.isolationModel || '',
      authorizationPending,
      authorityPending,
      lifecycleAuthorityPending,
      lifecycleOperation: projectedLifecycleSaga ? { operationId: projectedLifecycleSaga.operation_id, operationType: projectedLifecycleSaga.operation_type, phase: projectedLifecycleSaga.phase, state: projectedLifecycleSaga.state, lastError: projectedLifecycleSaga.last_error || '' } : null,
      state,
      stateLabel: authorizationPending ? '等待平台授权' : projectedLifecycleSaga?.state === 'manual_review' ? '账号状态需要人工恢复' : lifecycleAuthorityPending ? '正在恢复账号状态' : stateLabel(state),
      health: healthFromState(state),
      lastError: runtime.lastError || runtime.error || '',
      reasonCode: runtime.reasonCode || runtime.code || '',
      authority: runtime.authority || driver.protocolAuthority || '',
      matrixUserId: runtime.matrixUserId || '',
      loginCount: Number(runtime.loginCount || 0),
      bridgeLogins: Array.isArray(runtime.bridgeLogins)
        ? runtime.bridgeLogins.map(row => ({
          id: String(row?.id || '').trim(),
          name: String(row?.name || '').trim(),
          stateEvent: String(row?.stateEvent || '').trim(),
          spaceRoom: String(row?.spaceRoom || '').trim(),
          remoteMatrixUserId: String(row?.remoteMatrixUserId || '').trim(),
          identityReasonCode: String(row?.identityReasonCode || '').trim()
        })).filter(row => row.id || row.name)
        : [],
      connectionAttemptId: runtime.connectionAttemptId || runtime.attemptId || '',
      connectionStartedAt: runtime.connectionStartedAt || '',
      connectionFinishedAt: runtime.connectionFinishedAt || '',
      connectedAt: runtime.connectedAt || '',
      lastSyncAt: runtime.lastSyncAt || runtime.connectedAt || '',
      user: runtime.user || null,
      page: runtime.page || null,
      webhook: runtime.webhook || '',
      relayState: runtime.relayState || '',
      permissions: runtime.permissions || [],
      missingPermissions: runtime.missingPermissions || [],
      missingOptionalPermissions: runtime.missingOptionalPermissions || [],
      permissionReady: runtime.permissionReady === true,
      newMessagingReady: runtime.newMessagingReady === true,
      historySyncAvailable: runtime.historySyncAvailable === true,
      historySyncReason: runtime.historySyncReason || '',
      reconciliationActive: runtime.reconciliationActive === true,
      reconciliationRunning: runtime.reconciliationRunning === true,
      reconciliationLastAt: runtime.reconciliationLastAt || '',
      reconciliationLastError: runtime.reconciliationLastError || '',
      reconciliationLastResult: runtime.reconciliationLastResult || null,
      reconciliationIntervalMs: Number(runtime.reconciliationIntervalMs || 0),
      identityReconciliationRunning: runtime.identityReconciliationRunning === true,
      identityReconciliationLastAt: runtime.identityReconciliationLastAt || '',
      identityReconciliationLastError: runtime.identityReconciliationLastError || '',
      identityReconciliationLastResult: runtime.identityReconciliationLastResult || null,
      historySyncLastAt: runtime.historySyncLastAt || '',
      historySyncLastError: runtime.historySyncLastError || '',
      historySyncLastResult: runtime.historySyncLastResult || null,
      subscriptionFields: runtime.subscriptionFields || [],
      subscriptionReady: runtime.subscriptionReady === true,
      tokenExpiresAt: runtime.tokenExpiresAt || '',
      tokenStatus: runtime.tokenStatus || '',
      workerStatus: runtime.workerStatus || '',
      pendingEvents: Number(runtime.pendingEvents || 0),
      deadLetter: Number(runtime.deadLetter || 0),
      lastAckAt: deliveryTruth.lastAckAt || runtime.lastAckAt || '',
      lastDeliveryAckAt: deliveryTruth.lastAckAt || '',
      step: runtime.step || '',
      qrDataUrl: '',
      qrReady: Boolean(challengeStatus.ready || runtime.qrReady),
      qrExpiresAt: challengeStatus.expiresAt || runtime.qrExpiresAt || '',
      qrVersion: Number(challengeStatus.version || runtime.qrVersion || 0),
      floodWaitSeconds: runtime.floodWaitSeconds || 0,
      unread,
      credentialReady,
      authAccountKey: whatsappCredential?.accountKey || '',
      credentialRegisteredFlag: whatsappCredential?.registered === true,
      routeAliases: [...new Set([...canonicalIdentity.accountIdentityAliases(account), whatsappCredential?.accountKey || ''].filter(Boolean))],
      capabilities,
      capabilityAuthority: accountCapabilityProfile.authority || '',
      capabilityContracts: publicContracts(account.platform),
      capabilityAvailability,
      canAttemptSend,
      sendVerified,
      sendReadiness,
      deliveryTruth,
      canSend,
      canReceive
    };
  }

  list() {
    const data = accountStore.read();
    const accounts = data.accounts.map(account => this.publicAccount(account));
    return this.listPayload(data, accounts);
  }

  listPayload(data, accounts) {
    return {
      schemaVersion: data.schemaVersion,
      accounts,
      defaults: data.defaults,
      bindings: data.bindings,
      audit: data.audit.slice(0, 100),
      summary: this.summaryFrom(accounts),
      credentialStorage: {
        desktopSecureStorage: securityGuard.available,
        runtimeCredentialRefs: securityGuard.credentials.listRefs()
      },
      capabilityMatrix: CAPABILITY_MATRIX,
      platformAuth: platformAuthConfig.publicState(),
      driverContracts: platformDrivers.driverContracts()
    };
  }

  async materializeMatureBridgeAccounts(matrixUserId = '') {
    const subject = String(matrixUserId || '').trim();
    if (!subject) return [];
    const definitions = [
      { platform: 'whatsapp', accountKind: 'personal-multidevice', driverId: 'whatsapp-personal-mautrix-whatsapp', label: 'WhatsApp' },
      { platform: 'telegram', accountKind: 'personal', driverId: 'telegram-personal-mautrix-telegram', label: 'Telegram' },
      { platform: 'facebook', accountKind: 'personal-messenger', driverId: 'facebook-personal-messenger-mautrix-meta', label: 'Facebook Messenger' }
    ];
    const created = [];
    for (const definition of definitions) {
      const probe = {
        platform: definition.platform,
        accountKind: definition.accountKind,
        driverId: definition.driverId,
        metadata: { accountKind: definition.accountKind, driverId: definition.driverId }
      };
      const driver = driverFor(probe);
      if (typeof driver.observe !== 'function' || !/^mautrix-/u.test(String(driver.protocolAuthority || ''))) continue;
      let observed;
      try {
        observed = await driver.observe(probe, { matrixUserId: subject });
      } catch (_) {
        continue;
      }
      const logins = Array.isArray(observed?.bridgeLogins) ? observed.bridgeLogins : [];
      const rowMatchesDefinition = row => {
        const metadata = row?.metadata || {};
        const accountKind = String(row?.accountKind || metadata.accountKind || '').trim().toLowerCase();
        const driverId = String(row?.driverId || metadata.driverId || '').trim();
        return row?.platform === definition.platform
          && accountKind === definition.accountKind
          && driverId === definition.driverId;
      };
      for (const login of logins) {
        const loginId = String(login?.id || '').trim();
        if (!loginId) continue;
        const rows = accountStore.list();
        const loginIdentityMatches = rows.filter(row =>
          rowMatchesDefinition(row)
          && observedMatureBridgeLoginId(row, definition.platform) === loginId);
        const canonicalCandidates = loginIdentityMatches.filter(row => !isSyntheticMatureBridgeProjection(row));
        const projectionCandidates = loginIdentityMatches.filter(row => isSyntheticMatureBridgeProjection(row));
        const existing = projectionCandidates.length === 1 ? projectionCandidates[0] : undefined;
        const compatiblePending = rows.filter(row => {
          if (!rowMatchesDefinition(row) || row.id === existing?.id) return false;
          const metadata = row.metadata || {};
          const ownerLoginId = observedMatureBridgeLoginId(row, definition.platform);
          if (ownerLoginId) return false;
          return row.lifecycleState === 'pending-auth' || metadata.authorizationPending === true;
        });
        const projectionMetadata = {
          accountKind: definition.accountKind,
          driverId: definition.driverId,
          matrixUserId: subject,
          mautrixLoginId: loginId,
          ...(definition.platform === 'facebook' ? { mautrixMetaLoginId: loginId } : {}),
          protocolAuthority: driver.protocolAuthority,
          projectionSource: 'mautrix-whoami'
        };
        if (canonicalCandidates.length > 1 || projectionCandidates.length > 1) {
          logCriticalFailure('accounts.materializeMatureBridgeAccounts', Object.assign(new Error('Mature bridge login identity is ambiguous'), {
            code: 'MATURE_BRIDGE_LOGIN_IDENTITY_AMBIGUOUS'
          }), {
            platform: definition.platform,
            loginId,
            canonicalCandidates: canonicalCandidates.map(row => row.id),
            projectionCandidates: projectionCandidates.map(row => row.id)
          });
          continue;
        }
        if (canonicalCandidates.length === 1) {
          const canonical = canonicalCandidates[0];
          await accountStore.commitConnectedIdentityTx(canonical.id, {
            metadata: {
              ...(canonical.metadata || {}),
              ...projectionMetadata,
              projectionSource: 'mautrix-whoami-adopted'
            }
          }, {
            resultState: 'connected',
            recovered: true
          });
          const aliases = rows.filter(row => {
            if (row.id === canonical.id || !rowMatchesDefinition(row)) return false;
            const metadata = row.metadata || {};
            const observedLoginId = observedMatureBridgeLoginId(row, definition.platform);
            const pending = row.lifecycleState === 'pending-auth' || metadata.authorizationPending === true;
            return observedLoginId === loginId || (pending && !observedLoginId);
          });
          for (const alias of aliases) {
            await accountStore.commitLifecycleTx(alias.id, {
              paused: true,
              autoReconnect: false,
              lifecycleState: 'merged',
              canonicalAccountId: canonical.id,
              mergedIntoId: canonical.id,
              metadata: {
                ...(alias.metadata || {}),
                authorizationPending: false,
                matrixUserId: subject,
                protocolAuthority: driver.protocolAuthority,
                projectionSource: isSyntheticMatureBridgeProjection(alias) ? 'mautrix-whoami' : String(alias.metadata?.projectionSource || ''),
                projectionMergeReason: 'mature-bridge-login-identity-canonicalized'
              }
            }, {
              action: 'account-mature-bridge-projection-merged',
              detail: { canonicalAccountId: canonical.id, authority: driver.protocolAuthority, loginId }
            });
          }
          continue;
        }
        if (existing) {
          if (compatiblePending.length === 1) {
            const alias = compatiblePending[0];
            await accountStore.commitLifecycleTx(alias.id, {
              paused: true,
              autoReconnect: false,
              lifecycleState: 'merged',
              canonicalAccountId: existing.id,
              mergedIntoId: existing.id,
              metadata: {
                ...(alias.metadata || {}),
                authorizationPending: false,
                matrixUserId: subject,
                protocolAuthority: driver.protocolAuthority,
                projectionSource: 'mautrix-whoami',
                projectionMergeReason: 'mature-bridge-login-observed'
              }
            }, {
              action: 'account-mature-bridge-projection-merged',
              detail: { canonicalAccountId: existing.id, authority: driver.protocolAuthority }
            });
          }
          continue;
        }
        if (logins.length === 1 && compatiblePending.length === 1) {
          const pending = compatiblePending[0];
          const account = await accountStore.commitConnectedIdentityTx(pending.id, {
            displayName: String(login?.name || definition.label).trim() || definition.label,
            identityLabel: String(login?.name || loginId).trim() || loginId,
            source: 'mature-bridge-projection',
            metadata: {
              ...(pending.metadata || {}),
              ...projectionMetadata
            }
          }, {
            resultState: 'connected',
            recovered: true
          });
          created.push(account);
          continue;
        }
        const digest = crypto.createHash('sha256')
          .update([definition.platform, subject, loginId].join('\n'))
          .digest('hex')
          .slice(0, 24);
        const id = definition.platform.slice(0, 2) + '-mautrix-' + digest;
        try {
          const account = await this.create({
            id,
            platform: definition.platform,
            accountKind: definition.accountKind,
            driverId: definition.driverId,
            adapterAccountId: id,
            displayName: String(login?.name || definition.label).trim() || definition.label,
            identityLabel: String(login?.name || loginId).trim() || loginId,
            source: 'mature-bridge-projection',
            metadata: projectionMetadata
          });
          created.push(account);
        } catch (error) {
          if (error?.code !== 'ACCOUNT_EXISTS') throw error;
        }
      }
    }
    return created;
  }

  async listObserved(options = {}) {
    const matrixUserId = String(options.matrixUserId || '').trim();
    await this.materializeMatureBridgeAccounts(matrixUserId);
    const data = accountStore.read();
    const accounts = await Promise.all(data.accounts.map(async account => {
      const driver = driverFor(account);
      const matureBridge = /^mautrix-/u.test(String(driver.protocolAuthority || ''));
      if (!matureBridge) return this.publicAccount(account);
      if (!matrixUserId) {
        return this.publicAccount(account, {
          state: account.paused ? 'paused' : 'logged-out',
          canAttemptSend: false,
          canReceive: false,
          authority: driver.protocolAuthority || '',
          reasonCode: 'MATRIX_HUMAN_IDENTITY_REQUIRED',
          observationRequired: true
        });
      }
      try {
        const observed = await driver.observe(account, { matrixUserId });
        return this.publicAccount(account, observed);
      } catch (error) {
        return this.publicAccount(account, {
          state: account.paused ? 'paused' : 'logged-out',
          canAttemptSend: false,
          canReceive: false,
          authority: driver.protocolAuthority || '',
          reasonCode: error?.reasonCode || error?.code || 'MAUTRIX_OBSERVATION_UNAVAILABLE',
          observationRequired: true
        });
      }
    }));
    return this.listPayload(data, accounts);
  }

  summaryFrom(accounts) { return buildAccountSummary(accounts); }

  summary() { return this.summaryFrom(this.list().accounts); }

  getLifecycleState(id) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    return this.publicAccount(account);
  }

  getAuthChallenge(id) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const personalMessenger = account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || '').toLowerCase() === 'personal-messenger';
    if (!['whatsapp', 'telegram'].includes(account.platform) && !personalMessenger) {
      throw Object.assign(new Error('当前平台不使用交互式认证挑战'), { code: 'AUTH_CHALLENGE_UNSUPPORTED', status: 409 });
    }
    const adapterAccountId = account.platform === 'whatsapp' ? this.whatsappAuthKey(account) : account.id;
    const challenge = personalMessenger
      ? null
      : (authChallenges.read(account.id, { includeSecret: true }) || authChallenges.read(adapterAccountId, { includeSecret: true }));
    const owner = this.publicAccount(account);
    return {
      accountId: account.id,
      state: owner.state,
      step: owner.step || '',
      prompt: owner.lastError || '',
      challenge
    };
  }

  async waitForAuthChallenge(id, waitMs = 0, options = {}) {
    const immediate = this.getAuthChallenge(id);
    if (immediate.challenge || Number(waitMs || 0) <= 0) return immediate;
    const account = accountStore.get(id);
    const personalMessenger = account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || '').toLowerCase() === 'personal-messenger';
    if (personalMessenger) return immediate;
    const adapterAccountId = account.platform === 'whatsapp' ? this.whatsappAuthKey(account) : account.id;
    const timeoutMs = Math.max(0, Math.min(Number(waitMs || 0), 30_000));
    await authChallenges.wait(account.id, { includeSecret: true, timeoutMs, signal: options.signal || null })
      || await authChallenges.wait(adapterAccountId, { includeSecret: true, timeoutMs: 0, signal: options.signal || null });
    return this.getAuthChallenge(id);
  }

  async create(input) {
    const prospectiveDriver = driverFor({
      platform: input?.platform,
      accountKind: input?.accountKind || input?.metadata?.accountKind,
      driverId: input?.driverId || input?.metadata?.driverId,
      metadata: input?.metadata || {}
    });
    if (!matureLifecycleAuthority(prospectiveDriver)) platformAuthConfig.assertAvailable(input?.platform, 'create');
    const authorizationPending = input?.authorizationPending === true;
    const account = await accountStore.create({
      ...input,
      ...(authorizationPending ? {
        lifecycleState: 'pending-auth',
        autoReconnect: false,
        isPrimary: false,
        isDefaultSend: false,
        metadata: { ...(input?.metadata || {}), authorizationPending: true, authorizationStartedAt: new Date().toISOString() }
      } : {})
    });
    this.runtime.set(account.id, { state: account.paused ? 'paused' : 'unconfigured', lastError: '', connectedAt: '' });
    this.publishSummary();
    return this.publicAccount(account);
  }

  async promotePendingAuthorization(id, detail = {}) {
    const account = accountStore.get(id);
    if (!account || (account.lifecycleState !== 'pending-auth' && account.metadata?.authorizationPending !== true)) return account;
    const metadata = {
      ...(account.metadata || {}),
      authorizationPending: false,
      authorizationCompletedAt: new Date().toISOString(),
      authorizationResultState: String(detail.state || '')
    };
    const updated = await accountStore.promoteAuthorizationTx(account.id, {
      lifecycleState: 'active',
      autoReconnect: true,
      metadata,
      authorizationResultState: String(detail.state || '')
    });
    return accountStore.get(updated.id);
  }

  async discardPendingAuthorization(id, reason = 'authorization-abandoned', options = {}) {
    const account = accountStore.get(id);
    if (!account) return { removed: false, reason: 'account-not-found', accountId: id };
    if (account.lifecycleState !== 'pending-auth' && account.metadata?.authorizationPending !== true) {
      return { removed: false, reason: 'account-already-active', account: this.publicAccount(account) };
    }
    if (options.skipAdapterStop !== true) {
      try {
        if (account.platform === 'telegram') await platformDrivers.get('telegram').cancelLogin(account);
        else await driverFor(account).disconnect(account, { logout: false });
      } catch (error) {
        logCriticalFailure('account.pendingAuthorization.disconnect', error, { accountId: account.id, platform: account.platform });
      }
    }
    authChallenges.clear(account.id);
    if (account.adapterAccountId) authChallenges.clear(account.adapterAccountId);
    const removed = await accountStore.tombstone(account.id, { reason: String(reason || 'authorization-abandoned') });
    this.runtime.delete(account.id);
    await accountStore.record('account-authorization-discarded', { accountId: account.id, platform: account.platform, reason: String(reason || '') })
      .catch(error => logCriticalFailure('accountStore.record.account-authorization-discarded', error, { accountId: account.id, platform: account.platform }));
    this.publishSummary();
    return { removed: true, reason: String(reason || ''), account: removed };
  }

  async update(id, patch) {
    const account = await accountStore.update(id, patch);
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'notificationsEnabled')) {
      const settings = notificationPolicy.read();
      const muted = new Set(settings.mutedAccounts || []);
      if (patch.notificationsEnabled === false) muted.add(id); else muted.delete(id);
      await notificationPolicy.update({ mutedAccounts: [...muted] });
    }
    this.publishSummary();
    return this.publicAccount(account);
  }

  async remove(id, options = {}) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const saga = await accountLifecycleSaga.begin(accountStore.getRaw(id) || account, 'remove');
    let adapterReceipt = null;
    try {
      await accountStore.update(id, {
        paused: true,
        lifecycleState: 'paused',
        metadata: { lifecyclePending: true, lifecycleOperationId: saga.operation_id, lifecycleOperation: 'remove', lifecycleClearCredentials: options.clearCredentials === true, lifecycleLogout: options.logout === true }
      });
      await accountLifecycleSaga.setPhase(saga.operation_id, 'prepared', 'sqlite_mark_remove_pending');
      await accountLifecycleSaga.setPhase(saga.operation_id, 'sqlite_mark_remove_pending', 'adapter_disconnect_started');
      adapterReceipt = await driverFor(account).disconnect(account, { logout: Boolean(options.logout) });
      await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_disconnect_started', 'adapter_disconnected', { adapterReceipt });
      const removed = await accountStore.tombstone(id, { reason: 'user-remove', pendingCleanup: Boolean(options.clearCredentials) });
      await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_disconnected', 'sqlite_tombstoned');
      if (options.clearCredentials) {
        await securityGuard.credentials.remove(removed.credentialRef);
        await accountLifecycleSaga.setPhase(saga.operation_id, 'sqlite_tombstoned', 'credential_delete_committed');
      }
      const removePhase = accountLifecycleSaga.get(saga.operation_id)?.phase || (options.clearCredentials ? 'credential_delete_committed' : 'sqlite_tombstoned');
      await accountStore.commitLifecycleTx(id, {
        paused: true,
        lifecycleState: 'tombstoned',
        metadata: {
          lifecyclePending: false,
          lifecycleOperationId: '',
          lifecycleOperation: '',
          lifecycleClearCredentials: false,
          lifecycleLogout: false,
          removalPendingCleanup: false
        }
      });
      await accountLifecycleSaga.setPhase(saga.operation_id, removePhase, 'sqlite_lifecycle_committed');
      await accountLifecycleSaga.finish(saga.operation_id, 'succeeded', { adapterReceipt: adapterReceipt || {} });
      this.runtime.delete(id);
      this.publishSummary();
      return removed;
    } catch (error) {
      await accountLifecycleSaga.finish(saga.operation_id, 'manual_review', { lastError: error.message, adapterReceipt: adapterReceipt || {} });
      this.runtime.set(id, { state: 'paused', lastError: error.message || String(error), reasonCode: error.code || 'ACCOUNT_REMOVE_REQUIRES_RECONCILIATION', connectedAt: '' });
      this.publishSummary();
      throw error;
    }
  }

  async setDefault(platform, id) {
    const account = await accountStore.setDefault(platform, id);
    this.publishSummary();
    return this.publicAccount(account);
  }

  async connect(id, options = {}) {
    let account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('\u8d26\u53f7\u4e0d\u5b58\u5728'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    accountLifecycle.assertEligible(account, { manual: true });
    const driver = driverFor(account);
    if (!matureLifecycleAuthority(driver)) platformAuthConfig.assertAvailable(account.platform, 'connect');
    if (account.paused) {
      await accountStore.update(account.id, { paused: false, lifecycleState: 'active' });
      account = accountStore.get(account.id);
    }
    const canonicalId = canonicalIdentity.resolveCanonicalAccountId(account.id);
    if (canonicalId !== account.id) {
      throw Object.assign(new Error('\u91cd\u590d\u8d26\u53f7\u5df2\u5408\u5e76\uff0c\u4e0d\u80fd\u72ec\u7acb\u8fde\u63a5'), {
        code: 'ACCOUNT_IDENTITY_ALIAS', status: 409, canonicalAccountId: canonicalId
      });
    }
    assertOperationActive(options.signal, 'ACCOUNT_CONNECT_ABORTED');
    const result = await withAbortSignal(
      driver.connect(account, {
        manual: true,
        signal: options.signal || null,
        matrixUserId: String(options.matrixUserId || '').trim(),
        secret: securityGuard.credentials.get(account.credentialRef) || {}
      }),
      options.signal,
      'ACCOUNT_CONNECT_ABORTED'
    );
    assertOperationActive(options.signal, 'ACCOUNT_CONNECT_ABORTED');
    if (result && ['connected', 'limited'].includes(String(result.state || '').toLowerCase())) {
      await this.updateIdentityFromRuntime(accountStore.get(id) || account, result);
    }
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
  }

  async sync(id, options = {}) {
    assertOperationActive(options.signal, 'ACCOUNT_SYNC_ABORTED');
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const driver = driverFor(account);
    const matureBridge = /^mautrix-/u.test(String(driver.protocolAuthority || ''));
    const observedRuntime = matureBridge && clean(options.matrixUserId) && typeof driver.observe === 'function'
      ? await driver.observe(account, { matrixUserId: clean(options.matrixUserId), signal: options.signal || null })
      : null;
    assertOperationActive(options.signal, 'ACCOUNT_SYNC_ABORTED');
    const publicAccount = this.publicAccount(account, observedRuntime);
    if (!publicAccount.canReceive) throw Object.assign(new Error(`账号不可同步：${publicAccount.stateLabel}`), { code: 'ACCOUNT_CANNOT_SYNC', status: 409 });
    const pageKind = account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || 'page').toLowerCase() === 'page';
    const chatwootPageOwner = pageKind && String(driver.driverId || '').trim() === 'facebook-page-official';
    if (pageKind && !chatwootPageOwner && publicAccount.historySyncAvailable !== true) {
      const reason = publicAccount.historySyncReason || 'pages_read_engagement 尚未授权，无法读取 Meta Business Suite 最近会话';
      throw Object.assign(new Error(reason), {
        code: 'FACEBOOK_HISTORY_PERMISSION_MISSING',
        status: 409,
        missingPermissions: publicAccount.missingOptionalPermissions || ['pages_read_engagement']
      });
    }
    const result = await withAbortSignal(
      driver.sync(account, {
        signal: options.signal || null,
        matrixUserId: clean(options.matrixUserId),
        executionGeneration: options.executionGeneration || options.operationGeneration || '',
        physicalOperationContext: options.physicalOperationContext
      }),
      options.signal,
      'ACCOUNT_SYNC_ABORTED'
    );
    assertOperationActive(options.signal, 'ACCOUNT_SYNC_ABORTED');
    await accountStore.record('account-synced', { accountId: id, platform: account.platform, result });
    this.runtime.set(id, { ...this.rawRuntime(account), lastSyncAt: result.syncedAt || new Date().toISOString() });
    this.publishSummary();
    return { account: this.publicAccount(accountStore.get(id)), result };
  }

  async mediaTransfer(id, input = {}) {
    assertOperationActive(input.signal, 'ACCOUNT_MEDIA_TRANSFER_ABORTED');
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') {
      throw Object.assign(new Error('Facebook媒体账号不存在'), { code: 'FACEBOOK_MEDIA_ACCOUNT_NOT_FOUND', status: 404 });
    }
    if (String(input.transferKind || '').trim().toUpperCase() !== 'FETCH') {
      throw Object.assign(new Error('Facebook Worker媒体物化仅支持FETCH'), { code: 'FACEBOOK_MEDIA_TRANSFER_KIND_UNSUPPORTED', status: 409 });
    }
    const messageId = String(input.mediaReference || '').trim();
    const persisted = messageStore.getExternalMessage({ accountId: id, targetId: messageId });
    if (!persisted) {
      throw Object.assign(new Error('Facebook媒体引用未解析到已持久化消息'), { code: 'FACEBOOK_MEDIA_MESSAGE_NOT_FOUND', status: 404, accountId: id, messageId });
    }
    const conversationId = String(persisted.conversationId || persisted.sessionKey || '').trim();
    const externalMessageId = String(persisted.externalMessageId || messageId).trim();
    if (!conversationId || externalMessageId !== messageId) {
      throw Object.assign(new Error('Facebook媒体持久化消息作用域与冻结命令不一致'), {
        code: 'FACEBOOK_MEDIA_TRANSFER_SCOPE_MISMATCH', status: 409, accountId: id, messageId
      });
    }
    const expectedSourceScopeReference = `facebook:${id}:webhook:${externalMessageId}`;
    const expectedDestinationScopeReference = `conversation:${conversationId}:message:${externalMessageId}`;
    const expectedMetadataSha256 = crypto.createHash('sha256')
      .update(['facebook', id, conversationId, externalMessageId].join('\n'))
      .digest('hex');
    if (String(input.sourceScopeReference || '').trim() !== expectedSourceScopeReference
        || String(input.destinationScopeReference || '').trim() !== expectedDestinationScopeReference
        || String(input.metadataSha256 || '').trim() !== expectedMetadataSha256) {
      throw Object.assign(new Error('Facebook媒体冻结命令与持久化消息证据不一致'), {
        code: 'FACEBOOK_MEDIA_TRANSFER_SCOPE_MISMATCH', status: 409, accountId: id, messageId
      });
    }
    const attachments = Array.isArray(persisted.attachments) ? persisted.attachments : [];
    const hasWorkerMedia = attachments.some(attachment => {
      const worker = attachment?.workerMedia || attachment?.payload?.worker_media || null;
      return Boolean(String(worker?.eventId || worker?.event_id || '').trim());
    });
    if (!hasWorkerMedia) {
      throw Object.assign(new Error('已持久化Facebook消息没有Worker媒体引用；Windows直连Meta CDN仍保持退役'), {
        code: 'FACEBOOK_WORKER_MEDIA_REFERENCE_NOT_FOUND', status: 409, accountId: id, messageId
      });
    }
    const facebookDriver = driverFor(account);
    await withAbortSignal(
      facebookDriver.cacheWebhookAttachments(account, {
        ...persisted,
        accountId: id,
        platform: 'facebook',
        externalMessageId,
        conversationId
      }, attachments, {
        signal: input.signal || null,
        physicalOperationContext: input.physicalOperationContext
      }),
      input.signal,
      'ACCOUNT_MEDIA_TRANSFER_ABORTED'
    );
    assertOperationActive(input.signal, 'ACCOUNT_MEDIA_TRANSFER_ABORTED');
    return {
      status: 'completed',
      remoteTransferId: '',
      providerRequestId: '',
      outputReference: `message:${id}:${externalMessageId}`,
      evidenceReference: `facebook-worker-media:${String(input.operationId || messageId).trim()}`,
      failureCode: '',
      uncertain: false
    };
  }

  async syncAll() {
    const results = [];
    for (const account of accountStore.list().filter(row => accountLifecycle.eligibility(row, { manual: false }).eligible)) {
      try { results.push({ accountId: account.id, ok: true, ...(await this.sync(account.id)) }); }
      catch (error) { results.push({ accountId: account.id, ok: false, error: error.message, code: error.code || '' }); }
    }
    return results;
  }

  async reconnect(id, options = {}) {
    assertOperationActive(options.signal, 'ACCOUNT_RECONNECT_ABORTED');
    await this.disconnect(id, { logout: false, transient: true, reason: 'reconnect', signal: options.signal || null, operationGeneration: options.operationGeneration || options.attemptId || '' });
    assertOperationActive(options.signal, 'ACCOUNT_RECONNECT_ABORTED');
    return this.connect(id, options);
  }

  async reconnectAll() {
    const results = [];
    for (const account of accountStore.list().filter(row => accountLifecycle.eligibility(row, { manual: false }).eligible)) {
      try { results.push({ accountId: account.id, ok: true, account: await this.reconnect(account.id) }); }
      catch (error) { results.push({ accountId: account.id, ok: false, error: error.message }); }
    }
    return results;
  }

  async disconnect(id, options = {}) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const logout = options.logout === true;
    const transient = options.transient === true;
    const activeDriver = driverFor(account);
    const result = await withAbortSignal(
      activeDriver.disconnect(account, {
        logout,
        signal: options.signal || null
      }),
      options.signal,
      logout ? 'ACCOUNT_LOGOUT_ABORTED' : 'ACCOUNT_DISCONNECT_ABORTED'
    );
    assertOperationActive(options.signal, logout ? 'ACCOUNT_LOGOUT_ABORTED' : 'ACCOUNT_DISCONNECT_ABORTED');
    const preserveLocalRuntimeCredential = logout && activeDriver?.preserveLocalRuntimeCredentialOnLogout === true;
    if (logout && ['telegram', 'facebook'].includes(account.platform) && !preserveLocalRuntimeCredential) {
      await securityGuard.credentials.remove(account.credentialRef, { actor: 'platform-adapter' });
      assertOperationActive(options.signal, 'ACCOUNT_LOGOUT_ABORTED');
    }
    if (!transient) {
      await accountStore.commitLifecycleTx(id, {
        paused: true,
        lifecycleState: 'paused',
        metadata: {
          lifecyclePending: false,
          lifecycleOperationId: '',
          lifecycleOperation: '',
          loggedOut: logout,
          ...(logout && activeDriver?.driverId === 'facebook-personal-messenger-mautrix-meta' ? { mautrixMetaLoginId: '' } : {})
        }
      }, {
        action: logout ? 'account-logout' : 'account-paused',
        detail: { owner: activeDriver?.driverId || account.platform }
      });
    }
    this.runtime.delete(id);
    if (transient) {
      logger.info('accounts', 'account-runtime-stopped', {
        accountId: id,
        platform: account.platform,
        reason: String(options.reason || 'transient-stop')
      });
    }
    this.publishSummary();
    return { ...result, transient, account: this.publicAccount(accountStore.get(id)) };
  }

  async resume(id, options = {}) {
    await accountStore.update(id, { paused: false });
    return this.connect(id, options);
  }

  facebookPageAccount(id) {
    const account = accountStore.get(id);
    const kind = String(account?.accountKind || account?.metadata?.accountKind || '').trim().toLowerCase();
    if (!account || account.platform !== 'facebook' || kind !== 'page') {
      throw Object.assign(new Error('Facebook Page 账号不存在'), { code: 'FACEBOOK_PAGE_ACCOUNT_NOT_FOUND', status: 404 });
    }
    const driver = driverFor(account);
    if (String(driver.driverId || '').trim() !== 'facebook-page-official') {
      throw Object.assign(new Error('Facebook Page 必须由 Chatwoot 官方 Page authority 管理'), { code: 'FACEBOOK_PAGE_CHATWOOT_AUTHORITY_REQUIRED', status: 409 });
    }
    return { account, driver };
  }

  async listFacebookPageInboxes(id, options = {}) {
    const { driver } = this.facebookPageAccount(id);
    if (typeof driver.listFacebookPageInboxes !== 'function') {
      throw Object.assign(new Error('Facebook Page Chatwoot discovery unavailable'), { code: 'FACEBOOK_CHATWOOT_DISCOVERY_UNAVAILABLE', status: 503 });
    }
    const inboxes = await withAbortSignal(
      driver.listFacebookPageInboxes({ signal: options.signal || null }),
      options.signal,
      'FACEBOOK_CHATWOOT_DISCOVERY_ABORTED'
    );
    return { authority: 'chatwoot-facebook-page-sidecar', inboxes };
  }

  async attachFacebookPageInbox(id, input = {}, options = {}) {
    const { account, driver } = this.facebookPageAccount(id);
    if (typeof driver.resolveFacebookPageInbox !== 'function') {
      throw Object.assign(new Error('Facebook Page Chatwoot selection unavailable'), { code: 'FACEBOOK_CHATWOOT_DISCOVERY_UNAVAILABLE', status: 503 });
    }
    const page = await withAbortSignal(
      driver.resolveFacebookPageInbox({ inboxId: String(input.inboxId || '').trim(), pageId: String(input.pageId || '').trim() }, { signal: options.signal || null }),
      options.signal,
      'FACEBOOK_CHATWOOT_DISCOVERY_ABORTED'
    );
    if (!page?.pageId || !page?.inboxId) {
      throw Object.assign(new Error('Facebook Page 必须精确匹配一个 Chatwoot Facebook inbox'), { code: 'FACEBOOK_CHATWOOT_INBOX_IDENTITY_AMBIGUOUS', status: 409 });
    }
    await accountStore.update(id, {
      adapterAccountId: `facebook_ads:${page.pageId}`,
      identityLabel: page.name || account.identityLabel || account.displayName || 'Facebook Page',
      lifecycleState: 'pending-auth',
      metadata: {
        ...(account.metadata || {}),
        accountKind: 'page',
        driverId: 'facebook-page-official',
        pageId: page.pageId,
        facebookPageId: page.pageId,
        chatwootInboxId: page.inboxId,
        pageName: page.name || '',
        authorizationPending: true,
        authorizationAuthority: 'chatwoot-facebook-page-sidecar'
      }
    });
    const connected = await this.connect(id, options);
    await accountStore.record('facebook-page-chatwoot-attached', {
      accountId: id, pageId: page.pageId, inboxId: page.inboxId, authority: 'chatwoot-facebook-page-sidecar'
    });
    this.publishSummary();
    return { account: connected, page, authority: 'chatwoot-facebook-page-sidecar' };
  }

  async beginFacebookOAuth(id, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
    const result = await withAbortSignal(facebookOAuth.begin(id, options), options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
    return result;
  }

  async pollFacebookOAuth(id, flowId, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
    const result = await withAbortSignal(facebookOAuth.poll(id, flowId, options), options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
    if (result?.mode === 'identity' && result?.status === 'completed') {
      const connected = await this.connect(id, { signal: options.signal, attemptId: options.operationGeneration, operationGeneration: options.operationGeneration, physicalOperationContext: options.physicalOperationContext });
      assertOperationActive(options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
      this.publishSummary();
      return { ...result, account: connected };
    }
    return result;
  }

  async cancelFacebookOAuth(id, flowId, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
    const flow = await withAbortSignal(facebookOAuth.cancel(id, flowId, options), options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
    if (account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true) {
      await this.discardPendingAuthorization(id, 'facebook-oauth-cancelled');
      assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
    }
    return flow;
  }

  mautrixProvisioningAccount(id) {
    const account = accountStore.get(id);
    const kind = String(account?.accountKind || account?.metadata?.accountKind || '').trim().toLowerCase();
    const supported = Boolean(account) && (
      account.platform === 'whatsapp'
      || account.platform === 'telegram'
      || (account.platform === 'facebook' && kind === 'personal-messenger')
    );
    if (!supported) {
      throw Object.assign(new Error('This account is not owned by a mautrix provisioning bridge'), {
        code: 'MAUTRIX_PROVISIONING_ACCOUNT_REQUIRED',
        status: 409
      });
    }
    const driver = driverFor(account);
    if (typeof driver.getLoginFlows !== 'function'
        || typeof driver.beginLogin !== 'function'
        || typeof driver.submitLoginInput !== 'function'
        || typeof driver.waitLoginStep !== 'function'
        || typeof driver.cancelLogin !== 'function') {
      throw Object.assign(new Error('The mature provisioning owner is unavailable for this account'), {
        code: 'MAUTRIX_PROVISIONING_OWNER_UNAVAILABLE',
        status: 503
      });
    }
    return { account, driver };
  }

  async listProvisioningLoginFlows(id, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_FLOWS_ABORTED');
    const flows = await withAbortSignal(
      driver.getLoginFlows(account, options),
      options.signal,
      'MAUTRIX_LOGIN_FLOWS_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_FLOWS_ABORTED');
    return { account: this.publicAccount(account), flows };
  }

  async ensureProvisioningDirectChat(id, identifier, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    if (typeof driver.ensureDirectChat !== 'function') {
      throw Object.assign(new Error('The mature bridge does not expose direct-chat provisioning'), {
        code: 'MAUTRIX_DIRECT_CHAT_OWNER_UNAVAILABLE', status: 503
      });
    }
    const loginId = observedMatureBridgeLoginId(account, account.platform);
    if (!loginId) {
      throw Object.assign(new Error('The exact mautrix login identity is unavailable for this account'), {
        code: 'MAUTRIX_LOGIN_ID_REQUIRED', status: 409
      });
    }
    assertOperationActive(options.signal, 'MAUTRIX_DIRECT_CHAT_ABORTED');
    const result = await withAbortSignal(
      driver.ensureDirectChat(account, identifier, loginId, options),
      options.signal,
      'MAUTRIX_DIRECT_CHAT_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_DIRECT_CHAT_ABORTED');
    return { account: this.publicAccount(account), ...result };
  }

  async settleProvisioningLoginStep(id, account, driver, result, options = {}) {
    if (driver.isCompleteLoginResult(result)) {
      const connected = await this.connect(id, options);
      this.publishSummary();
      return { account: connected, flow: result, completed: true };
    }
    this.publishSummary();
    return { account: this.publicAccount(accountStore.get(id)), flow: result, completed: false };
  }

  async startProvisioningLogin(id, flowId, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_START_ABORTED');
    const result = await withAbortSignal(
      driver.beginLogin(account, flowId, options),
      options.signal,
      'MAUTRIX_LOGIN_START_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_START_ABORTED');
    return this.settleProvisioningLoginStep(id, account, driver, result, options);
  }

  async submitProvisioningLoginInput(id, loginProcessId, stepId, input = {}, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_INPUT_ABORTED');
    const result = await withAbortSignal(
      driver.submitLoginInput(account, loginProcessId, stepId, input, options),
      options.signal,
      'MAUTRIX_LOGIN_INPUT_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_INPUT_ABORTED');
    return this.settleProvisioningLoginStep(id, account, driver, result, options);
  }

  async waitProvisioningLogin(id, loginProcessId, stepId, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_WAIT_ABORTED');
    const result = await withAbortSignal(
      driver.waitLoginStep(account, loginProcessId, stepId, options),
      options.signal,
      'MAUTRIX_LOGIN_WAIT_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_WAIT_ABORTED');
    return this.settleProvisioningLoginStep(id, account, driver, result, options);
  }

  async cancelProvisioningLogin(id, loginProcessId, options = {}) {
    const { account, driver } = this.mautrixProvisioningAccount(id);
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_CANCEL_ABORTED');
    const result = await withAbortSignal(
      driver.cancelLogin(account, loginProcessId, options),
      options.signal,
      'MAUTRIX_LOGIN_CANCEL_ABORTED'
    );
    assertOperationActive(options.signal, 'MAUTRIX_LOGIN_CANCEL_ABORTED');
    if (account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true) {
      await this.discardPendingAuthorization(id, 'mautrix-login-cancelled', { skipAdapterStop: true });
      return { flow: result, removed: true, cancelled: true };
    }
    this.publishSummary();
    return { flow: result, account: this.publicAccount(accountStore.get(id)), cancelled: true };
  }

  identityPatchFromRuntime(account, result) {
    if (!account || !result) return null;
    let label = account.identityLabel;
    const metadata = { ...(account.metadata || {}) };
    if (account.platform === 'whatsapp' && result.user) {
      const jid = normalizeJid(result.user.id || result.user.lid || '');
      const phone = normalizePhone(jid || result.user.id || metadata.phone || '');
      label = safeDisplayName(result.user.name, account.displayName, label);
      metadata.phone = phone || metadata.phone || '';
      metadata.jid = jid || metadata.jid || '';
      metadata.liveUser = { ...(metadata.liveUser || {}), ...result.user, ...(jid ? { id: jid } : {}) };
    }
    if (account.platform === 'telegram' && result.user) {
      label = [result.user.firstName, result.user.lastName].filter(Boolean).join(' ') || (result.user.username ? `@${result.user.username}` : '') || result.user.phone || label;
      metadata.username = result.user.username || '';
      metadata.phone = result.user.phone || '';
      metadata.liveUser = { ...(metadata.liveUser || {}), ...result.user };
    }
    if (account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || '').toLowerCase() === 'personal-messenger' && result.user) {
      label = result.user.name || result.user.displayName || result.user.username || label;
      metadata.username = result.user.username || metadata.username || '';
      metadata.remoteUserId = String(result.user.id || result.user.userId || metadata.remoteUserId || '');
      metadata.liveUser = { ...(metadata.liveUser || {}), ...result.user };
    }
    if (account.platform === 'facebook' && result.page) {
      label = result.page.name || label;
      metadata.pageId = result.page.id || metadata.pageId || '';
      metadata.username = result.page.username || '';
      metadata.picture = result.page.picture || metadata.picture || metadata.pagePicture || '';
      metadata.pagePicture = metadata.picture;
      metadata.avatarStatus = result.page.avatarStatus || metadata.avatarStatus || '';
      metadata.avatarLastError = result.page.avatarLastError || '';
      metadata.avatarUpdatedAt = result.page.avatarUpdatedAt || metadata.avatarUpdatedAt || '';
      metadata.avatarSource = result.page.avatarSource || metadata.avatarSource || '';
    }
    return { identityLabel: label, metadata };
  }

  async updateIdentityFromRuntime(account, result) {
    if (!account || !result) return;
    const patch = this.identityPatchFromRuntime(account, result);
    if (patch && (patch.identityLabel !== account.identityLabel || JSON.stringify(patch.metadata) !== JSON.stringify(account.metadata || {}))) {
      await accountStore.update(account.id, patch);
    }
    if (result.user || result.page || ['connected', 'limited'].includes(String(result.state || ''))) {
      await this.promotePendingAuthorization(account.id, result);
    }
  }

  async recordAvatarLoadFailure(id, input = {}) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const conversationId = String(input.conversationId || input.sessionKey || '').trim();
    if (!conversationId) throw Object.assign(new Error('会话ID不能为空'), { code: 'CONVERSATION_ID_REQUIRED', status: 400 });
    const conversation = messageStore.getConversation(conversationId);
    if (!conversation || ![account.id, account.adapterAccountId].filter(Boolean).includes(conversation.accountId)) {
      throw Object.assign(new Error('会话不属于当前账号'), { code: 'CONVERSATION_ACCOUNT_MISMATCH', status: 409 });
    }
    const updated = await messageStore.updateConversationMetadata(conversationId, {
      avatarStatus: 'frontend-load-failed',
      avatarLastError: 'frontend-load-failed'
    });
    logger.warn('accounts', 'avatar-sync-failed', {
      accountId: account.id,
      conversationId,
      contactId: conversation.contactId || '',
      jidHash: require('crypto').createHash('sha256').update(String(conversation.chatJid || conversation.externalId || '')).digest('hex').slice(0, 16),
      stage: 'frontend-load',
      errorCode: 'frontend-load-failed',
      httpStatus: 0,
      attempt: 1,
      durationMs: 0
    });
    return { recorded: true, conversation: updated };
  }

  startFacebookBusinessSuiteAvatarImport(id, options = {}) {
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_IMPORT_START_ABORTED');
    const result = facebookBusinessSuiteAvatarImport.start(id);
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_IMPORT_START_ABORTED');
    return result;
  }

  getFacebookBusinessSuiteAvatarImportStatus(id, options = {}) {
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_IMPORT_STATUS_ABORTED');
    return facebookBusinessSuiteAvatarImport.statusForAccount(id);
  }

  stopFacebookBusinessSuiteAvatarImport(id, options = {}) {
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_IMPORT_STOP_ABORTED');
    const result = facebookBusinessSuiteAvatarImport.stop(id);
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_IMPORT_STOP_ABORTED');
    return result;
  }

  async diagnoseFacebookAvatarClosure(id, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED');
    const report = await withAbortSignal(platformDrivers.get('facebook').adapter.diagnoseAvatarClosure(account, options), options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED');
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED');
    await accountStore.record('facebook-avatar-closure-diagnosed', {
      accountId: id,
      conversationsScanned: report.summary?.conversationsScanned || 0,
      identityResolved: report.summary?.identityResolved || 0,
      workerAvatarReady: report.summary?.workerAvatarReady || 0,
      fullyReady: report.summary?.fullyReady || 0,
      rootCauses: report.summary?.rootCauses || {}
    });
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED');
    return report;
  }

  async diagnose(id) {
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const before = this.publicAccount(account);
    let after = before;
    if (!['connected', 'limited'].includes(before.state) && !account.paused) {
      try { after = await this.connect(id); } catch (error) { after = { ...before, state: 'error', lastError: error.message }; }
    }
    const tests = [
      { id: 'metadata', name: '账号资料存在', pass: Boolean(account.displayName && account.platform), detail: account.displayName },
      { id: 'credentials', name: '登录凭据可用', pass: before.credentialReady, detail: account.platform === 'whatsapp' ? (platformDrivers.get('whatsapp').adapter.hasCredentials(account) ? 'Baileys多设备凭据已识别，等待真实连接确认' : '尚未完成二维码或配对登录') : (before.credentialReady ? account.platform === 'facebook' ? (String(account.accountKind || account.metadata?.accountKind || 'page').toLowerCase() === 'personal-messenger' ? '隔离 Matrix 身份凭据已进入桌面安全存储；Facebook 密码不持久化' : '云端主页授权与本机设备身份已进入安全存储（Page Token 不下发）') : '正式授权凭据已进入桌面安全存储' : '尚未完成正式授权') },
      { id: 'service', name: '平台服务可访问', pass: !['error', 'unconfigured'].includes(after.state), detail: after.lastError || after.stateLabel },
      { id: 'session', name: '登录会话有效', pass: ['connected', 'limited'].includes(after.state), detail: after.stateLabel },
      ...(account.platform === 'facebook' && String(account.accountKind || account.metadata?.accountKind || 'page').toLowerCase() === 'page' ? [
        { id: 'permissions', name: 'Page 消息权限', pass: after.permissionReady === true, detail: after.permissionReady ? 'Page 消息权限已满足' : `缺少权限：${(after.missingPermissions || []).join('、') || '尚未验证'}` },
        { id: 'subscription', name: 'Webhook messages 订阅', pass: after.subscriptionReady === true, detail: after.subscriptionReady ? 'messages 订阅已验证' : `当前订阅：${(after.subscriptionFields || []).join('、') || '尚未验证'}` }
      ] : []),
      { id: 'receive', name: '接收通道', pass: after.canReceive === true, detail: after.canReceive ? '可接收' : '尚未验证' },
      { id: 'send-attempt', name: '发送前置条件', pass: after.canAttemptSend === true, detail: after.canAttemptSend ? '允许进入持久化发件箱' : '账号或凭据尚未达到发送前置条件' },
      { id: 'send', name: '真实发送 ACK', pass: after.sendVerified === true, detail: after.sendVerified ? `已由真实平台 ACK 验证（${after.lastDeliveryAckAt || '时间未知'}）` : '尚无真实 text ACK，禁止显示为已验证可发送' },
      { id: 'sync', name: '同步状态', pass: Boolean(after.connectedAt || after.lastSyncAt), detail: after.lastSyncAt || after.connectedAt || '尚无成功同步' },
      { id: 'notifications', name: '通知策略', pass: account.notificationsEnabled !== false, detail: account.notificationsEnabled === false ? '账号通知已关闭' : '账号通知已启用' },
      { id: 'route', name: '会话路由', pass: Boolean(account.id && account.adapterAccountId), detail: `${account.platform}:${account.adapterAccountId}` }
    ];
    const evaluation = evaluateAccountDiagnostic(account.platform, tests);
    const report = { accountId: id, platform: account.platform, ...evaluation, tests, account: after, at: new Date().toISOString() };
    await accountStore.record('account-diagnosed', { accountId: id, health: report.health, pass: report.pass, fail: report.fail, criticalFailures: report.criticalFailures.map(row => row.id) });
    return report;
  }

  async sendText({ accountId, conversationId, recipientId, text, quoted = null, idempotencyKey = '' }) {
    systemPolicy.assertWriteAllowed('account-send-text');
    const requestedAccountId = String(accountId || '').trim();
    const requestedCanonicalId = canonicalIdentity.resolveCanonicalAccountId(requestedAccountId);
    const account = accountStore.get(requestedCanonicalId) || accountStore.get(requestedAccountId);
    if (!account) throw Object.assign(new Error('发送账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404, requestedAccountId });
    accountLifecycle.assertEligible(account, { manual: true });
    const canonicalAccountId = canonicalIdentity.resolveCanonicalAccountId(account.id, undefined, account.platform);
    if (canonicalAccountId !== account.id) throw Object.assign(new Error('发送账号是已合并别名'), { code: 'ACCOUNT_IDENTITY_ALIAS', status: 409, canonicalAccountId });
    const publicAccount = this.publicAccount(account);
    if (publicAccount.canAttemptSend !== true) throw Object.assign(new Error(`账号不满足发送前置条件：${publicAccount.stateLabel}`), { code: 'ACCOUNT_CANNOT_ATTEMPT_SEND', status: 409 });
    if (conversationId) {
      const conversation = messageStore.getConversation(conversationId);
      const bound = canonicalIdentity.resolveCanonicalAccountId(conversation?.accountId || '', undefined, account.platform);
      // A brand-new direct-send session may not have a conversation row yet; bind it atomically
      // after the queue accepts the item. Existing conversations must never silently switch routes.
      if (conversation && (!bound || bound !== canonicalAccountId)) {
        throw Object.assign(new Error('当前会话绑定账号与发送来源不一致，已阻止发送'), {
          code: 'CONVERSATION_ACCOUNT_ROUTE_CONFLICT', status: 409,
          conversationId, boundAccountId: bound, requestedAccountId: canonicalAccountId
        });
      }
    }
    const queue = await sendQueue.enqueueText({
      platform: account.platform,
      accountId: account.id,
      sessionKey: conversationId || `${account.id}:${recipientId}`,
      chatJid: recipientId,
      text,
      quoted,
      idempotencyKey
    });
    const terminal = sendQueue.status().started ? await sendQueue.waitForTerminal(queue.id, 7000) : { queue };
    return { ...terminal, queue: terminal.queue || queue };
  }

  onWhatsAppEvent(payload) {
    const accounts = accountStore.list().filter(row =>
      row.platform === 'whatsapp'
      && accountLifecycle.eligibility(row, { manual: true }).eligible
      && this.whatsappAuthKey(row) === payload.accountId
    );
    if (!accounts.length) return;
    for (const account of accounts) {
      const previous = this.runtime.get(account.id) || {};
      const normalizedState = platformDrivers.mapWhatsAppState(payload.state);
      const runtime = {
        ...previous,
        ...payload,
        state: normalizedState,
        lastError: payload.lastError || payload.error || (['connected', 'waiting-verification', 'connecting'].includes(normalizedState) ? '' : previous.lastError || ''),
        reasonCode: payload.reasonCode || payload.code || (['connected', 'waiting-verification', 'connecting'].includes(normalizedState) ? '' : previous.reasonCode || '')
      };
      this.runtime.set(account.id, runtime);
      if (['connected', 'limited'].includes(runtime.state) || payload.user) {
        this.updateIdentityFromRuntime(account, runtime)
          .then(() => this.publishSummary())
          .catch(error => logCriticalFailure('whatsapp.event.updateIdentityFromRuntime', error, { accountId: account.id }));
      }
    }
    this.publishSummary();
  }

  onAdapterState(payload) {
    if (!payload.accountId) return;
    const previous = this.runtime.get(payload.accountId) || {};
    const normalized = {
      ...previous,
      ...payload,
      lastError: payload.lastError || payload.error || previous.lastError || '',
      reasonCode: payload.reasonCode || payload.code || previous.reasonCode || ''
    };
    this.runtime.set(payload.accountId, normalized);
    const account = accountStore.get(payload.accountId);
    if (account && (['connected', 'limited'].includes(String(normalized.state || '').toLowerCase()) || payload.user || payload.page)) {
      this.updateIdentityFromRuntime(account, normalized)
        .then(() => this.publishSummary())
        .catch(error => {
          logCriticalFailure('adapter.state.updateIdentityFromRuntime', error, { accountId: account.id });
          this.publishSummary();
        });
      return;
    }
    this.publishSummary();
  }


  async shutdown(reason = 'runtime-shutdown') {
    for (const account of accountStore.list()) {
      try { await this.disconnect(account.id, { logout: false, transient: true, reason }); } catch (error) { logCriticalFailure('account.shutdown.disconnect', error, { accountId: account.id }); }
    }
  }

  publishSummary() {
    try {
      const data = this.list();
      for (const account of data.accounts || []) {
        eventBus.publish('account:authority-state', {
          ...account,
          accountId: account.id,
          authority: 'AccountManager.publicAccount',
          authorityVersion: 'batch22-v1'
        });
      }
      eventBus.publish('accounts:summary', data.summary);
    } catch (error) {
      logger.error('accounts', 'summary-failed', { error: error.message });
    }
  }
}

module.exports = new AccountManager();
module.exports.AccountManager = AccountManager;
module.exports.CAPABILITY_MATRIX = CAPABILITY_MATRIX;