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

const { MATRIX: CAPABILITY_MATRIX, publicContracts } = require('./platformCapabilities');
const RECEIVE_DEPENDENT_CAPABILITIES = new Set(['incomingTyping', 'terminalPresence', 'contacts', 'historySync', 'lottieSticker', 'animatedEmojiDisplay']);
const BIDIRECTIONAL_CAPABILITIES = new Set(['sticker', 'animatedSticker']);

function driverFor(account) { return platformDrivers.getForAccount ? platformDrivers.getForAccount(account) : platformDrivers.get(account.platform); }


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
    this.connectedFinalizers = new Map();
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
      for (const account of accountStore.listAll()) {
        let runtime;
        try { runtime = driverFor(account).status(account); }
        catch (error) { runtime = { state: 'recovering', reasonCode: error.code || 'ADAPTER_STATUS_RECOVERY_PENDING', lastError: error.message }; }
        this.runtime.set(account.id, runtime || { state: 'recovering', reasonCode: 'ADAPTER_STATUS_RECOVERY_PENDING' });
        await accountLifecycleSaga.settleLatestFromAdapter(account.id, runtime?.state || 'recovering', runtime || {});
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
      const row = driverFor(account).status(account);
      const authoritative = this.runtime.get(account.id) || null;
      const adapterAttemptId = String(row?.attemptId || row?.connectionAttemptId || '');
      const activeAttemptId = String(authoritative?.connectionAttemptId || authoritative?.attemptId || '');
      if (row && authoritative && activeAttemptId && adapterAttemptId && activeAttemptId !== adapterAttemptId) {
        logger.warn('accounts', 'stale-adapter-status-ignored', {
          accountId: account.id,
          platform: account.platform,
          adapterAttemptId,
          activeAttemptId,
          state: String(row.state || '')
        });
        return authoritative;
      }
      return row || authoritative || { state: account.paused ? 'paused' : 'logged-out', lastError: '', connectedAt: '', user: null };
    } catch (error) {
      logCriticalFailure('platformDriver.status', error, { accountId: account?.id || '', platform: account?.platform || '' });
      return this.runtime.get(account.id) || { state: 'unconfigured', lastError: error.message || '' };
    }
  }

  publicAccount(account) {
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
    const runtime = this.rawRuntime(account);
    const runtimeState = String(runtime.state || 'unconfigured').trim().toLowerCase();
    const explicitlyLoggedOut = ['logged-out', 'logged_out'].includes(runtimeState) || account.metadata?.loggedOut === true;
    const state = explicitlyLoggedOut ? 'logged-out' : (account.paused ? 'paused' : runtimeState);
    const authorizationPending = account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true;
    const latestSaga = accountLifecycleSaga.latest(account.id);
    const lifecycleAuthorityPending = Boolean(latestSaga && ['running', 'compensating', 'manual_review'].includes(latestSaga.state));
    const authorityPending = authorizationPending || lifecycleAuthorityPending;
    const unread = this.accountUnread(account.id);
    const driver = driverFor(account);
    const whatsappCredential = account.platform === 'whatsapp' ? driver.credentialState(account) : null;
    const platformSecret = account.platform === 'whatsapp' ? null : (securityGuard.credentials.get(account.credentialRef) || {});
    const credentialReady = driver.credentialReady(account, platformSecret);
    const messagingSupported = driver.messagingSupported !== false;
    const capabilities = messagingSupported ? { ...CAPABILITY_MATRIX[account.platform] } : Object.fromEntries(Object.keys(CAPABILITY_MATRIX[account.platform] || {}).map(name => [name, false]));
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
      lifecycleOperation: latestSaga ? { operationId: latestSaga.operation_id, operationType: latestSaga.operation_type, phase: latestSaga.phase, state: latestSaga.state, lastError: latestSaga.last_error || '' } : null,
      state,
      stateLabel: authorizationPending ? '等待平台授权' : latestSaga?.state === 'manual_review' ? '账号状态需要人工恢复' : lifecycleAuthorityPending ? '正在恢复账号状态' : stateLabel(state),
      health: healthFromState(state),
      lastError: runtime.lastError || runtime.error || '',
      reasonCode: runtime.reasonCode || runtime.code || '',
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
    if (!['whatsapp', 'telegram'].includes(account.platform)) {
      throw Object.assign(new Error('当前平台不使用二维码认证挑战'), { code: 'AUTH_CHALLENGE_UNSUPPORTED', status: 409 });
    }
    const adapterAccountId = account.platform === 'whatsapp' ? this.whatsappAuthKey(account) : account.id;
    const challenge = authChallenges.read(account.id, { includeSecret: true }) || authChallenges.read(adapterAccountId, { includeSecret: true });
    return {
      accountId: account.id,
      state: this.publicAccount(account).state,
      challenge
    };
  }

  async create(input) {
    platformAuthConfig.assertAvailable(input?.platform, 'create');
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
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    accountLifecycle.assertEligible(account, { manual: true });
    platformAuthConfig.assertAvailable(account.platform, 'connect');
    if (account.paused) { await accountStore.update(account.id, { paused: false, lifecycleState: 'active' }); account = accountStore.get(account.id); }
    const canonicalId = canonicalIdentity.resolveCanonicalAccountId(account.id);
    if (canonicalId !== account.id) throw Object.assign(new Error('重复账号已合并，不能独立连接'), { code: 'ACCOUNT_IDENTITY_ALIAS', status: 409, canonicalAccountId: canonicalId });
    assertOperationActive(options.signal, 'ACCOUNT_CONNECT_ABORTED');
    const attemptId = String(options.attemptId || '').trim() || crypto.randomUUID();
    const connectionStartedAt = new Date().toISOString();
    const saga = await accountLifecycleSaga.begin(account, 'connect', { operationId: `account-connect-${attemptId}` });
    await accountLifecycleSaga.setPhase(saga.operation_id, 'prepared', 'adapter_connect_started');
    this.runtime.set(account.id, { state: 'connecting', lastError: '', reasonCode: '', connectedAt: '', connectionAttemptId: attemptId, connectionStartedAt, connectionFinishedAt: '' });
    this.publishSummary();
    let result;
    let adapterStarted = false;
    const driver = driverFor(account);
    try {
      result = await withAbortSignal(
        driver.connect(account, {
          manual: true,
          attemptId,
          signal: options.signal || null,
          executionGeneration: options.operationGeneration || attemptId,
          physicalOperationContext: options.physicalOperationContext,
          secret: securityGuard.credentials.get(account.credentialRef) || {}
        }),
        options.signal,
        'ACCOUNT_CONNECT_ABORTED'
      );
      adapterStarted = true;
      assertOperationActive(options.signal, 'ACCOUNT_CONNECT_ABORTED');
      const state = String(result?.state || '').toLowerCase();
      const currentRuntime = this.runtime.get(account.id) || {};
      if (String(currentRuntime.connectionAttemptId || '') !== attemptId) {
        throw Object.assign(new Error('Account connect completion belongs to a stale generation'), {
          code: 'ACCOUNT_CONNECT_GENERATION_STALE',
          accountId: account.id,
          expectedAttemptId: String(currentRuntime.connectionAttemptId || ''),
          receivedAttemptId: attemptId
        });
      }
      this.runtime.set(account.id, { ...currentRuntime, ...(result || {}), connectionAttemptId: attemptId, connectionStartedAt, connectionFinishedAt: ['connected', 'limited', 'error', 'logged-out'].includes(state) ? new Date().toISOString() : '' });
      if (['connected','limited'].includes(state)) {
        await this.finalizeConnectedSagaFromRuntime(account, result, { resultState: state, attemptId, connectionStartedAt, source: 'connect-return' });
      } else {
        await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_connect_started', 'adapter_waiting_authorization', { adapterReceipt: result });
      }
      this.publishSummary();
      return this.publicAccount(accountStore.get(id));
    } catch (error) {
      if (!adapterStarted) {
        try { adapterStarted = Boolean(driver.status(account)); }
        catch (statusError) { logCriticalFailure('account.connect.driverStatus', statusError, { accountId: id, platform: account.platform, attemptId }); }
      }
      const currentSaga = accountLifecycleSaga.get(saga.operation_id);
      if (currentSaga && currentSaga.state === 'running') await accountLifecycleSaga.markCompensating(saga.operation_id, currentSaga.phase, error);
      let rollbackFailed = false;
      if (adapterStarted) {
        try { await withTimeout(driverFor(account).disconnect(account, { logout: false }), 5000, 'ACCOUNT_CONNECT_ROLLBACK_TIMEOUT'); }
        catch (rollbackError) {
          rollbackFailed = true;
          logger.error('accounts', 'account-connect-adapter-rollback-failed', { accountId: id, platform: account.platform, errorCode: rollbackError.code || rollbackError.message });
        }
      }
      await accountLifecycleSaga.finish(saga.operation_id, rollbackFailed ? 'manual_review' : 'failed', { lastError: error.message, adapterReceipt: result || {} });
      const expiredAttemptId = options.signal?.aborted
        ? `expired:${attemptId}:${crypto.randomUUID()}`
        : attemptId;
      this.runtime.set(id, { state: 'error', lastError: error.message || String(error), reasonCode: error.code || 'ACCOUNT_CONNECT_FAILED', connectedAt: '', connectionAttemptId: expiredAttemptId, connectionStartedAt, connectionFinishedAt: new Date().toISOString() });
      await accountStore.record('account-connect-failed', { accountId: id, platform: account.platform, code: error.code || '', adapterRolledBack: adapterStarted && !rollbackFailed, attemptId, connectionStartedAt });
      logger.warn('accounts', 'account-connect-failed', { accountId: id, platform: account.platform, errorCode: error.code || error.message, adapterRolledBack: adapterStarted && !rollbackFailed, attemptId, connectionStartedAt });
      this.publishSummary();
      if (account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true) {
        await this.discardPendingAuthorization(account.id, error.code || 'connect-failed', { skipAdapterStop: adapterStarted && !rollbackFailed });
      }
      throw error;
    }
  }

  async sync(id, options = {}) {
    assertOperationActive(options.signal, 'ACCOUNT_SYNC_ABORTED');
    const account = accountStore.get(id);
    if (!account) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const publicAccount = this.publicAccount(account);
    if (!publicAccount.canReceive) throw Object.assign(new Error(`账号不可同步：${publicAccount.stateLabel}`), { code: 'ACCOUNT_CANNOT_SYNC', status: 409 });
    if (account.platform === 'facebook' && publicAccount.historySyncAvailable !== true) {
      const reason = publicAccount.historySyncReason || 'pages_read_engagement 尚未授权，无法读取 Meta Business Suite 最近会话';
      throw Object.assign(new Error(reason), {
        code: 'FACEBOOK_HISTORY_PERMISSION_MISSING',
        status: 409,
        missingPermissions: publicAccount.missingOptionalPermissions || ['pages_read_engagement']
      });
    }
    const result = await withAbortSignal(
      driverFor(account).sync(account, {
        signal: options.signal || null,
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
    const operationType = logout ? 'logout' : 'disconnect';
    const saga = transient ? null : await accountLifecycleSaga.begin(account, operationType);
    let result = null;
    try {
      if (saga) {
        await accountStore.update(id, {
          paused: true,
          lifecycleState: 'paused',
          metadata: { lifecyclePending: true, lifecycleOperationId: saga.operation_id, lifecycleOperation: operationType }
        });
        await accountLifecycleSaga.setPhase(saga.operation_id, 'prepared', 'sqlite_mark_disconnect_pending');
        await accountLifecycleSaga.setPhase(saga.operation_id, 'sqlite_mark_disconnect_pending', 'adapter_disconnect_started');
      }
      result = await withAbortSignal(
        driverFor(account).disconnect(account, {
          logout,
          signal: options.signal || null,
          executionGeneration: options.operationGeneration || ''
        }),
        options.signal,
        logout ? 'ACCOUNT_LOGOUT_ABORTED' : 'ACCOUNT_DISCONNECT_ABORTED'
      );
      assertOperationActive(options.signal, logout ? 'ACCOUNT_LOGOUT_ABORTED' : 'ACCOUNT_DISCONNECT_ABORTED');
      if (saga) await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_disconnect_started', 'adapter_disconnected', { adapterReceipt: result });
      if (logout && ['telegram', 'facebook'].includes(account.platform)) {
        assertOperationActive(options.signal, 'ACCOUNT_LOGOUT_ABORTED');
        await securityGuard.credentials.remove(account.credentialRef, { actor: 'platform-adapter' });
        assertOperationActive(options.signal, 'ACCOUNT_LOGOUT_ABORTED');
        if (saga) await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_disconnected', 'credential_delete_committed');
      }
      this.runtime.set(id, { state: logout ? 'logged-out' : (transient ? 'offline' : 'paused'), lastError: '', connectedAt: '' });
      if (!transient) {
        await accountStore.commitLifecycleTx(id, {
          paused: true,
          lifecycleState: 'paused',
          metadata: { lifecyclePending: false, lifecycleOperationId: '', lifecycleOperation: '', loggedOut: logout }
        }, {
          action: logout ? 'account-logout' : 'account-paused',
          detail: { operationId: saga.operation_id }
        });
        const current = accountLifecycleSaga.get(saga.operation_id);
        await accountLifecycleSaga.setPhase(saga.operation_id, current.phase, 'sqlite_lifecycle_committed');
        await accountLifecycleSaga.finish(saga.operation_id, 'succeeded', { adapterReceipt: result });
      } else {
        logger.info('accounts', 'account-runtime-stopped', { accountId: id, platform: account.platform, reason: String(options.reason || 'transient-stop') });
      }
      this.publishSummary();
      return { ...result, transient, account: this.publicAccount(accountStore.get(id)) };
    } catch (error) {
      if (saga) await accountLifecycleSaga.finish(saga.operation_id, 'manual_review', { lastError: error.message, adapterReceipt: result || {} });
      const outcomeUnknown = options.signal?.aborted || /(?:DEADLINE|ABORT)/u.test(String(error?.code || ''));
      this.runtime.set(id, {
        state: outcomeUnknown ? 'error' : 'paused',
        lastError: error.message || String(error),
        reasonCode: outcomeUnknown ? 'ACCOUNT_DISCONNECT_OUTCOME_UNKNOWN' : (error.code || 'ACCOUNT_DISCONNECT_REQUIRES_RECONCILIATION'),
        connectedAt: '', connectionAttemptId: outcomeUnknown ? `expired:disconnect:${crypto.randomUUID()}` : ''
      });
      this.publishSummary();
      throw error;
    }
  }

  async resume(id, options = {}) {
    await accountStore.update(id, { paused: false });
    return this.connect(id, options);
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

  async selectFacebookPage(id, flowId, pageId, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
    const selected = await withAbortSignal(facebookOAuth.selectPage(id, flowId, pageId, options), options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
    const connected = await this.connect(id, { signal: options.signal, attemptId: options.operationGeneration, operationGeneration: options.operationGeneration, physicalOperationContext: options.physicalOperationContext });
    assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
    this.publishSummary();
    return { account: connected, page: selected.page };
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

  async startTelegramQr(id, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'telegram') throw Object.assign(new Error('Telegram账号不存在'), { code: 'TELEGRAM_ACCOUNT_NOT_FOUND', status: 404 });
    const result = await withAbortSignal(
      driverFor(account).beginQrLogin(account, options),
      options.signal,
      'TELEGRAM_QR_START_ABORTED'
    );
    this.runtime.set(id, result);
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
  }

  async startTelegramPhone(id, phoneNumber, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'telegram') throw Object.assign(new Error('Telegram账号不存在'), { code: 'TELEGRAM_ACCOUNT_NOT_FOUND', status: 404 });
    const result = await withAbortSignal(
      driverFor(account).beginPhoneLogin(account, phoneNumber, options),
      options.signal,
      'TELEGRAM_PHONE_START_ABORTED'
    );
    this.runtime.set(id, result);
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
  }

  async cancelTelegramLogin(id, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'telegram') throw Object.assign(new Error('Telegram账号不存在'), { code: 'TELEGRAM_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED');
    const result = await withAbortSignal(driverFor(account).cancelLogin(account, options), options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED');
    assertOperationActive(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED');
    this.runtime.set(id, result);
    if (account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true) {
      await this.discardPendingAuthorization(id, 'telegram-login-cancelled', { skipAdapterStop: true });
      assertOperationActive(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED');
      return { ...account, state: 'cancelled', stateLabel: '已取消授权', removed: true, authorizationPending: false };
    }
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
  }

  async submitTelegramCode(id, code, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'telegram') throw Object.assign(new Error('Telegram账号不存在'), { code: 'TELEGRAM_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED');
    const result = await withAbortSignal(driverFor(account).submitCode(account, code, options), options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED');
    assertOperationActive(options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED');
    await this.updateIdentityFromRuntime(accountStore.get(id), result).catch(error => logCriticalFailure('telegram.submitCode.updateIdentityFromRuntime', error, { accountId: id }));
    assertOperationActive(options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED');
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
  }

  async submitTelegramPassword(id, password, options = {}) {
    const account = accountStore.get(id);
    if (!account || account.platform !== 'telegram') throw Object.assign(new Error('Telegram账号不存在'), { code: 'TELEGRAM_ACCOUNT_NOT_FOUND', status: 404 });
    assertOperationActive(options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED');
    const result = await withAbortSignal(driverFor(account).submitPassword(account, password, options), options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED');
    assertOperationActive(options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED');
    await this.updateIdentityFromRuntime(accountStore.get(id), result).catch(error => logCriticalFailure('telegram.submitPassword.updateIdentityFromRuntime', error, { accountId: id }));
    assertOperationActive(options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED');
    this.publishSummary();
    return this.publicAccount(accountStore.get(id));
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

  async commitConnectedIdentityFromRuntime(account, result, detail = {}) {
    const patch = this.identityPatchFromRuntime(account, result) || {};
    return accountStore.commitConnectedIdentityTx(account.id, patch, {
      ...detail,
      resultState: String(detail.resultState || result.state || '')
    });
  }

  async finalizeConnectedSagaFromRuntime(account, result, detail = {}) {
    if (!account || !result) return null;
    const saga = accountLifecycleSaga.latest(account.id, 'connect');
    if (!saga || !['running','compensating'].includes(saga.state)) {
      return this._finalizeConnectedSagaFromRuntime(account, result, detail);
    }
    const key = saga.operation_id;
    if (this.connectedFinalizers.has(key)) return await this.connectedFinalizers.get(key);
    const task = this._finalizeConnectedSagaFromRuntime(account, result, detail);
    this.connectedFinalizers.set(key, task);
    try { return await task; }
    finally { if (this.connectedFinalizers.get(key) === task) this.connectedFinalizers.delete(key); }
  }

  async _finalizeConnectedSagaFromRuntime(account, result, detail = {}) {
    if (!account || !result) return null;
    let saga = accountLifecycleSaga.latest(account.id, 'connect');
    if (!saga || !['running','compensating'].includes(saga.state)) {
      await this.updateIdentityFromRuntime(account, result);
      return { updated: false, saga, account: accountStore.get(account.id) };
    }
    try {
      if (['adapter_connect_started','adapter_waiting_authorization'].includes(saga.phase)) {
        try {
          saga = await accountLifecycleSaga.setPhase(saga.operation_id, saga.phase, 'adapter_connected', { adapterReceipt: result });
        } catch (error) {
          if (error.code !== 'ACCOUNT_SAGA_STALE_TRANSITION') throw error;
          saga = accountLifecycleSaga.get(saga.operation_id);
        }
      }
      if (saga?.phase === 'adapter_connected') {
        let ownsCommit = false;
        try {
          saga = await accountLifecycleSaga.setPhase(saga.operation_id, 'adapter_connected', 'sqlite_identity_committing', { adapterReceipt: result });
          ownsCommit = true;
        } catch (error) {
          if (error.code !== 'ACCOUNT_SAGA_STALE_TRANSITION') throw error;
          saga = accountLifecycleSaga.get(saga.operation_id);
        }
        if (ownsCommit) {
          await this.commitConnectedIdentityFromRuntime(accountStore.get(account.id) || account, result, { ...detail, operationId: saga.operation_id });
          saga = await accountLifecycleSaga.setPhase(saga.operation_id, 'sqlite_identity_committing', 'sqlite_identity_committed', { adapterReceipt: result });
        }
      }
      saga = accountLifecycleSaga.get(saga.operation_id);
      if (saga?.phase === 'sqlite_identity_committed' && ['running','compensating'].includes(saga.state)) {
        await accountLifecycleSaga.finish(saga.operation_id, 'succeeded', { adapterReceipt: result });
      }
      return { updated: true, saga: accountLifecycleSaga.get(saga.operation_id), account: accountStore.get(account.id) };
    } catch (error) {
      const current = accountLifecycleSaga.get(saga.operation_id);
      if (current && ['running','compensating'].includes(current.state)) {
        try {
          if (current.state === 'running') await accountLifecycleSaga.markCompensating(current.operation_id, current.phase, error);
          await accountLifecycleSaga.finish(current.operation_id, 'manual_review', { lastError: error.code || error.message, adapterReceipt: result });
        } catch (settleError) {
          logCriticalFailure('accountSaga.connectedRuntime.settleFailure', settleError, { accountId: account.id, operationId: current.operation_id });
        }
      }
      throw error;
    }
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
      { id: 'credentials', name: '登录凭据可用', pass: before.credentialReady, detail: account.platform === 'whatsapp' ? (platformDrivers.get('whatsapp').adapter.hasCredentials(account) ? 'Baileys多设备凭据已识别，等待真实连接确认' : '尚未完成二维码或配对登录') : (before.credentialReady ? account.platform === 'facebook' ? '云端主页授权与本机设备身份已进入安全存储（Page Token 不下发）' : '正式授权凭据已进入桌面安全存储' : '尚未完成正式授权') },
      { id: 'service', name: '平台服务可访问', pass: !['error', 'unconfigured'].includes(after.state), detail: after.lastError || after.stateLabel },
      { id: 'session', name: '登录会话有效', pass: ['connected', 'limited'].includes(after.state), detail: after.stateLabel },
      ...(account.platform === 'facebook' ? [
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
    const accounts = accountStore.list().filter(row => row.platform === 'whatsapp' && accountLifecycle.eligibility(row, { manual: true }).eligible && this.whatsappAuthKey(row) === payload.accountId);
    if (!accounts.length) return;
    for (const account of accounts) {
      const previous = this.runtime.get(account.id) || {};
      const eventAttemptId = String(payload.attemptId || '');
      const activeAttemptId = String(previous.connectionAttemptId || '');
      if (eventAttemptId && activeAttemptId && eventAttemptId !== activeAttemptId) {
        logger.warn('accounts', 'stale-whatsapp-state-ignored', {
          accountId: account.id,
          adapterAccountId: String(payload.accountId || ''),
          eventAttemptId,
          activeAttemptId,
          state: String(payload.state || '')
        });
        continue;
      }
      const normalizedState = platformDrivers.mapWhatsAppState(payload.state);
      const runtime = {
        ...previous,
        ...payload,
        state: normalizedState,
        lastError: payload.lastError || payload.error || (['connected', 'waiting-verification', 'connecting'].includes(normalizedState) ? '' : previous.lastError || ''),
        reasonCode: payload.reasonCode || payload.code || (['connected', 'waiting-verification', 'connecting'].includes(normalizedState) ? '' : previous.reasonCode || ''),
        connectionAttemptId: payload.attemptId || previous.connectionAttemptId || '',
        connectionFinishedAt: ['connected', 'error', 'logged-out'].includes(normalizedState) ? new Date().toISOString() : previous.connectionFinishedAt || ''
      };
      this.runtime.set(account.id, runtime);
      if (['connected','limited'].includes(runtime.state)) {
        void this.finalizeConnectedSagaFromRuntime(account, runtime, {
          resultState: runtime.state,
          attemptId: runtime.connectionAttemptId || '',
          connectionStartedAt: previous.connectionStartedAt || '',
          source: 'whatsapp-state-event'
        }).then(() => this.publishSummary())
          .catch(error => logCriticalFailure('accountSaga.finalizeConnected.whatsapp', error, { accountId: account.id }));
      } else {
        void accountLifecycleSaga.settleLatestFromAdapter(account.id, runtime.state, runtime)
          .catch(error => logCriticalFailure('accountSaga.settleLatestFromAdapter.whatsapp', error, { accountId: account.id }));
        if (payload.user) this.updateIdentityFromRuntime(account, runtime)
          .then(() => this.publishSummary())
          .catch(error => logCriticalFailure('whatsapp.event.updateIdentityFromRuntime', error, { accountId: account.id }));
      }
      if (runtime.state === 'error' && (account.lifecycleState === 'pending-auth' || account.metadata?.authorizationPending === true)) {
        this.discardPendingAuthorization(account.id, runtime.reasonCode || runtime.lastError || 'whatsapp-authorization-failed')
          .catch(error => logCriticalFailure('whatsapp.event.discardPendingAuthorization', error, { accountId: account.id }));
      }
    }
    this.publishSummary();
  }

  onAdapterState(payload) {
    if (!payload.accountId) return;
    const previous = this.runtime.get(payload.accountId) || {};
    const eventAttemptId = String(payload.attemptId || '');
    const activeAttemptId = String(previous.connectionAttemptId || '');
    if (eventAttemptId && activeAttemptId && eventAttemptId !== activeAttemptId) {
      logger.warn('accounts', 'stale-adapter-state-ignored', {
        accountId: String(payload.accountId || ''),
        eventAttemptId,
        activeAttemptId,
        state: String(payload.state || '')
      });
      return;
    }
    const normalized = { ...previous, ...payload, lastError: payload.lastError || payload.error || previous.lastError || '', reasonCode: payload.reasonCode || payload.code || previous.reasonCode || '' };
    this.runtime.set(payload.accountId, normalized);
    const account = accountStore.get(payload.accountId);
    if (account && ['connected','limited'].includes(String(normalized.state || '').toLowerCase())) {
      void this.finalizeConnectedSagaFromRuntime(account, normalized, {
        resultState: normalized.state,
        attemptId: normalized.attemptId || normalized.connectionAttemptId || '',
        connectionStartedAt: previous.connectionStartedAt || '',
        source: 'adapter-state-event'
      }).then(() => this.publishSummary())
        .catch(error => { logCriticalFailure('accountSaga.finalizeConnected.adapter', error, { accountId: account.id }); this.publishSummary(); });
      return;
    }
    void accountLifecycleSaga.settleLatestFromAdapter(payload.accountId, normalized.state || '', normalized)
      .catch(error => logCriticalFailure('accountSaga.settleLatestFromAdapter.adapter', error, { accountId: payload.accountId }));
    if (account && (payload.user || payload.page)) {
      this.updateIdentityFromRuntime(account, normalized)
        .then(() => this.publishSummary())
        .catch(error => { logCriticalFailure('adapter.state.updateIdentityFromRuntime', error, { accountId: account.id }); this.publishSummary(); });
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
