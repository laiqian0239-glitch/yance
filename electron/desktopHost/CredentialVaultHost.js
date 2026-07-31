'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeCredentialFrame } = require('../../shared/credentialProtocol');
const { mutationSha256 } = require('../../shared/credentialCustodyProtocol');
const { STATES, TERMINAL_STATES, transitionTransaction } = require('../../shared/credentialTransactionStateMachine');
const { STATES: AUTHORITY_STATES, sameOwnerSession, validateOwnerSession } = require('../../shared/credentialAuthorityLifecycleStateMachine');
const { CredentialAuthorityLifecycleCoordinator } = require('./CredentialAuthorityLifecycleCoordinator');
const {
  JOURNAL_SCHEMA_VERSION, TRANSACTION_SCHEMA_VERSION, appendAuthorityEvent, clone,
  createGenesisJournal, digestRaw, headEvent, isObject, metadataFromEvent,
  metadataProjection, previousEvent, referenceCount, refreshJournalIntegrity, sameMetadataAuthority, validateJournal,
  validateMetadata, validateTransaction
} = require('./credentialAuthority');

const RECOVERY_AMBIGUOUS = 'WP4_CREDENTIAL_TRANSACTION_RECOVERY_AMBIGUOUS';
const AUTHORITY_HISTORY_MISMATCH = 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH';
const JOURNAL_INVALID = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID';
const JOURNAL_MISSING = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_MISSING';
const DURABLE_HISTORY_LOST = 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_HISTORY_LOST';
const TRANSACTION_BUSY = 'CREDENTIAL_TRANSACTION_BUSY_RETRY';
const CONCURRENT_MUTATION = 'WP4_CREDENTIAL_CONCURRENT_MUTATION_LOST';
const TERMINAL_JOURNAL_MISMATCH = 'WP4_CREDENTIAL_TERMINAL_JOURNAL_MISMATCH';
const HYDRATION_REFERENCE_MISMATCH = 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH';
const APPLICATION_BUSY = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_BUSY_RETRY';
const APPLICATION_CONTAINED = 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER_CONTAINMENT';

function atomicWriteJson(file, value, fsApi = fs) {
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  let handle = null;
  try {
    handle = fsApi.openSync(temp, 'w', 0o600);
    fsApi.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsApi.fsyncSync?.(handle);
    fsApi.closeSync(handle); handle = null;
    fsApi.renameSync(temp, file);
    try { const d = fsApi.openSync(path.dirname(file), 'r'); try { fsApi.fsyncSync?.(d); } finally { fsApi.closeSync(d); } } catch (_) {}
  } catch (error) {
    if (handle !== null) try { fsApi.closeSync(handle); } catch (_) {}
    try { fsApi.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

class CredentialVaultHost {
  constructor(options = {}) {
    if (!options.vault) throw new TypeError('CredentialVaultHost requires a vault');
    this.vault = options.vault;
    this.fs = options.fs || fs;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.clock = options.clock || (() => new Date().toISOString());
    this.crashInjector = options.crashInjector || (() => {});
    this.beforeTransactionCommit = options.beforeTransactionCommit || null;
    const vaultFile = path.resolve(options.vaultFile || this.vault.file || path.join(process.cwd(), 'vault', 'credential-vault.bin'));
    this.metadataPath = path.resolve(options.metadataPath || path.join(path.dirname(vaultFile), 'vault-meta.json'));
    this.transactionPath = path.resolve(options.transactionPath || path.join(path.dirname(vaultFile), 'credential-authority-journal.json'));
    this.lifecycleIntentPath = path.resolve(options.lifecycleIntentPath || path.join(path.dirname(vaultFile), 'credential-authority-lifecycle-intent.json'));
    this.lifecycleCompletedPath = path.resolve(options.lifecycleCompletedPath || path.join(path.dirname(vaultFile), 'credential-authority-completed.json'));
    this.operation = Promise.resolve();
    this.pendingOperations = 0;
    this.activeTransactionId = null;
    this.pendingHydration = null;
    this.pendingOwnerSession = null;
    this.activeOwnerSession = null;
    this.applicationLease = null;
    this.applicationFence = null;
    this.applicationCoordinatorRequired = options.applicationCoordinatorRequired === true;
    this.recoveryReady = false;
    this.unavailableReasonCode = '';
    this.recoveryReport = { status: 'NOT_RUN', actions: [] };
    this.idSequence = 0;
    this.vaultMutationToken = Object.freeze({ owner: 'CredentialVaultHost', nonce: this._newId('vault-authority') });
    this.vault.bindMutationAuthority?.(this.vaultMutationToken);
    this.lifecycleCoordinator = options.lifecycleCoordinator || new CredentialAuthorityLifecycleCoordinator({
      vault: this.vault, fs: this.fs, randomUUID: this.randomUUID, clock: this.clock, crashInjector: this.crashInjector,
      vaultFile, metadataPath: this.metadataPath, transactionPath: this.transactionPath,
      intentPath: this.lifecycleIntentPath, completedPath: this.lifecycleCompletedPath,
      replaceVault: raw => this._replaceVault(raw)
    });
    this.lifecycleReport = this.lifecycleCoordinator.ensureActive();
    this._loadActiveAuthority();
    this._recoverAuthority();
    this.recoveryReady = true;
    this._crashPoint(this.lifecycleReport.operationType === 'MIGRATION' ? 'MIGRATION_AFTER_COMPLETION_BEFORE_FIRST_FD5' : 'AUTHORITY_ACTIVE_BEFORE_FIRST_FD5');
  }

  _newId(prefix = 'authority') { this.idSequence += 1; return `${prefix}:${this.randomUUID()}:${this.idSequence}`; }
  _error(reasonCode, message, details = {}) { const error = new Error(message || reasonCode); error.reasonCode = reasonCode; error.code = reasonCode; Object.assign(error, details); return error; }
  _assertOperational() {
    const lifecycleState = this.lifecycleCoordinator?.lifecycle?.state;
    if (!this.recoveryReady || lifecycleState !== AUTHORITY_STATES.ACTIVE) throw this._error(this.unavailableReasonCode || 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_UNAVAILABLE', 'Credential vault authority is not available');
  }
  _assertApplicationAccess(applicationLeaseToken = null) {
    if (this.applicationFence) {
      throw this._error(this.applicationFence.reasonCode || APPLICATION_CONTAINED, 'Credential authority is fenced because a rejected backend owner may still be live', {
        retryable: this.applicationFence.retryable !== false,
        fatal: this.applicationFence.fatal === true,
        containmentId: this.applicationFence.containmentId,
        backendPid: this.applicationFence.backendPid,
        coordinatorState: this.applicationFence.coordinatorState,
        rejectionReasonCode: this.applicationFence.rejectionReasonCode
      });
    }
    if (!this.applicationLease) return;
    if (applicationLeaseToken === this.applicationLease.token) return;
    throw this._error(APPLICATION_BUSY, 'Desktop credential application lifecycle is replacing the backend owner', {
      retryable: true,
      operationId: this.applicationLease.operationId,
      operationType: this.applicationLease.operationType,
      requestId: this.applicationLease.requestId
    });
  }
  setApplicationFence(context = {}) {
    const current = this.applicationFence || {};
    this.applicationFence = Object.freeze({
      containmentId: String(context.containmentId || current.containmentId || this._newId('application-containment')),
      reasonCode: String(context.reasonCode || current.reasonCode || APPLICATION_CONTAINED),
      rejectionReasonCode: String(context.rejectionReasonCode || current.rejectionReasonCode || ''),
      cleanupReasonCode: String(context.cleanupReasonCode || current.cleanupReasonCode || ''),
      coordinatorState: String(context.coordinatorState || current.coordinatorState || 'FATAL_OWNER_CONTAINMENT'),
      backendPid: Number(context.backendPid || current.backendPid || 0),
      ownerSession: clone(context.ownerSession || current.ownerSession || null),
      retryable: context.retryable !== false,
      fatal: context.fatal === true || current.fatal === true,
      engagedAtUtc: String(current.engagedAtUtc || context.engagedAtUtc || this.clock()),
      updatedAtUtc: this.clock()
    });
    return this.applicationFenceSnapshot();
  }
  clearApplicationFence(options = {}) {
    if (!this.applicationFence) return false;
    if (options.force !== true) {
      const blocked = this.activeOwnerSession || this.pendingOwnerSession || this.activeTransactionId || this.pendingOperations > 0;
      const lifecycleState = this.lifecycleCoordinator?.lifecycle?.state;
      if (blocked || lifecycleState !== AUTHORITY_STATES.ACTIVE || !this.recoveryReady) {
        throw this._error('WP4_DESKTOP_CREDENTIAL_CONTAINMENT_RELEASE_BLOCKED', 'Credential application fence cannot be released before owner recovery reaches an owner-free ACTIVE boundary', {
          activeOwnerSession: clone(this.activeOwnerSession),
          pendingOwnerSession: clone(this.pendingOwnerSession),
          activeTransactionId: this.activeTransactionId || '',
          pendingOperations: this.pendingOperations,
          authorityState: lifecycleState || ''
        });
      }
    }
    this.applicationFence = null;
    return true;
  }
  applicationFenceSnapshot() {
    return this.applicationFence ? Object.freeze(clone(this.applicationFence)) : null;
  }
  requireApplicationCoordinator(required = true) {
    this.applicationCoordinatorRequired = required !== false;
    return this.applicationCoordinatorRequired;
  }
  _assertApplicationCoordinatorLease(applicationLeaseToken = null, operation = 'credential-operation') {
    // A persistent containment fence is the stronger application boundary. Check it
    // before coordinator ownership so releasing a short-lived lease can never mask
    // the rejected-owner denial reason or reopen a credential operation.
    if (this.applicationFence) this._assertApplicationAccess(applicationLeaseToken);
    if (!this.applicationCoordinatorRequired) return;
    if (this.applicationLease && applicationLeaseToken === this.applicationLease.token) return;
    throw this._error('WP4_DESKTOP_CREDENTIAL_APPLICATION_COORDINATOR_REQUIRED', `Desktop credential ${operation} must be executed by DesktopCredentialApplicationCoordinator`, { retryable: false });
  }
  async acquireApplicationLease(context = {}) {
    if (this.applicationLease) throw this._error(APPLICATION_BUSY, 'Desktop credential application lease is already held', { retryable: true });
    const token = Object.freeze({ owner: 'DesktopCredentialApplicationCoordinator', nonce: this._newId('application-lease') });
    const drain = this.operation.catch(() => {});
    this.applicationLease = {
      token,
      operationId: String(context.operationId || ''),
      operationType: String(context.operationType || ''),
      requestId: String(context.requestId || ''),
      acquiredAtUtc: this.clock()
    };
    await drain;
    return token;
  }
  async releaseApplicationLease(token) {
    if (!this.applicationLease) return false;
    if (token !== this.applicationLease.token) throw this._error('WP4_DESKTOP_CREDENTIAL_APPLICATION_LEASE_MISMATCH', 'Desktop credential application lease token mismatch');
    this.applicationLease = null;
    return true;
  }
  applicationLeaseSnapshot() {
    if (!this.applicationLease) return null;
    const { operationId, operationType, requestId, acquiredAtUtc } = this.applicationLease;
    return Object.freeze({ operationId, operationType, requestId, acquiredAtUtc });
  }
  _markUnavailable(reasonCode) { this.recoveryReady = false; this.unavailableReasonCode = reasonCode || RECOVERY_AMBIGUOUS; this.lifecycleCoordinator?.markUnavailable?.(this.unavailableReasonCode); }
  _crashPoint(name, tx = {}) { this.crashInjector(name, Object.freeze({ requestId: tx.requestId || '', state: tx.state || '', generation: tx.generation ?? this.metadata?.generation ?? 0, source: tx.source || 'AUTHORITY' })); }
  _enqueue(fn) {
    this.pendingOperations += 1;
    const next = this.operation.catch(() => {}).then(fn);
    this.operation = next.catch(() => {});
    return next.finally(() => { this.pendingOperations = Math.max(0, this.pendingOperations - 1); });
  }
  _replaceVault(raw) { return this.vault.replaceRaw(raw, this.vaultMutationToken); }
  _saveMetadata(next = this.metadata) {
    const value = { ...clone(next), updatedAtUtc: this.clock() };
    validateMetadata(value);
    atomicWriteJson(this.metadataPath, value, this.fs);
    this.metadata = value;
  }
  _saveJournal() {
    this.journal.updatedAtUtc = this.clock();
    refreshJournalIntegrity(this.journal);
    validateJournal(this.journal);
    atomicWriteJson(this.transactionPath, this.journal, this.fs);
    this.transactions = this.journal.transactions;
  }
  _persistJournalOrUnavailable(reasonCode = JOURNAL_INVALID) {
    try { this._saveJournal(); }
    catch (cause) { this._markUnavailable(reasonCode); throw Object.assign(this._error(reasonCode, 'Credential authority journal write failed'), { cause }); }
  }

  _loadActiveAuthority() {
    if (!this.fs.existsSync(this.transactionPath)) throw this._error(JOURNAL_MISSING, 'Credential authority journal is missing after lifecycle activation');
    if (!this.fs.existsSync(this.metadataPath)) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Credential metadata is missing after lifecycle activation');
    if (this.vault.loadError) throw this._error('CREDENTIAL_VAULT_ENTRY_CORRUPTED', 'Credential vault cannot be parsed', { cause: this.vault.loadError });
    try {
      this.metadata = JSON.parse(this.fs.readFileSync(this.metadataPath, 'utf8'));
      validateMetadata(this.metadata);
    } catch (cause) {
      if (cause.reasonCode) throw cause;
      throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Credential metadata is unreadable', { cause });
    }
    try {
      this.journal = JSON.parse(this.fs.readFileSync(this.transactionPath, 'utf8'));
      validateJournal(this.journal);
      this.transactions = this.journal.transactions;
      this.idSequence = Math.max(this.idSequence, Number(this.journal.eventCount || 0) + Number(this.journal.transactionCount || 0) + 16);
    } catch (cause) {
      if (cause.reasonCode) throw cause;
      throw this._error(JOURNAL_INVALID, 'Credential authority journal is unreadable', { cause });
    }
  }

  _metadataMatchesBoundary(metadata, boundary) {
    return Boolean(metadata && boundary) && metadata.vaultEpoch === boundary.vaultEpoch && metadata.generation === boundary.generation && metadata.vaultDigest === boundary.vaultDigest && metadata.referenceCount === boundary.referenceCount;
  }
  _headBoundary() {
    const event = headEvent(this.journal);
    return { vaultEpoch: event.vaultEpoch, generation: event.generation, vaultDigest: event.vaultDigest, referenceCount: event.referenceCount };
  }
  _rawForEvent(event) {
    if (event.eventType === 'GENESIS') return {};
    if (event.eventType === 'MIGRATION_GENESIS') {
      const current = this.vault.snapshotRaw();
      if (digestRaw(current) === event.vaultDigest) return current;
      throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Migrated genesis vault image cannot be reconstructed');
    }
    if (event.eventType === 'HYDRATION_ISSUED') {
      const previous = this.journal.authorityEvents[event.eventSequence - 2];
      if (!previous || previous.vaultDigest !== event.vaultDigest) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Hydration event changed vault content');
      const current = this.vault.snapshotRaw();
      if (digestRaw(current) === event.vaultDigest) return current;
      for (const tx of Object.values(this.transactions)) {
        if (tx.beforeDigest === event.vaultDigest) return tx.beforeRaw;
        if (tx.afterDigest === event.vaultDigest) return tx.afterRaw;
      }
      throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Vault image for hydration authority event cannot be reconstructed');
    }
    const tx = this.transactions[event.transactionId];
    if (!tx) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Authority event references missing transaction');
    return event.eventType === 'TRANSACTION_ROLLED_BACK' ? tx.beforeRaw : tx.afterRaw;
  }
  _recoverHeadProjection(actions) {
    validateJournal(this.journal);
    const head = headEvent(this.journal);
    const expectedMetadata = metadataFromEvent(head, this.clock());
    const currentRaw = this.vault.snapshotRaw();
    const currentDigest = digestRaw(currentRaw);
    const metadataIsHead = sameMetadataAuthority(this.metadata, expectedMetadata);
    const vaultIsHead = currentDigest === head.vaultDigest && referenceCount(currentRaw) === head.referenceCount;
    if (metadataIsHead && vaultIsHead) return;

    const previous = previousEvent(this.journal);
    const previousMetadata = previous ? metadataFromEvent(previous, this.clock()) : null;
    const metadataIsPrevious = previous ? sameMetadataAuthority(this.metadata, previousMetadata) : false;
    const vaultIsPrevious = previous ? currentDigest === previous.vaultDigest && referenceCount(currentRaw) === previous.referenceCount : false;
    if (!((metadataIsHead || metadataIsPrevious) && (vaultIsHead || vaultIsPrevious))) {
      throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Vault and metadata cannot be connected to the durable authority chain head', {
        metadataGeneration: this.metadata.generation, headGeneration: head.generation, vaultDigest: currentDigest, headVaultDigest: head.vaultDigest
      });
    }
    if (!vaultIsHead) {
      this._replaceVault(this._rawForEvent(head));
      actions.push({ action: 'RECOVER_HEAD_VAULT_PROJECTION', eventId: head.eventId });
    }
    if (!metadataIsHead) {
      this._saveMetadata(expectedMetadata);
      actions.push({ action: 'RECOVER_HEAD_METADATA_PROJECTION', eventId: head.eventId });
    }
  }

  _nonTerminalTransactions() {
    return Object.values(this.transactions).filter(tx => !TERMINAL_STATES.has(tx.state));
  }
  _assertTransactionPreviousAuthority(tx) {
    const head = headEvent(this.journal);
    const previous = tx.previousAuthority;
    if (head.vaultEpoch !== previous.vaultEpoch || head.generation !== previous.generation || head.vaultDigest !== previous.vaultDigest || head.referenceCount !== previous.referenceCount || head.eventId !== previous.authorityEventId || head.eventDigest !== previous.authorityHeadDigest) {
      throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Transaction previous authority does not match the journal head', { requestId: tx.requestId });
    }
  }
  _transition(tx, nextState, reasonCode = '') { return transitionTransaction(tx, nextState, this.clock, reasonCode); }
  _appendCommitEvent(tx) {
    this._assertTransactionPreviousAuthority(tx);
    const made = appendAuthorityEvent(this.journal, {
      eventType: tx.operation === 'reset' ? 'RESET_COMMITTED' : 'TRANSACTION_COMMITTED',
      eventId: this._newId('event'),
      transactionId: tx.requestId,
      previousGeneration: tx.previousGeneration,
      generation: tx.generation,
      vaultEpoch: tx.vaultEpoch,
      raw: tx.afterRaw,
      pendingReset: tx.nextAuthority.pendingReset || null,
      createdAtUtc: this.clock()
    });
    tx.commitEventId = made.event.eventId;
    this._transition(tx, STATES.COMMITTED, '');
    this._persistJournalOrUnavailable(AUTHORITY_HISTORY_MISMATCH);
    this._crashPoint('AFTER_COMMITTED_AUTHORITY_EVENT', tx);
    this._saveMetadata(made.metadata);
    this._crashPoint('AFTER_COMMITTED_METADATA_PROJECTION', tx);
    return made;
  }
  _appendRollbackEvent(tx, reasonCode) {
    const currentHead = headEvent(this.journal);
    const compensating = Boolean(tx.commitEventId && currentHead.eventId === tx.commitEventId);
    const expectedBeforeHead = !tx.commitEventId && currentHead.eventId === tx.previousAuthority.authorityEventId;
    if (!compensating && !expectedBeforeHead) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Rollback cannot be attached to the current authority head', { requestId: tx.requestId });
    if (tx.state !== STATES.ABORTING) this._transition(tx, STATES.ABORTING, reasonCode);
    this._persistJournalOrUnavailable(TERMINAL_JOURNAL_MISMATCH);
    this._crashPoint('AFTER_ABORTING_JOURNAL', tx);
    const made = appendAuthorityEvent(this.journal, {
      eventType: 'TRANSACTION_ROLLED_BACK', eventId: this._newId('event'), transactionId: tx.requestId,
      rollbackOfEventId: compensating ? tx.commitEventId : '', previousGeneration: currentHead.generation,
      generation: tx.previousGeneration, vaultEpoch: tx.previousVaultEpoch, raw: tx.beforeRaw,
      pendingReset: tx.previousAuthority.pendingReset || null, createdAtUtc: this.clock()
    });
    tx.rollbackEventId = made.event.eventId;
    this._transition(tx, STATES.ROLLED_BACK, reasonCode);
    this._persistJournalOrUnavailable(TERMINAL_JOURNAL_MISMATCH);
    this._crashPoint('AFTER_ROLLED_BACK_AUTHORITY_EVENT', tx);
    this._replaceVault(tx.beforeRaw);
    this._crashPoint('AFTER_ROLLBACK_VAULT_REPLACE', tx);
    this._saveMetadata(made.metadata);
    this._crashPoint('AFTER_ROLLBACK_METADATA_PROJECTION', tx);
    return made;
  }

  _recoverUnresolved(tx, actions) {
    validateTransaction(tx, tx.requestId);
    const raw = this.vault.snapshotRaw();
    const rawDigest = digestRaw(raw);
    const vaultBefore = rawDigest === tx.beforeDigest;
    const vaultAfter = rawDigest === tx.afterDigest;
    const metadataBefore = this._metadataMatchesBoundary(this.metadata, tx.previousAuthority);
    const metadataAfter = this._metadataMatchesBoundary(this.metadata, tx.nextAuthority);
    const stateBefore = tx.state;

    if ([STATES.NEW, STATES.PREPARING, STATES.PREPARED].includes(tx.state)) {
      if (!vaultBefore || !metadataBefore) throw this._error(RECOVERY_AMBIGUOUS, 'Prepared transaction does not match its before authority', { requestId: tx.requestId });
      this._appendRollbackEvent(tx, 'CREDENTIAL_TRANSACTION_RECOVERED_PREPARED');
    } else if ([STATES.COMMITTING, STATES.INDETERMINATE].includes(tx.state)) {
      if (vaultBefore && metadataBefore) this._appendRollbackEvent(tx, 'CREDENTIAL_TRANSACTION_RECOVERED_BEFORE_COMMIT');
      else if ((vaultAfter && metadataBefore) || (vaultAfter && metadataAfter)) this._appendCommitEvent(tx);
      else if (vaultBefore && metadataAfter) this._appendRollbackEvent(tx, 'CREDENTIAL_TRANSACTION_RECOVERED_METADATA_ROLLBACK');
      else throw this._error(RECOVERY_AMBIGUOUS, 'Indeterminate transaction does not match a recoverable disk state', { requestId: tx.requestId, rawDigest });
    } else if (tx.state === STATES.ABORTING) {
      if (!vaultBefore && !vaultAfter) throw this._error(RECOVERY_AMBIGUOUS, 'Aborting transaction has unknown vault content', { requestId: tx.requestId });
      if (!metadataBefore && !metadataAfter) throw this._error(RECOVERY_AMBIGUOUS, 'Aborting transaction has unknown metadata', { requestId: tx.requestId });
      this._appendRollbackEvent(tx, 'CREDENTIAL_TRANSACTION_RECOVERED_ABORT');
    } else {
      throw this._error(RECOVERY_AMBIGUOUS, 'Unsupported unresolved credential transaction state', { requestId: tx.requestId, state: tx.state });
    }
    actions.push({ requestId: tx.requestId, stateBefore, stateAfter: tx.state, reasonCode: tx.reasonCode || '' });
  }

  _recoverAuthority() {
    const actions = [];
    validateJournal(this.journal);
    const unresolved = this._nonTerminalTransactions();
    if (unresolved.length > 1) throw this._error(RECOVERY_AMBIGUOUS, 'More than one unresolved credential transaction exists');
    if (unresolved.length === 1) this._recoverUnresolved(unresolved[0], actions);
    this._recoverHeadProjection(actions);
    validateJournal(this.journal);
    const head = headEvent(this.journal);
    const expectedMetadata = metadataFromEvent(head, this.clock());
    if (!sameMetadataAuthority(this.metadata, expectedMetadata)) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Metadata is not the authority journal head projection');
    const raw = this.vault.snapshotRaw();
    if (digestRaw(raw) !== head.vaultDigest || referenceCount(raw) !== head.referenceCount) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Vault is not the authority journal head projection');
    this.activeTransactionId = null;
    this.recoveryReport = { status: 'PASS', journalSchemaVersion: JOURNAL_SCHEMA_VERSION, authorityEventCount: this.journal.eventCount, authorityHeadDigest: this.journal.headEventDigest, actions };
  }

  _ownerFromContext(context = {}) {
    const pending = this.pendingOwnerSession || this.activeOwnerSession || {};
    const backendPid = Number(context.backendPid || pending.backendPid || 0);
    const startupNonce = String(context.startupNonce || pending.startupNonce || `direct:${backendPid}:${context.generation || this.metadata?.generation || 0}`);
    const owner = {
      backendPid,
      startupNonce,
      backendSessionId: String(context.backendSessionId || pending.backendSessionId || startupNonce),
      manifestSha256: String(context.manifestSha256 || pending.manifestSha256 || ''),
      vaultEpoch: String(context.vaultEpoch || context.credentialVaultEpoch || pending.vaultEpoch || this.metadata?.vaultEpoch || ''),
      hydrationGeneration: Number(context.hydrationGeneration || context.generation || context.credentialGeneration || pending.hydrationGeneration || this.metadata?.generation || 0),
      fd6PipeInstanceId: String(context.fd6PipeInstanceId || pending.fd6PipeInstanceId || `fd6:${startupNonce}`)
    };
    validateOwnerSession(owner);
    return Object.freeze(owner);
  }
  establishCustodyOwner(context = {}) {
    const owner = this._ownerFromContext(context);
    const expected = this.pendingOwnerSession || this.activeOwnerSession;
    if (expected && !sameOwnerSession(expected, owner)) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'FD6 pipe owner does not match the FD5 owner session');
    if (!this.pendingOwnerSession && !this.activeOwnerSession) this.pendingOwnerSession = owner;
    return owner;
  }
  _ownerFromRequest(request = {}) {
    return this._ownerFromContext({
      backendPid: request.backendPid,
      startupNonce: request.startupNonce,
      backendSessionId: request.backendSessionId,
      manifestSha256: request.manifestSha256,
      vaultEpoch: request.vaultEpoch,
      hydrationGeneration: request.hydrationGeneration || request.generation,
      fd6PipeInstanceId: request.fd6PipeInstanceId
    });
  }
  _validateBinding(request, tx = null) {
    if (String(request.vaultEpoch || '') !== this.metadata.vaultEpoch || Number(request.generation) !== Number(this.metadata.generation)) throw this._error('CREDENTIAL_GENERATION_MISMATCH', 'Credential vault generation or epoch does not match the custody request', { retryable: true });
    const owner = this._ownerFromRequest(request);
    const expected = this.activeOwnerSession || this.pendingOwnerSession;
    if (expected && !sameOwnerSession(expected, owner)) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'Credential custody request belongs to a different backend owner session');
    if (tx?.ownerSession && !sameOwnerSession(tx.ownerSession, owner)) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'Credential transaction belongs to a different backend owner session');
    return owner;
  }
  _result(tx, options = {}) {
    const success = [STATES.PREPARED, STATES.COMMITTING, STATES.COMMITTED].includes(tx.state);
    const authorityEventId = tx.state === STATES.COMMITTED ? tx.commitEventId : (tx.rollbackEventId || '');
    const authorityEvent = authorityEventId ? this.journal.authorityEvents.find(row => row.eventId === authorityEventId) : null;
    return Object.freeze({ success, persisted: tx.state === STATES.COMMITTED, operation: tx.operation, ref: tx.ref, vaultEpoch: tx.vaultEpoch, previousGeneration: tx.previousGeneration, generation: tx.generation, transactionState: tx.state, reasonCode: tx.reasonCode || '', retryable: tx.reasonCode === TRANSACTION_BUSY || tx.reasonCode === CONCURRENT_MUTATION, durableReplay: options.durableReplay === true, authorityEventId, authorityHeadDigest: authorityEvent?.eventDigest || '' });
  }
  _find(request) {
    const requestId = String(request.requestId || '');
    const tx = this.transactions[requestId];
    if (!tx) return null;
    validateTransaction(tx, requestId);
    if (tx.mutationSha256 !== request.payload?.mutationSha256 || tx.operation !== request.operation || tx.ref !== request.payload?.ref) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'requestId was already used for a different credential mutation');
    if (String(request.vaultEpoch || '') !== String(tx.previousVaultEpoch || tx.vaultEpoch || '')) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'requestId durable history belongs to a different vault epoch');
    return tx;
  }
  _assertNoCompetingTransaction(requestId = '') {
    if (this.activeTransactionId && this.activeTransactionId !== requestId) throw this._error(TRANSACTION_BUSY, 'Another credential transaction is prepared or committing', { retryable: true, activeTransactionId: this.activeTransactionId });
  }
  _buildTransaction({ requestId, mutationSha256, operation, ref, value, source = 'FD6', nextEpoch = '', pendingReset = null, ownerSession = null }) {
    this._assertNoCompetingTransaction(requestId);
    const id = String(requestId || '').trim();
    if (!id) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_INVALID', 'Credential requestId is required');
    const key = String(ref || '').trim();
    if (!['persist', 'remove', 'reset'].includes(operation) || (operation !== 'reset' && !key) || (operation === 'reset' && key)) throw this._error('CREDENTIAL_CUSTODY_OPERATION_INVALID', 'Credential operation/ref is invalid');
    const beforeRaw = this.vault.snapshotRaw();
    const head = headEvent(this.journal);
    if (digestRaw(beforeRaw) !== head.vaultDigest || !sameMetadataAuthority(this.metadata, metadataFromEvent(head, this.clock()))) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Cannot prepare mutation from a non-head authority projection');
    let afterRaw;
    if (operation === 'reset') afterRaw = {};
    else afterRaw = this.vault.prepareMutation(operation, key, value).after;
    const previousVaultEpoch = this.metadata.vaultEpoch;
    const vaultEpoch = operation === 'reset' ? String(nextEpoch || this.randomUUID()) : previousVaultEpoch;
    const previousGeneration = this.metadata.generation;
    const generation = operation === 'reset' ? 0 : previousGeneration + 1;
    const beforeDigest = digestRaw(beforeRaw); const afterDigest = digestRaw(afterRaw);
    const previousAuthority = { ...metadataProjection(this.metadata), authorityHeadDigest: this.metadata.authorityHeadDigest };
    const nextAuthority = { schemaVersion: 2, vaultEpoch, generation, vaultDigest: afterDigest, referenceCount: referenceCount(afterRaw), authorityEventId: '', authorityEventCount: this.journal.eventCount + 1, pendingReset: pendingReset || null };
    const at = this.clock();
    const tx = {
      schemaVersion: TRANSACTION_SCHEMA_VERSION, requestId: id,
      mutationSha256: String(mutationSha256 || digestRaw({ operation, ref: key, value: operation === 'remove' ? null : (value || {}) })),
      operation, ref: key, source, ownerSession: ownerSession ? clone(ownerSession) : null, previousVaultEpoch, vaultEpoch, previousGeneration, generation,
      state: STATES.NEW, beforeRaw, afterRaw, beforeDigest, afterDigest,
      beforeReferenceCount: referenceCount(beforeRaw), afterReferenceCount: referenceCount(afterRaw),
      previousAuthority, nextAuthority, commitEventId: '', rollbackEventId: '', reasonCode: '',
      createdAtUtc: at, updatedAtUtc: at, stateHistory: [{ state: STATES.NEW, atUtc: at, reasonCode: '' }]
    };
    this.transactions[id] = tx;
    this.activeTransactionId = id;
    this._transition(tx, STATES.PREPARING);
    try { this._persistJournalOrUnavailable(JOURNAL_INVALID); this._crashPoint('AFTER_PREPARING_JOURNAL', tx); this._transition(tx, STATES.PREPARED); this._persistJournalOrUnavailable(JOURNAL_INVALID); this._crashPoint('AFTER_PREPARED_JOURNAL', tx); }
    catch (cause) {
      if (TERMINAL_STATES.has(tx.state)) this.activeTransactionId = null;
      throw cause;
    }
    return tx;
  }

  _markFailedTransaction(tx, reasonCode) {
    const raw = this.vault.snapshotRaw();
    if (digestRaw(raw) !== tx.beforeDigest || !this._metadataMatchesBoundary(this.metadata, tx.previousAuthority)) {
      throw this._error(RECOVERY_AMBIGUOUS, 'A definite FAILED result requires the unchanged before authority', { requestId: tx.requestId });
    }
    this._transition(tx, STATES.FAILED, reasonCode || 'CREDENTIAL_VAULT_PERSIST_FAILED');
    this._persistJournalOrUnavailable(JOURNAL_INVALID);
    return this._result(tx);
  }

  async _commitTransaction(tx) {
    if (TERMINAL_STATES.has(tx.state)) return this._result(tx, { durableReplay: true });
    if (tx.state !== STATES.PREPARED && tx.state !== STATES.COMMITTING) throw this._error('CREDENTIAL_CUSTODY_TRANSACTION_STATE_INVALID', 'Credential transaction cannot be committed from its current state');
    this._assertNoCompetingTransaction(tx.requestId);
    this.activeTransactionId = tx.requestId;
    this._assertTransactionPreviousAuthority(tx);
    const raw = this.vault.snapshotRaw();
    if (digestRaw(raw) !== tx.beforeDigest || !this._metadataMatchesBoundary(this.metadata, tx.previousAuthority)) {
      this._appendRollbackEvent(tx, CONCURRENT_MUTATION);
      this.activeTransactionId = null;
      throw this._error(CONCURRENT_MUTATION, 'Credential transaction compare-and-swap rejected a stale before image', { retryable: true });
    }
    this._transition(tx, STATES.COMMITTING);
    this._persistJournalOrUnavailable(JOURNAL_INVALID);
    this._crashPoint('AFTER_COMMITTING_JOURNAL', tx);
    let vaultReplaced = false;
    try {
      if (typeof this.beforeTransactionCommit === 'function') await this.beforeTransactionCommit(Object.freeze({ requestId: tx.requestId, source: tx.source, operation: tx.operation }));
      this._replaceVault(tx.afterRaw); vaultReplaced = true;
      this._crashPoint('AFTER_VAULT_ATOMIC_REPLACE', tx);
      const made = this._appendCommitEvent(tx);
      this.activeTransactionId = null;
      return this._result(tx, { authorityEventId: made.event.eventId });
    } catch (cause) {
      if (tx.commitEventId) {
        this._markUnavailable('CREDENTIAL_COMMIT_RESULT_INDETERMINATE');
        this.activeTransactionId = null;
        throw Object.assign(this._error('CREDENTIAL_COMMIT_RESULT_INDETERMINATE', 'Credential commit authority event is durable but projection completion failed'), { cause });
      }
      try {
        if (!vaultReplaced) this._markFailedTransaction(tx, cause.reasonCode || cause.code || 'CREDENTIAL_VAULT_PERSIST_FAILED');
        else {
          if (tx.state !== STATES.ABORTING) this._transition(tx, STATES.ABORTING, cause.reasonCode || cause.code || 'CREDENTIAL_VAULT_PERSIST_FAILED');
          this._appendRollbackEvent(tx, cause.reasonCode || cause.code || 'CREDENTIAL_VAULT_PERSIST_FAILED');
        }
      } catch (rollbackCause) {
        this._markUnavailable('CREDENTIAL_VAULT_ROLLBACK_FAILED');
        this.activeTransactionId = null;
        throw Object.assign(this._error('CREDENTIAL_VAULT_ROLLBACK_FAILED', 'Credential vault rollback or definite failure recording failed'), { cause, rollbackCause, vaultReplaced });
      }
      this.activeTransactionId = null;
      throw Object.assign(this._error(cause.reasonCode || cause.code || 'CREDENTIAL_VAULT_PERSIST_FAILED', 'Credential vault transaction commit failed', { retryable: Boolean(cause.retryable), transactionState: tx.state }), { cause });
    }
  }

  refs() { this._assertOperational(); return Object.freeze([...this.vault.refs()]); }
  entriesStrict() { this._assertOperational(); return Object.freeze(this.vault.entriesStrict().map(([ref, value]) => Object.freeze([ref, value]))); }
  entries() { return this.entriesStrict(); }
  get(ref) { this._assertOperational(); return this.vault.getRequired ? this.vault.getRequired(ref) : this.vault.get(ref); }
  set(ref, value) { return this.persistFromDesktop(ref, value); }
  remove(ref) { return this.removeFromDesktop(ref); }

  prepareCustodyTransaction(request = {}) {
    return this._enqueue(async () => {
      this._assertApplicationAccess();
      this._assertOperational();
      const existing = this._find(request);
      if (existing) return this._result(existing, { durableReplay: TERMINAL_STATES.has(existing.state) });
      const ownerSession = this._validateBinding(request);
      const tx = this._buildTransaction({ requestId: request.requestId, mutationSha256: request.payload?.mutationSha256, operation: request.operation, ref: request.payload?.ref, value: request.payload?.value, source: 'FD6', ownerSession });
      return this._result(tx);
    });
  }
  commitCustodyTransaction(request = {}) {
    return this._enqueue(async () => {
      this._assertApplicationAccess();
      this._assertOperational();
      const tx = this._find(request);
      if (!tx) throw this._error('CREDENTIAL_CUSTODY_UNKNOWN_REQUEST', 'Credential transaction requestId is unknown');
      if (TERMINAL_STATES.has(tx.state)) return this._result(tx, { durableReplay: true });
      this._validateBinding(request, tx);
      return this._commitTransaction(tx);
    });
  }
  abortCustodyTransaction(request = {}, reasonCode = 'CREDENTIAL_TRANSACTION_ABORTED') {
    return this._enqueue(async () => {
      this._assertApplicationAccess();
      this._assertOperational();
      const tx = this._find(request);
      if (!tx) return Object.freeze({ success: true, persisted: false, operation: request.operation, ref: request.payload?.ref || '', vaultEpoch: request.vaultEpoch, previousGeneration: request.generation, generation: request.generation, transactionState: 'UNKNOWN', reasonCode: '', durableReplay: false });
      if (tx.state === STATES.ROLLED_BACK || tx.state === STATES.FAILED) { if (this.activeTransactionId === tx.requestId) this.activeTransactionId = null; return this._result(tx, { durableReplay: true }); }
      try { this._appendRollbackEvent(tx, reasonCode); }
      catch (cause) { this._markUnavailable(cause.reasonCode || TERMINAL_JOURNAL_MISMATCH); throw cause; }
      this.activeTransactionId = null;
      return this._result(tx);
    });
  }
  queryCustodyTransaction(request = {}) {
    return this._enqueue(async () => {
      this._assertApplicationAccess();
      this._assertOperational();
      const tx = this._find(request);
      if (!tx) return Object.freeze({ success: true, persisted: false, operation: request.operation, ref: request.payload?.ref || '', vaultEpoch: request.vaultEpoch, previousGeneration: request.generation, generation: request.generation, transactionState: 'UNKNOWN', reasonCode: '', durableReplay: false, authorityEventId: '' });
      return this._result(tx, { durableReplay: TERMINAL_STATES.has(tx.state) });
    });
  }

  async executeCustodyTransaction(operation, ref, value, options = {}) {
    const source = String(options.source || 'LOCAL').toUpperCase();
    if (this.applicationCoordinatorRequired && source !== 'TEST' && source !== 'FD6') {
      this._assertApplicationCoordinatorLease(options.applicationLeaseToken || null, `${source.toLowerCase()} mutation`);
    }
    return this._enqueue(async () => {
      this._assertApplicationAccess(options.applicationLeaseToken || null);
      this._assertOperational(); this._assertNoCompetingTransaction(options.requestId || '');
      const requestId = String(options.requestId || this._newId(options.source || 'LOCAL'));
      const key = String(ref || '').trim();
      const fingerprint = String(options.mutationSha256 || mutationSha256(operation, key, value));
      const existing = this.transactions[requestId];
      if (existing) {
        validateTransaction(existing, requestId);
        if (existing.mutationSha256 !== fingerprint || existing.operation !== operation || existing.ref !== key) throw this._error('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'requestId was already used for a different local credential mutation');
        if (TERMINAL_STATES.has(existing.state)) return this._result(existing, { durableReplay: true });
        return this._commitTransaction(existing);
      }
      const tx = this._buildTransaction({ requestId, mutationSha256: fingerprint, operation, ref: key, value, source: options.source || 'LOCAL', nextEpoch: options.nextEpoch || '', pendingReset: options.pendingReset || null });
      return this._commitTransaction(tx);
    });
  }
  persistFromDesktop(ref, value) {
    this._assertApplicationCoordinatorLease(null, 'persist');
    return this.executeCustodyTransaction('persist', ref, value || {}, { source: 'DESKTOP' });
  }
  removeFromDesktop(ref) {
    this._assertApplicationCoordinatorLease(null, 'remove');
    return this.executeCustodyTransaction('remove', ref, undefined, { source: 'DESKTOP' });
  }
  executeDesktopMutation(operation, ref, value, options = {}) {
    this._assertApplicationCoordinatorLease(options.applicationLeaseToken || null, operation);
    return this.executeCustodyTransaction(operation, ref, value, { ...options, source: 'DESKTOP' });
  }
  persistFromMigration(ref, value, options = {}) {
    this._assertApplicationCoordinatorLease(options.applicationLeaseToken || null, 'migration');
    return this.executeCustodyTransaction('persist', ref, value || {}, { ...options, source: 'MIGRATION' });
  }
  applyCustodyMutation(request = {}) {
    return this._enqueue(async () => {
      this._assertApplicationAccess();
      this._assertOperational(); const ownerSession = this._validateBinding(request); this._assertNoCompetingTransaction();
      const tx = this._buildTransaction({ requestId: request.requestId || this._newId('FD6'), mutationSha256: request.payload?.mutationSha256, operation: request.operation, ref: request.payload?.ref, value: request.payload?.value, source: 'FD6', ownerSession });
      return this._commitTransaction(tx);
    });
  }

  createHydrationFrame(context = {}) {
    this._assertApplicationCoordinatorLease(context.applicationLeaseToken || null, 'FD5 hydration');
    this._assertApplicationAccess(context.applicationLeaseToken || null);
    this._assertOperational();
    if (this.activeOwnerSession) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_ACTIVE', 'A backend owner session is still active; owner-exit recovery must finish before a new FD5 hydration', { retryable: true });
    if (this.activeTransactionId || this.pendingOperations > 0) throw this._error(TRANSACTION_BUSY, 'Credential hydration cannot start while a mutation is pending', { retryable: true });
    let entries;
    try { entries = this.entriesStrict(); }
    catch (cause) { throw Object.assign(this._error(cause.reasonCode || cause.code || 'CREDENTIAL_VAULT_DECRYPT_FAILED', 'Credential hydration requires every vault reference to decrypt successfully'), { cause }); }
    const raw = this.vault.snapshotRaw();
    const vaultReferenceCount = referenceCount(raw);
    const decryptedEntryCount = entries.length;
    if (vaultReferenceCount !== decryptedEntryCount) throw this._error(HYDRATION_REFERENCE_MISMATCH, 'Vault reference count does not match decrypted credential count', { vaultReferenceCount, decryptedEntryCount });
    const current = headEvent(this.journal);
    if (current.vaultDigest !== digestRaw(raw) || current.referenceCount !== vaultReferenceCount || !sameMetadataAuthority(this.metadata, metadataFromEvent(current, this.clock()))) throw this._error(AUTHORITY_HISTORY_MISMATCH, 'Hydration cannot advance from a non-head authority projection');
    const made = appendAuthorityEvent(this.journal, {
      eventType: 'HYDRATION_ISSUED', eventId: this._newId('event'), startupNonce: String(context.startupNonce || ''),
      previousGeneration: current.generation, generation: current.generation + 1, vaultEpoch: current.vaultEpoch,
      raw, pendingReset: this.metadata.pendingReset || null, createdAtUtc: this.clock()
    });
    try { this._persistJournalOrUnavailable(AUTHORITY_HISTORY_MISMATCH); this._crashPoint('AFTER_HYDRATION_AUTHORITY_EVENT'); this._saveMetadata(made.metadata); this._crashPoint('AFTER_HYDRATION_METADATA_PROJECTION'); }
    catch (cause) { this._markUnavailable(cause.reasonCode || AUTHORITY_HISTORY_MISMATCH); throw cause; }
    const frame = makeCredentialFrame({
      startupNonce: context.startupNonce, oneTimeToken: context.oneTimeToken, backendPid: context.backendPid,
      manifestSha256: context.manifestSha256, vaultEpoch: this.metadata.vaultEpoch, generation: this.metadata.generation,
      authorityEventId: made.event.eventId, authorityHeadDigest: made.event.eventDigest,
      vaultReferenceCount, decryptedEntryCount, issuedAtUtc: this.clock(), entries: entries.map(([ref, value]) => ({ ref, value }))
    });
    if (frame.payload.entries.length !== decryptedEntryCount) throw this._error(HYDRATION_REFERENCE_MISMATCH, 'FD5 frame entry count does not match decrypted credential count');
    const ownerSession = this._ownerFromContext({
      backendPid: context.backendPid,
      startupNonce: context.startupNonce,
      backendSessionId: context.backendSessionId,
      manifestSha256: context.manifestSha256,
      vaultEpoch: frame.vaultEpoch,
      hydrationGeneration: frame.generation,
      fd6PipeInstanceId: context.fd6PipeInstanceId
    });
    this.pendingOwnerSession = ownerSession;
    this.pendingHydration = Object.freeze({ startupNonce: String(context.startupNonce || ''), authorityEventId: made.event.eventId, vaultEpoch: frame.vaultEpoch, generation: frame.generation, vaultReferenceCount, decryptedEntryCount, frameEntryCount: frame.payload.entries.length, payloadBytes: frame.payloadBytes, ownerSession });
    return Object.freeze({ frame, ownerSession, resetAuthorization: this.metadata.pendingReset ? Object.freeze({ ...this.metadata.pendingReset }) : null });
  }

  markHydrationAccepted(result = {}) {
    this._assertOperational();
    const expected = this.pendingHydration;
    if (!expected) return false;
    const matches = String(result.startupNonce || '') === expected.startupNonce && String(result.authorityEventId || '') === expected.authorityEventId && String(result.vaultEpoch || '') === expected.vaultEpoch && Number(result.generation) === expected.generation && Number(result.vaultReferenceCount) === expected.vaultReferenceCount && Number(result.decryptedEntryCount) === expected.decryptedEntryCount && Number(result.frameEntryCount ?? result.entryCount) === expected.frameEntryCount && Number(result.restoredReferenceCount) === expected.frameEntryCount && Number(result.payloadBytes) === expected.payloadBytes;
    if (!matches) return false;
    this.pendingHydration = null;
    this.activeOwnerSession = expected.ownerSession || this.pendingOwnerSession;
    this.pendingOwnerSession = null;
    if (this.metadata.pendingReset) this._saveMetadata({ ...this.metadata, pendingReset: null });
    return true;
  }

  handleBackendOwnerExit(ownerContext = {}) {
    return this._enqueue(async () => {
      const owner = this._ownerFromContext(ownerContext);
      const currentOwner = this.activeOwnerSession || this.pendingOwnerSession;
      if (!currentOwner) return Object.freeze({ recovered: true, staleOwnerIgnored: true, activeTransactionId: this.activeTransactionId || '', authorityState: this.lifecycleCoordinator.lifecycle.state });
      if (!sameOwnerSession(currentOwner, owner)) return Object.freeze({ recovered: true, staleOwnerIgnored: true, activeTransactionId: this.activeTransactionId || '', authorityState: this.lifecycleCoordinator.lifecycle.state });
      try {
        this.lifecycleCoordinator.beginOwnerExitRecovery(owner);
        const actions = [];
        if (this.activeTransactionId) {
          const tx = this.transactions[this.activeTransactionId];
          if (!tx) throw this._error(RECOVERY_AMBIGUOUS, 'Active owner transaction is missing from durable journal');
          if (tx.ownerSession && !sameOwnerSession(tx.ownerSession, owner)) throw this._error('WP4_CREDENTIAL_BACKEND_OWNER_SESSION_MISMATCH', 'Active transaction belongs to a different owner session');
          const stateBefore = tx.state;
          if ([STATES.NEW, STATES.PREPARING, STATES.PREPARED].includes(tx.state)) this._appendRollbackEvent(tx, 'CREDENTIAL_BACKEND_OWNER_EXIT');
          else if ([STATES.COMMITTING, STATES.INDETERMINATE, STATES.ABORTING].includes(tx.state)) this._recoverUnresolved(tx, actions);
          else if (tx.state === STATES.COMMITTED) this._recoverHeadProjection(actions);
          else if (!TERMINAL_STATES.has(tx.state)) throw this._error(RECOVERY_AMBIGUOUS, 'Owner transaction has an unsupported state', { state: tx.state });
          actions.push({ requestId: tx.requestId, stateBefore, stateAfter: tx.state });
        }
        this._recoverHeadProjection(actions);
        this.activeTransactionId = null;
        this.activeOwnerSession = null;
        this.pendingOwnerSession = null;
        this.pendingHydration = null;
        this.lifecycleCoordinator.completeOwnerExitRecovery();
        return Object.freeze({ recovered: true, staleOwnerIgnored: false, activeTransactionId: '', authorityState: this.lifecycleCoordinator.lifecycle.state, actions });
      } catch (cause) {
        this._markUnavailable(cause.reasonCode || cause.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED');
        throw cause;
      }
    });
  }

  resetAfterBackendStopped(options = {}) {
    this._assertApplicationCoordinatorLease(options.applicationLeaseToken || null, 'reset');
    this._assertApplicationAccess(options.applicationLeaseToken || null);
    if (options.exitConfirmed !== true) throw this._error('CREDENTIAL_VAULT_RESET_BACKEND_EXIT_REQUIRED', 'Credential vault reset requires confirmed backend exit');
    const previousVaultEpoch = this.metadata.vaultEpoch;
    const nextVaultEpoch = this.randomUUID();
    const pendingReset = { previousVaultEpoch, nextVaultEpoch, authorizedAtUtc: this.clock() };
    return this.executeCustodyTransaction('reset', '', undefined, { source: 'RESET', requestId: options.requestId, applicationLeaseToken: options.applicationLeaseToken, nextEpoch: nextVaultEpoch, pendingReset, mutationSha256: mutationSha256('reset', '', undefined) });
  }

  snapshotAuthorityBoundary() {
    const raw = this.vault.snapshotRaw();
    return Object.freeze({
      vaultEpoch: this.metadata?.vaultEpoch || '',
      generation: this.metadata?.generation || 0,
      vaultDigest: digestRaw(raw),
      authorityEventId: this.metadata?.authorityEventId || '',
      authorityHeadDigest: this.metadata?.authorityHeadDigest || '',
      referenceCount: referenceCount(raw),
      journalTransactionCount: Object.keys(this.transactions || {}).length
    });
  }

  snapshotMetadata() {
    let decryptedEntryCount = -1; let decryptReasonCode = '';
    if (this.recoveryReady) {
      try { decryptedEntryCount = this.vault.entriesStrict().length; }
      catch (error) { decryptReasonCode = error.reasonCode || error.code || 'CREDENTIAL_VAULT_DECRYPT_FAILED'; }
    }
    return Object.freeze({
      available: Boolean(this.vault.available) && this.recoveryReady && !decryptReasonCode,
      referenceCount: this.recoveryReady ? this.vault.refs().length : 0, decryptedEntryCount, decryptReasonCode,
      vaultEpoch: this.metadata?.vaultEpoch || '', generation: this.metadata?.generation || 0,
      authorityEventId: this.metadata?.authorityEventId || '', authorityEventCount: this.metadata?.authorityEventCount || 0,
      authorityHeadDigest: this.metadata?.authorityHeadDigest || '', pendingReset: Boolean(this.metadata?.pendingReset),
      metadataPath: this.metadataPath, transactionPath: this.transactionPath, lifecycleIntentPath: this.lifecycleIntentPath, lifecycleCompletedPath: this.lifecycleCompletedPath, activeTransactionId: this.activeTransactionId || '',
      activeOwnerSession: this.activeOwnerSession ? clone(this.activeOwnerSession) : null,
      pendingOwnerSession: this.pendingOwnerSession ? clone(this.pendingOwnerSession) : null,
      applicationLease: this.applicationLeaseSnapshot(), applicationFence: this.applicationFenceSnapshot(), applicationCoordinatorRequired: this.applicationCoordinatorRequired === true,
      pendingOperations: this.pendingOperations, journalTransactionCount: Object.keys(this.transactions || {}).length,
      lifecycle: this.lifecycleCoordinator?.snapshot?.() || null,
      recovery: clone(this.recoveryReport)
    });
  }
}

module.exports = {
  APPLICATION_CONTAINED, AUTHORITY_HISTORY_MISMATCH, CONCURRENT_MUTATION, CredentialVaultHost, DURABLE_HISTORY_LOST,
  HYDRATION_REFERENCE_MISMATCH, JOURNAL_INVALID, JOURNAL_MISSING, RECOVERY_AMBIGUOUS,
  TERMINAL_JOURNAL_MISMATCH, TRANSACTION_BUSY, atomicWriteJson, digestRaw
};
