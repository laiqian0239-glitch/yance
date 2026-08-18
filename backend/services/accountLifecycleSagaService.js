'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const accountStore = require('./accountStore');
const platformDrivers = require('./platformDriverRegistry');
const logger = require('./logger');
const communicationAuthority = require('./communicationAuthority');
const { DurableExecutionAuthority } = require('./durableExecutionAuthority');
const { ExternalActionOutboxAuthority } = require('./externalActionOutboxAuthority');
const { executePreparedOperation } = require('./externalActionDispatcher');

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function json(value) { try { return JSON.stringify(value || {}); } catch (_) { return '{}'; } }
function parse(value) { try { return JSON.parse(value || '{}') || {}; } catch (_) { return {}; } }

class AccountLifecycleSagaService {
  constructor(options = {}) {
    this.storeProvider = options.storeProvider || getStore;
    this.accountStore = options.accountStore || accountStore;
    this.platformDrivers = options.platformDrivers || platformDrivers;
    this._credentials = options.credentials || null;
    this._durableDispatch = null;
    this._durableDispatchState = Object.freeze({ configured: false, startupDispatched: 0, startupSkipped: 0 });
  }

  store() { return this.storeProvider(); }

  async begin(account, operationType, input = {}) {
    if (!account?.id) throw Object.assign(new Error('Account saga requires persisted account'), { code: 'ACCOUNT_SAGA_ACCOUNT_REQUIRED' });
    const operationId = clean(input.operationId) || `acct-saga-${crypto.randomUUID()}`;
    const at = nowIso();
    const store = this.store();
    await store.transactionAsync(async () => {
      store.db.prepare(`INSERT INTO account_lifecycle_saga(
      operation_id,account_id,operation_type,phase,state,credential_generation,account_version,
      adapter_receipt_json,last_error,started_at,updated_at,finished_at
    ) VALUES(?,?,?,'prepared','running',?,?,'{}','',?,?,'')`)
        .run(operationId, account.id, clean(operationType), clean(input.credentialGeneration), Number(input.accountVersion || 0), at, at);
    });
    return this.get(operationId);
  }

  get(operationId) {
    const row = this.store().db.prepare('SELECT * FROM account_lifecycle_saga WHERE operation_id=?').get(clean(operationId));
    return row ? { ...row, adapterReceipt: parse(row.adapter_receipt_json) } : null;
  }

  latest(accountId, operationType = '') {
    const type = clean(operationType);
    const row = type
      ? this.store().db.prepare('SELECT * FROM account_lifecycle_saga WHERE account_id=? AND operation_type=? ORDER BY started_at DESC LIMIT 1').get(clean(accountId), type)
      : this.store().db.prepare('SELECT * FROM account_lifecycle_saga WHERE account_id=? ORDER BY started_at DESC LIMIT 1').get(clean(accountId));
    return row ? { ...row, adapterReceipt: parse(row.adapter_receipt_json) } : null;
  }

  async setPhase(operationId, expectedPhase, nextPhase, patch = {}) {
    const at = nowIso();
    const store = this.store();
    let run;
    await store.transactionAsync(async () => {
      run = store.db.prepare(`UPDATE account_lifecycle_saga
      SET phase=?,credential_generation=CASE WHEN ?<>'' THEN ? ELSE credential_generation END,
          account_version=CASE WHEN ?>0 THEN ? ELSE account_version END,
          adapter_receipt_json=CASE WHEN ?<>'' THEN ? ELSE adapter_receipt_json END,
          last_error=?,updated_at=?
      WHERE operation_id=? AND state IN ('running','compensating') AND phase=?`)
      .run(clean(nextPhase), clean(patch.credentialGeneration), clean(patch.credentialGeneration), Number(patch.accountVersion || 0), Number(patch.accountVersion || 0),
        patch.adapterReceipt == null ? '' : 'provided', patch.adapterReceipt == null ? '' : json(patch.adapterReceipt), clean(patch.lastError).slice(0, 2000), at,
          clean(operationId), clean(expectedPhase));
    });
    if (Number(run.changes || 0) !== 1) throw Object.assign(new Error('Stale account saga transition'), {
      code: 'ACCOUNT_SAGA_STALE_TRANSITION', operationId, expectedPhase, nextPhase
    });
    return this.get(operationId);
  }

  async markCompensating(operationId, expectedPhase, error = null) {
    const at = nowIso();
    const store = this.store();
    let run;
    await store.transactionAsync(async () => {
      run = store.db.prepare(`UPDATE account_lifecycle_saga
        SET state='compensating',phase='compensating',last_error=?,updated_at=?
        WHERE operation_id=? AND state='running' AND phase=?`)
        .run(clean(error?.message || error?.code || error).slice(0, 2000), at, clean(operationId), clean(expectedPhase));
    });
    if (!run.changes) {
      const current = this.get(operationId);
      if (!current || !['running','compensating'].includes(current.state)) return current;
    }
    return this.get(operationId);
  }

  async finish(operationId, state = 'succeeded', patch = {}) {
    const target = ['succeeded','failed','manual_review'].includes(state) ? state : 'failed';
    const at = nowIso();
    const store = this.store();
    let run;
    await store.transactionAsync(async () => {
      run = store.db.prepare(`UPDATE account_lifecycle_saga
        SET state=?,phase='finished',adapter_receipt_json=CASE WHEN ?<>'' THEN ? ELSE adapter_receipt_json END,
            last_error=?,finished_at=?,updated_at=?
        WHERE operation_id=? AND state IN ('running','compensating')`)
        .run(target, patch.adapterReceipt == null ? '' : 'provided', patch.adapterReceipt == null ? '' : json(patch.adapterReceipt),
          clean(patch.lastError).slice(0, 2000), at, at, clean(operationId));
    });
    return { updated: Number(run.changes || 0) === 1, saga: this.get(operationId) };
  }

  async settleLatestFromAdapter(accountId, state, detail = {}) {
    const saga = this.latest(accountId, 'connect');
    if (!saga || !['running','compensating'].includes(saga.state)) return null;
    const normalized = clean(state).toLowerCase();
    if (['connected','limited'].includes(normalized)) {
      if (saga.phase === 'sqlite_identity_committed') return await this.finish(saga.operation_id, 'succeeded', { adapterReceipt: detail });
      return { updated: false, requiresIdentityCommit: true, saga };
    }
    if (['error','logged-out','logged_out','cancelled'].includes(normalized)) {
      if (saga.phase === 'sqlite_identity_committed') return { updated: false, saga };
      return await this.finish(saga.operation_id, 'failed', { lastError: detail.error || detail.lastError || normalized, adapterReceipt: detail });
    }
    return { updated: false, saga };
  }

  credentials() {
    if (this._credentials) return this._credentials;
    try { return require('../core/securityGuardSingleton').getSecurityGuard().credentials; }
    catch (_) { return null; }
  }

  async _setLifecycleProjection(account, row, options = {}) {
    if (typeof this.accountStore.commitLifecycleTx !== 'function' && typeof this.accountStore.update !== 'function') {
      throw Object.assign(new Error('Account repository cannot converge lifecycle projection'), { code: 'ACCOUNT_SAGA_REPOSITORY_UNAVAILABLE' });
    }
    const logout = options.logout === true;
    const remove = options.remove === true;
    const metadata = {
      ...(account.metadata || {}),
      lifecyclePending: false,
      lifecycleOperationId: '',
      lifecycleOperation: '',
      lifecycleClearCredentials: false,
      lifecycleLogout: false,
      loggedOut: logout,
      ...(remove ? { removalPendingCleanup: false } : {})
    };
    const patch = {
      paused: true,
      lifecycleState: remove ? 'tombstoned' : 'paused',
      metadata
    };
    const audit = {
      action: remove ? 'account-remove-recovered' : (logout ? 'account-logout-recovered' : 'account-disconnect-recovered'),
      detail: { operationId: row.operation_id, recoveredPhase: row.phase }
    };
    if (typeof this.accountStore.commitLifecycleTx === 'function') {
      return await this.accountStore.commitLifecycleTx(account.id, patch, audit);
    }
    const updated = await this.accountStore.update(account.id, patch);
    if (typeof this.accountStore.record === 'function') await this.accountStore.record(audit.action, { accountId: account.id, platform: account.platform, ...audit.detail });
    return updated;
  }

  async _advanceToLifecycleCommitted(row) {
    const current = this.get(row.operation_id);
    if (!current || !['running','compensating'].includes(current.state)) return current;
    if (current.phase !== 'sqlite_lifecycle_committed') {
      await this.setPhase(current.operation_id, current.phase, 'sqlite_lifecycle_committed');
    }
    return this.get(row.operation_id);
  }

  async recoverInterrupted() {
    const rows = this.store().db.prepare(`SELECT * FROM account_lifecycle_saga
      WHERE state IN ('running','compensating') ORDER BY started_at`).all();
    const report = { scanned: rows.length, succeeded: 0, failed: 0, manualReview: 0 };
    for (const row of rows) {
      let account = this.accountStore.getRaw(row.account_id);
      if (!account) {
        await this.finish(row.operation_id, 'manual_review', { lastError: 'ACCOUNT_MISSING_DURING_SAGA_RECOVERY' });
        report.manualReview += 1;
        continue;
      }
      let runtime = null;
      try { runtime = this.platformDrivers.get(account.platform).status(account); } catch (_) {}
      const runtimeState = clean(runtime?.state).toLowerCase();
      try {
        if (row.operation_type === 'connect') {
          if (['connected','limited'].includes(runtimeState)) {
            const durableCommit = row.phase === 'sqlite_identity_committed' || clean(account.metadata?.lastConnectOperationId) === clean(row.operation_id);
            if (durableCommit) {
              if (row.phase !== 'sqlite_identity_committed') await this.setPhase(row.operation_id, row.phase, 'sqlite_identity_committed', { adapterReceipt: runtime });
              await this.finish(row.operation_id, 'succeeded', { adapterReceipt: runtime });
              report.succeeded += 1;
            } else {
              await this.finish(row.operation_id, 'manual_review', { lastError: 'ADAPTER_CONNECTED_SQLITE_IDENTITY_UNCONFIRMED', adapterReceipt: runtime });
              report.manualReview += 1;
            }
          } else if (['connecting','qr','waiting-code','waiting-password','waiting-verification'].includes(runtimeState)) {
            await this.finish(row.operation_id, 'manual_review', { lastError: 'AUTH_CONTEXT_REQUIRES_RECONCILIATION', adapterReceipt: runtime });
            report.manualReview += 1;
          } else if (!runtimeState) {
            await this.finish(row.operation_id, 'manual_review', { lastError: 'ADAPTER_STATE_UNAVAILABLE_DURING_CONNECT_RECOVERY' });
            report.manualReview += 1;
          } else {
            await this.finish(row.operation_id, 'failed', { lastError: 'PROCESS_RESTARTED_BEFORE_ACCOUNT_CONNECT_COMPLETED', adapterReceipt: runtime || {} });
            report.failed += 1;
          }
          continue;
        }

        if (['disconnect','logout'].includes(row.operation_type)) {
          const offline = ['logged-out','logged_out','offline','paused'].includes(runtimeState);
          if (!offline) {
            await this.finish(row.operation_id, 'manual_review', { lastError: runtimeState ? 'ADAPTER_STILL_ACTIVE_AFTER_RESTART' : 'ADAPTER_STATE_UNAVAILABLE_DURING_DISCONNECT_RECOVERY', adapterReceipt: runtime || {} });
            report.manualReview += 1;
            continue;
          }
          const logout = row.operation_type === 'logout';
          if (logout && ['telegram','facebook'].includes(account.platform)) {
            const credentials = this.credentials();
            if (!credentials) throw Object.assign(new Error('Credential authority unavailable during logout recovery'), { code: 'CREDENTIAL_AUTHORITY_UNAVAILABLE' });
            if (credentials.has(account.credentialRef)) await credentials.remove(account.credentialRef, { actor: 'recovery-manager' });
          }
          account = await this._setLifecycleProjection(account, row, { logout });
          await this._advanceToLifecycleCommitted(row);
          await this.finish(row.operation_id, 'succeeded', { adapterReceipt: runtime || {} });
          report.succeeded += 1;
          continue;
        }

        if (row.operation_type === 'remove') {
          const offline = ['logged-out','logged_out','offline','paused'].includes(runtimeState);
          if (account.lifecycleState !== 'tombstoned' && !offline) {
            await this.finish(row.operation_id, 'manual_review', { lastError: runtimeState ? 'ACCOUNT_REMOVE_ADAPTER_STILL_ACTIVE' : 'ADAPTER_STATE_UNAVAILABLE_DURING_REMOVE_RECOVERY', adapterReceipt: runtime || {} });
            report.manualReview += 1;
            continue;
          }
          if (account.lifecycleState !== 'tombstoned') {
            if (typeof this.accountStore.tombstone !== 'function') throw Object.assign(new Error('Account repository cannot tombstone during recovery'), { code: 'ACCOUNT_SAGA_REPOSITORY_UNAVAILABLE' });
            account = await this.accountStore.tombstone(account.id, { reason: 'remove-saga-recovery', pendingCleanup: account.metadata?.lifecycleClearCredentials === true });
          }
          const clearCredentials = account.metadata?.lifecycleClearCredentials === true || account.metadata?.removalPendingCleanup === true;
          if (clearCredentials) {
            const credentials = this.credentials();
            if (!credentials) throw Object.assign(new Error('Credential authority unavailable during remove recovery'), { code: 'CREDENTIAL_AUTHORITY_UNAVAILABLE' });
            if (credentials.has(account.credentialRef)) await credentials.remove(account.credentialRef, { actor: 'recovery-manager' });
          }
          await this._setLifecycleProjection(account, row, { remove: true });
          await this._advanceToLifecycleCommitted(row);
          await this.finish(row.operation_id, 'succeeded', { adapterReceipt: runtime || {} });
          report.succeeded += 1;
          continue;
        }

        await this.finish(row.operation_id, 'manual_review', { lastError: 'SAGA_RECOVERY_POLICY_UNDEFINED' });
        report.manualReview += 1;
      } catch (error) {
        await this.finish(row.operation_id, 'manual_review', { lastError: error.code || error.message, adapterReceipt: runtime || {} });
        report.manualReview += 1;
      }
    }
    return report;
  }

  configureDurableOperationDispatch() {
    const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
    const runtime = AppRuntimeFactory.current();
    const composition = runtime?.composition;
    const authorityStore = runtime?.primaryAuthorityStore;
    const authorityWriteHostCapability = runtime?.authorityWriteHostCapability;
    const operationRegistry = composition?.durableOperationRegistry;
    if (!runtime || !composition || !authorityStore?.db || !authorityWriteHostCapability
        || !operationRegistry || typeof operationRegistry.require !== 'function') {
      throw Object.assign(new Error('Canonical durable operation runtime is unavailable'), {
        code: 'WP_B_DURABLE_OPERATION_RUNTIME_REQUIRED'
      });
    }
    const storeProvider = () => authorityStore;
    const executionAuthority = new DurableExecutionAuthority({ storeProvider });
    const outboxAuthority = new ExternalActionOutboxAuthority({ storeProvider });
    const dispatch = async prepared => {
      if (runtime.operatingMode === 'safeMode') {
        return Object.freeze({
          dispatched: false,
          executionId: clean(prepared?.executionId),
          intentId: clean(prepared?.intentId),
          reason: 'SAFE_MODE_SUPPRESSED'
        });
      }
      return executePreparedOperation({
        prepared,
        executionAuthority,
        outboxAuthority,
        operationRegistry,
        authorityWriteHostCapability,
        issueTimestamp: () => nowIso()
      });
    };
    communicationAuthority.configureOperationDispatcher(dispatch);
    this._durableDispatch = dispatch;
    this._durableDispatchState = Object.freeze({
      configured: true,
      startupDispatched: this._durableDispatchState.startupDispatched,
      startupSkipped: this._durableDispatchState.startupSkipped
    });
    return Object.freeze({ dispatch, composition, runtime });
  }

  async dispatchStartupSessionRestores() {
    const context = this.configureDurableOperationDispatch();
    const rows = Array.isArray(context.composition?.sessionRestoreStartupReceipt?.result)
      ? context.composition.sessionRestoreStartupReceipt.result
      : [];
    let startupDispatched = 0;
    let startupSkipped = 0;
    for (const prepared of rows) {
      const result = await context.dispatch(prepared);
      if (result?.dispatched === true) startupDispatched += 1;
      else startupSkipped += 1;
    }
    this._durableDispatchState = Object.freeze({
      configured: true,
      startupDispatched,
      startupSkipped
    });
    return this._durableDispatchState;
  }

  durableDispatchSnapshot() {
    return this._durableDispatchState;
  }

  async prepare() { return { ready: true }; }
  async start() {
    try {
      const saga = await this.recoverInterrupted();
      const durableSessionRestore = await this.dispatchStartupSessionRestores();
      return { saga, durableSessionRestore };
    } catch (error) {
      logger.error('accounts', 'account-saga-recovery-failed', { code: error.code || 'ACCOUNT_SAGA_RECOVERY_FAILED', error: error.message });
      throw error;
    }
  }
  async stop() { return { stopped: true }; }
}

const singleton = new AccountLifecycleSagaService();
module.exports = { AccountLifecycleSagaService, singleton };