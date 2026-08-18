'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const { deepFreeze } = require('../lib/deepFreeze');
const { canonicalSerialize } = require('./canonicalSerialization');
const { assertCurrentAuthorityWriteHostToken } = require('./authorityWriteHost');
const { STATES, TERMINAL_STATES } = require('./durableExecutionLifecycle');

const DECISIONS = deepFreeze({
  REQUEUE_SAFE: 'REQUEUE_SAFE',
  RECONCILE_REQUIRED: 'RECONCILE_REQUIRED',
  CANCEL_CONFIRMATION_REQUIRED: 'CANCEL_CONFIRMATION_REQUIRED',
  DEADLINE_EXPIRED: 'DEADLINE_EXPIRED',
  NO_ACTION: 'NO_ACTION'
});

const TERMINAL_STATE_SET = new Set(TERMINAL_STATES);
const REMOTE_UNCERTAIN_STATES = new Set([
  STATES.WAITING_REMOTE,
  STATES.UNCERTAIN_REMOTE_OUTCOME
]);
const SAFE_REQUEUE_STATES = new Set([
  STATES.CREATED,
  STATES.SCHEDULED,
  STATES.CLAIMED,
  STATES.RUNNING,
  STATES.RETRY_SCHEDULED
]);
const RECEIPT_TYPES = new Set(['SUCCESS', 'FAILURE', 'UNKNOWN']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parse(value, fallback = {}) {
  try { return value == null || value === '' ? fallback : JSON.parse(value); }
  catch (_) { return fallback; }
}

function canonicalObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return {}; }
}

function recoveryError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizedTimestamp(value, field = 'authorityTimestamp') {
  const source = clean(value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw recoveryError(
      'WP_B_RECOVERY_TIMESTAMP_INVALID',
      `${field} must be an explicit normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw recoveryError('WP_B_RECOVERY_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, {
      field
    });
  }
  return result;
}

function requiredString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw recoveryError('WP_B_RECOVERY_FIELD_INVALID', `${field} is required and must be bounded`, {
      field,
      maximum
    });
  }
  return result;
}

function executionSnapshot(row = {}) {
  if (!row) return null;
  return deepFreeze({
    executionId: clean(row.executionId || row.execution_id),
    operationKind: clean(row.operationKind || row.operation_kind),
    state: clean(row.state),
    stateVersion: Number(row.stateVersion ?? row.state_version ?? 0),
    generation: Number(row.generation || 0),
    ownerId: clean(row.ownerId || row.owner_id),
    claimId: clean(row.claimId || row.claim_id),
    hostGeneration: Number(row.hostGeneration ?? row.host_generation ?? 0),
    fencingToken: Number(row.fencingToken ?? row.fencing_token ?? 0),
    leaseExpiresAt: clean(row.leaseExpiresAt || row.lease_expires_at),
    deadlineAt: clean(row.deadlineAt || row.deadline_at),
    retryCount: Number(row.retryCount ?? row.retry_count ?? 0),
    maxAttempts: Number(row.maxAttempts ?? row.max_attempts ?? 1),
    nextAttemptAt: clean(row.nextAttemptAt || row.next_attempt_at),
    failureCode: clean(row.failureCode || row.failure_code),
    terminalReceiptId: clean(row.terminalReceiptId || row.terminal_receipt_id),
    createdAt: clean(row.createdAt || row.created_at),
    updatedAt: clean(row.updatedAt || row.updated_at)
  });
}

function attemptSnapshot(row = {}) {
  return deepFreeze({
    executionId: clean(row.executionId || row.execution_id),
    intentId: clean(row.intentId || row.intent_id),
    attemptId: clean(row.attemptId || row.attempt_id),
    attemptSequence: Number(row.attemptSequence ?? row.attempt_sequence ?? 0),
    authorityTimestamp: clean(row.authorityTimestamp || row.authority_timestamp),
    createdAt: clean(row.createdAt || row.created_at)
  });
}

function receiptSnapshot(row = {}) {
  const resultValue = row.result && typeof row.result === 'object' && !Array.isArray(row.result)
    ? canonicalObject(row.result)
    : parse(row.result_json, {});
  return deepFreeze({
    executionId: clean(row.executionId || row.execution_id),
    intentId: clean(row.intentId || row.intent_id),
    attemptId: clean(row.attemptId || row.attempt_id),
    receiptId: clean(row.receiptId || row.receipt_id),
    receiptType: clean(row.receiptType || row.receipt_type).toUpperCase(),
    result: deepFreeze(resultValue),
    authorityTimestamp: clean(row.authorityTimestamp || row.authority_timestamp),
    createdAt: clean(row.createdAt || row.created_at)
  });
}

function timestampReached(value, authorityTimestamp) {
  const source = clean(value);
  if (!source) return false;
  const milliseconds = Date.parse(source);
  return Number.isFinite(milliseconds) && milliseconds <= Date.parse(authorityTimestamp);
}

function leaseIsExpired(execution, authorityTimestamp) {
  if (!execution.ownerId && !execution.claimId) return true;
  return timestampReached(execution.leaseExpiresAt, authorityTimestamp);
}

function retryIsDue(execution, authorityTimestamp) {
  if (execution.state !== STATES.RETRY_SCHEDULED) return true;
  return !execution.nextAttemptAt || timestampReached(execution.nextAttemptAt, authorityTimestamp);
}

function latestTrustedReceipt(receiptsInput) {
  const receipts = (Array.isArray(receiptsInput) ? receiptsInput : [])
    .map(receiptSnapshot)
    .filter(receipt => receipt.receiptId && RECEIPT_TYPES.has(receipt.receiptType));
  return receipts.length ? receipts[receipts.length - 1] : null;
}

function decideRecovery(executionInput, attemptsInput, authorityTimestampInput, receiptsInput = []) {
  const execution = executionSnapshot(executionInput);
  if (!execution?.executionId) {
    throw recoveryError('WP_B_RECOVERY_EXECUTION_REQUIRED', 'A persisted durable execution is required');
  }
  const authorityTimestamp = normalizedTimestamp(authorityTimestampInput);
  const attempts = deepFreeze((Array.isArray(attemptsInput) ? attemptsInput : [])
    .map(attemptSnapshot)
    .filter(attempt => attempt.attemptId));
  const persistedAttemptCount = attempts.length;
  const normalizedReceipts = (Array.isArray(receiptsInput) ? receiptsInput : [])
    .map(receiptSnapshot)
    .filter(receipt => receipt.receiptId && RECEIPT_TYPES.has(receipt.receiptType));
  const trustedReceipt = normalizedReceipts.length ? normalizedReceipts[normalizedReceipts.length - 1] : null;
  const persistedReceiptCount = normalizedReceipts.length;

  const base = {
    persistedAttemptCount,
    persistedReceiptCount,
    receiptId: trustedReceipt?.receiptId || '',
    retryable: trustedReceipt?.result?.retryable === true,
    retryDelayMs: Number.isSafeInteger(Number(trustedReceipt?.result?.retryDelayMs))
      && Number(trustedReceipt.result.retryDelayMs) >= 0
      ? Number(trustedReceipt.result.retryDelayMs)
      : 0,
    failureCode: clean(trustedReceipt?.result?.failureCode)
  };

  if (TERMINAL_STATE_SET.has(execution.state)) {
    return deepFreeze({
      decision: DECISIONS.NO_ACTION,
      targetState: execution.state,
      reasonCode: 'TERMINAL_EXECUTION',
      clearOwnership: false,
      ...base
    });
  }

  if (execution.state === STATES.CANCEL_REQUESTED && trustedReceipt) {
    return deepFreeze({
      decision: DECISIONS.CANCEL_CONFIRMATION_REQUIRED,
      targetState: STATES.CANCEL_REQUESTED,
      reasonCode: `PERSISTED_${trustedReceipt.receiptType}_RECEIPT_CANCEL_CONFIRMATION_REQUIRED`,
      clearOwnership: true,
      ...base
    });
  }

  if (trustedReceipt?.receiptType === 'SUCCESS') {
    return deepFreeze({
      decision: DECISIONS.RECONCILE_REQUIRED,
      targetState: STATES.SUCCEEDED,
      reasonCode: 'PERSISTED_SUCCESS_RECEIPT_TERMINALIZATION_REQUIRED',
      clearOwnership: true,
      ...base
    });
  }

  if (trustedReceipt?.receiptType === 'UNKNOWN') {
    const cancellation = execution.state === STATES.CANCEL_REQUESTED;
    return deepFreeze({
      decision: cancellation
        ? DECISIONS.CANCEL_CONFIRMATION_REQUIRED
        : DECISIONS.RECONCILE_REQUIRED,
      targetState: cancellation
        ? STATES.CANCEL_REQUESTED
        : STATES.UNCERTAIN_REMOTE_OUTCOME,
      reasonCode: cancellation
        ? 'PERSISTED_UNKNOWN_RECEIPT_CANCEL_CONFIRMATION_REQUIRED'
        : 'PERSISTED_UNKNOWN_RECEIPT_RECONCILIATION_REQUIRED',
      clearOwnership: true,
      ...base,
      failureCode: base.failureCode || 'UNCERTAIN_REMOTE_OUTCOME'
    });
  }

  if (trustedReceipt?.receiptType === 'FAILURE') {
    const retryable = trustedReceipt.result?.retryable === true;
    const failureCode = clean(trustedReceipt.result?.failureCode) || 'EXTERNAL_ACTION_FAILED';
    if (!retryable) {
      return deepFreeze({
        decision: DECISIONS.RECONCILE_REQUIRED,
        targetState: STATES.FAILED,
        reasonCode: 'PERSISTED_PERMANENT_FAILURE_RECEIPT_TERMINALIZATION_REQUIRED',
        clearOwnership: true,
        ...base,
        retryable: false,
        failureCode
      });
    }
    if (timestampReached(execution.deadlineAt, authorityTimestamp)) {
      return deepFreeze({
        decision: DECISIONS.DEADLINE_EXPIRED,
        targetState: STATES.FAILED,
        reasonCode: 'DEADLINE_EXPIRED_AFTER_RETRYABLE_FAILURE',
        clearOwnership: true,
        ...base,
        retryable: false,
        failureCode: 'DEADLINE_EXPIRED'
      });
    }
    if (execution.state === STATES.RETRY_SCHEDULED) {
      if (retryIsDue(execution, authorityTimestamp)) {
        return deepFreeze({
          decision: DECISIONS.REQUEUE_SAFE,
          targetState: STATES.SCHEDULED,
          reasonCode: 'PERSISTED_RETRYABLE_FAILURE_RETRY_DUE',
          clearOwnership: true,
          ...base,
          retryable: true,
          failureCode
        });
      }
      return deepFreeze({
        decision: DECISIONS.NO_ACTION,
        targetState: STATES.RETRY_SCHEDULED,
        reasonCode: 'PERSISTED_RETRYABLE_FAILURE_NOT_DUE',
        clearOwnership: false,
        ...base,
        retryable: true,
        failureCode
      });
    }
    return deepFreeze({
      decision: DECISIONS.RECONCILE_REQUIRED,
      targetState: STATES.RETRY_SCHEDULED,
      reasonCode: 'PERSISTED_RETRYABLE_FAILURE_RECEIPT_RETRY_SCHEDULE_REQUIRED',
      clearOwnership: true,
      ...base,
      retryable: true,
      failureCode
    });
  }

  if (persistedAttemptCount > 0) {
    const cancellation = execution.state === STATES.CANCEL_REQUESTED;
    return deepFreeze({
      decision: cancellation
        ? DECISIONS.CANCEL_CONFIRMATION_REQUIRED
        : DECISIONS.RECONCILE_REQUIRED,
      targetState: cancellation
        ? STATES.CANCEL_REQUESTED
        : STATES.UNCERTAIN_REMOTE_OUTCOME,
      reasonCode: cancellation
        ? 'PERSISTED_ATTEMPT_CANCEL_CONFIRMATION_REQUIRED'
        : 'PERSISTED_ATTEMPT_RECONCILIATION_REQUIRED',
      clearOwnership: true,
      ...base
    });
  }

  if (REMOTE_UNCERTAIN_STATES.has(execution.state)) {
    return deepFreeze({
      decision: DECISIONS.RECONCILE_REQUIRED,
      targetState: STATES.UNCERTAIN_REMOTE_OUTCOME,
      reasonCode: 'UNCERTAIN_REMOTE_OUTCOME',
      clearOwnership: true,
      ...base
    });
  }

  if (execution.state === STATES.CANCEL_REQUESTED) {
    return deepFreeze({
      decision: DECISIONS.CANCEL_CONFIRMATION_REQUIRED,
      targetState: STATES.CANCEL_REQUESTED,
      reasonCode: 'CANCEL_CONFIRMATION_REQUIRED',
      clearOwnership: true,
      ...base
    });
  }

  if (timestampReached(execution.deadlineAt, authorityTimestamp)) {
    return deepFreeze({
      decision: DECISIONS.DEADLINE_EXPIRED,
      targetState: STATES.FAILED,
      reasonCode: 'DEADLINE_EXPIRED',
      clearOwnership: true,
      ...base,
      failureCode: 'DEADLINE_EXPIRED'
    });
  }

  const requeueEligible = SAFE_REQUEUE_STATES.has(execution.state)
    && retryIsDue(execution, authorityTimestamp)
    && leaseIsExpired(execution, authorityTimestamp);
  if (requeueEligible) {
    return deepFreeze({
      decision: DECISIONS.REQUEUE_SAFE,
      targetState: STATES.SCHEDULED,
      reasonCode: 'NO_PERSISTED_ATTEMPT_SAFE_REQUEUE',
      clearOwnership: true,
      ...base
    });
  }

  return deepFreeze({
    decision: DECISIONS.NO_ACTION,
    targetState: execution.state,
    reasonCode: 'ACTIVE_OR_NOT_DUE',
    clearOwnership: false,
    ...base
  });
}

function appendRecoveryEvent(store, input) {
  const sequence = Number(store.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS next
    FROM durable_execution_events WHERE execution_id=?`).get(input.executionId)?.next || 1);
  store.db.prepare(`INSERT INTO durable_execution_events(
      event_id,execution_id,sequence,event_type,from_state,to_state,generation,
      owner_id,reason_code,payload_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    `execution-recovery-event-${crypto.randomUUID()}`,
    input.executionId,
    sequence,
    'recovery-decision',
    input.fromState,
    input.targetState,
    input.generation,
    '',
    input.reasonCode,
    canonicalSerialize({
      decision: input.decision,
      persistedAttemptCount: input.persistedAttemptCount,
      persistedReceiptCount: input.persistedReceiptCount,
      receiptId: input.receiptId || ''
    }),
    input.authorityTimestamp
  );
}

function createSqliteReaders(storeProvider) {
  const resolveStore = () => {
    const store = storeProvider();
    if (!store?.db || typeof store.transaction !== 'function') {
      throw recoveryError(
        'WP_B_RECOVERY_STORE_REQUIRED',
        'Durable recovery requires the AuthorityWriteHost store'
      );
    }
    return store;
  };
  return Object.freeze({
    resolveStore,
    executionReader(executionId) {
      const store = resolveStore();
      return executionSnapshot(store.db.prepare(
        'SELECT * FROM durable_executions WHERE execution_id=?'
      ).get(requiredString(executionId, 'executionId')));
    },
    attemptReader(executionId) {
      const store = resolveStore();
      return deepFreeze(store.db.prepare(`SELECT
          i.execution_id,a.intent_id,a.attempt_id,a.attempt_sequence,
          a.authority_timestamp,a.created_at
        FROM external_action_attempts a
        JOIN external_action_intents i ON i.intent_id=a.intent_id
        WHERE i.execution_id=?
        ORDER BY a.attempt_sequence ASC,a.attempt_id ASC`).all(
        requiredString(executionId, 'executionId')
      ).map(attemptSnapshot));
    },
    receiptReader(executionId) {
      const store = resolveStore();
      return deepFreeze(store.db.prepare(`SELECT
          i.execution_id,r.intent_id,r.attempt_id,r.receipt_id,r.receipt_type,
          r.result_json,r.authority_timestamp,r.created_at
        FROM external_action_receipts r
        JOIN external_action_intents i ON i.intent_id=r.intent_id
        WHERE i.execution_id=? AND r.receipt_type IN ('SUCCESS','FAILURE','UNKNOWN')
        ORDER BY r.created_at ASC,r.receipt_id ASC`).all(
        requiredString(executionId, 'executionId')
      ).map(receiptSnapshot));
    },
    nonterminalReader() {
      const store = resolveStore();
      const placeholders = TERMINAL_STATES.map(() => '?').join(',');
      return deepFreeze(store.db.prepare(`SELECT * FROM durable_executions
        WHERE state NOT IN (${placeholders})
        ORDER BY created_at ASC,execution_id ASC`).all(...TERMINAL_STATES).map(executionSnapshot));
    }
  });
}

function createSqliteDecisionWriter({ storeProvider, authorityWriteHostCapability }) {
  return input => {
    const store = storeProvider();
    if (!store?.db || typeof store.transaction !== 'function') {
      throw recoveryError('WP_B_RECOVERY_STORE_REQUIRED', 'Durable recovery requires the AuthorityWriteHost store');
    }
    assertCurrentAuthorityWriteHostToken(authorityWriteHostCapability, store.db);
    const token = authorityWriteHostCapability.tokenSnapshot();
    const execution = executionSnapshot(input.execution);
    let targetState = requiredString(input.targetState, 'targetState', 64);
    const decision = requiredString(input.decision, 'decision', 64);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp);
    const reasonCode = requiredString(input.reasonCode, 'reasonCode', 256);
    const persistedAttemptCount = safeInteger(input.persistedAttemptCount, 'persistedAttemptCount');
    const persistedReceiptCount = safeInteger(input.persistedReceiptCount ?? 0, 'persistedReceiptCount');
    const retryable = input.retryable === true;
    const retryDelayMs = Math.min(
      7 * 24 * 60 * 60 * 1000,
      safeInteger(input.retryDelayMs ?? 0, 'retryDelayMs')
    );
    const receiptId = clean(input.receiptId);
    let failureCode = clean(input.failureCode);
    let retryCount = safeInteger(execution.retryCount || 0, 'execution.retryCount');
    const maxAttempts = Math.max(1, safeInteger(execution.maxAttempts || 1, 'execution.maxAttempts', 1));
    let nextAttemptAt = execution.nextAttemptAt;

    if (targetState === STATES.RETRY_SCHEDULED) {
      retryCount += 1;
      if (retryCount >= maxAttempts) {
        targetState = STATES.DEAD_LETTERED;
        nextAttemptAt = '';
      } else {
        nextAttemptAt = new Date(Date.parse(authorityTimestamp) + retryDelayMs).toISOString();
      }
    } else if (targetState === STATES.SCHEDULED) {
      nextAttemptAt = '';
      failureCode = '';
    } else if (targetState === STATES.SUCCEEDED) {
      nextAttemptAt = '';
      failureCode = '';
    } else if (targetState === STATES.UNCERTAIN_REMOTE_OUTCOME) {
      nextAttemptAt = '';
      failureCode = failureCode || 'UNCERTAIN_REMOTE_OUTCOME';
    } else if (targetState === STATES.FAILED || targetState === STATES.DEAD_LETTERED) {
      nextAttemptAt = '';
      failureCode = failureCode || reasonCode;
    }

    const completedAt = TERMINAL_STATE_SET.has(targetState) ? authorityTimestamp : '';
    const terminalReceiptId = TERMINAL_STATE_SET.has(targetState) ? receiptId : '';

    return store.transaction(() => {
      assertCurrentAuthorityWriteHostToken(authorityWriteHostCapability, store.db);
      const result = store.db.prepare(`UPDATE durable_executions SET
          state=?,state_version=state_version+1,generation=generation+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',last_heartbeat_at='',
          retry_count=?,next_attempt_at=?,failure_code=?,
          terminal_receipt_id=CASE WHEN ?<>'' THEN ? ELSE terminal_receipt_id END,
          completed_at=CASE WHEN ?<>'' THEN ? ELSE completed_at END,
          updated_at=?
        WHERE execution_id=? AND state=? AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        retryCount,
        nextAttemptAt,
        failureCode,
        terminalReceiptId,
        terminalReceiptId,
        completedAt,
        completedAt,
        authorityTimestamp,
        execution.executionId,
        execution.state,
        execution.stateVersion,
        execution.generation,
        execution.ownerId,
        execution.claimId,
        execution.hostGeneration,
        execution.fencingToken,
        token.instanceId,
        token.hostGeneration,
        token.fencingToken
      );
      if (Number(result.changes || 0) !== 1) {
        throw recoveryError('WP_B_RECOVERY_CAS_REJECTED', 'Durable recovery CAS rejected', {
          executionId: execution.executionId,
          state: execution.state,
          stateVersion: execution.stateVersion,
          generation: execution.generation
        });
      }
      appendRecoveryEvent(store, {
        executionId: execution.executionId,
        fromState: execution.state,
        targetState,
        generation: execution.generation + 1,
        decision,
        reasonCode,
        persistedAttemptCount,
        persistedReceiptCount,
        receiptId,
        authorityTimestamp
      });
      return deepFreeze({
        executionId: execution.executionId,
        fromState: execution.state,
        targetState,
        stateVersion: execution.stateVersion + 1,
        generation: execution.generation + 1,
        hostGeneration: token.hostGeneration,
        fencingToken: token.fencingToken,
        retryable: retryable && targetState === STATES.RETRY_SCHEDULED,
        retryCount,
        nextAttemptAt,
        failureCode,
        receiptId,
        authorityTimestamp
      });
    });
  };
}

class DurableExecutionRecoveryAuthority {
  constructor(options = {}) {
    const storeProvider = typeof options.storeProvider === 'function' ? options.storeProvider : getStore;
    const sqliteReaders = createSqliteReaders(storeProvider);
    Object.defineProperties(this, {
      storeProvider: { value: storeProvider, enumerable: false, writable: false, configurable: false },
      authorityWriteHostCapability: {
        value: options.authorityWriteHostCapability || null,
        enumerable: false,
        writable: false,
        configurable: false
      }
    });
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
    this.executionReader = typeof options.executionReader === 'function'
      ? options.executionReader
      : sqliteReaders.executionReader;
    this.attemptReader = typeof options.attemptReader === 'function'
      ? options.attemptReader
      : sqliteReaders.attemptReader;
    this.receiptReader = typeof options.receiptReader === 'function'
      ? options.receiptReader
      : sqliteReaders.receiptReader;
    this.nonterminalReader = typeof options.nonterminalReader === 'function'
      ? options.nonterminalReader
      : sqliteReaders.nonterminalReader;
    this.decisionWriter = typeof options.decisionWriter === 'function'
      ? options.decisionWriter
      : createSqliteDecisionWriter({
        storeProvider,
        authorityWriteHostCapability: options.authorityWriteHostCapability
      });
  }

  recoverExecution(executionId, options = {}) {
    const normalizedExecutionId = requiredString(executionId, 'executionId');
    const authorityTimestamp = normalizedTimestamp(options.authorityTimestamp || this.clock());
    const execution = executionSnapshot(this.executionReader(normalizedExecutionId));
    if (!execution) {
      throw recoveryError('WP_B_RECOVERY_EXECUTION_NOT_FOUND', 'Durable execution does not exist', {
        executionId: normalizedExecutionId
      });
    }
    const attempts = this.attemptReader(normalizedExecutionId) || [];
    const receipts = this.receiptReader(normalizedExecutionId) || [];
    const decision = decideRecovery(execution, attempts, authorityTimestamp, receipts);
    let transition = null;
    if (decision.decision !== DECISIONS.NO_ACTION) {
      transition = this.decisionWriter({
        execution,
        decision: decision.decision,
        targetState: decision.targetState,
        reasonCode: decision.reasonCode,
        clearOwnership: decision.clearOwnership,
        persistedAttemptCount: decision.persistedAttemptCount,
        persistedReceiptCount: decision.persistedReceiptCount,
        receiptId: decision.receiptId,
        retryable: decision.retryable,
        retryDelayMs: decision.retryDelayMs,
        failureCode: decision.failureCode,
        authorityTimestamp
      });
    }
    return deepFreeze({
      authority: 'DurableExecutionRecoveryAuthority',
      schemaVersion: 1,
      executionId: execution.executionId,
      fromState: execution.state,
      targetState: transition?.targetState || decision.targetState,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      clearOwnership: decision.clearOwnership,
      persistedAttemptCount: decision.persistedAttemptCount,
      persistedReceiptCount: decision.persistedReceiptCount,
      receiptId: decision.receiptId,
      transition,
      authorityTimestamp
    });
  }

  recoverNonterminalExecutions(options = {}) {
    const authorityTimestamp = normalizedTimestamp(options.authorityTimestamp || this.clock());
    const rows = (this.nonterminalReader(options) || [])
      .map(executionSnapshot)
      .filter(Boolean)
      .sort((left, right) => {
        const at = left.createdAt.localeCompare(right.createdAt);
        return at || left.executionId.localeCompare(right.executionId);
      });
    return deepFreeze(rows.map(row => this.recoverExecution(row.executionId, { authorityTimestamp })));
  }
}

function currentRuntimeRecoveryAuthority() {
  const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
  const authority = AppRuntimeFactory.current()?.composition?.authorities?.durableExecutionRecoveryAuthority;
  if (!authority || typeof authority.recoverNonterminalExecutions !== 'function') {
    throw recoveryError(
      'WP_B_RUNTIME_RECOVERY_AUTHORITY_REQUIRED',
      'The current AppRuntime has not composed DurableExecutionRecoveryAuthority'
    );
  }
  return authority;
}

function recoverNonterminalExecutions(options = {}) {
  return currentRuntimeRecoveryAuthority().recoverNonterminalExecutions(options);
}

module.exports = {
  DECISIONS,
  DurableExecutionRecoveryAuthority,
  createSqliteDecisionWriter,
  createSqliteReaders,
  currentRuntimeRecoveryAuthority,
  decideRecovery,
  recoverNonterminalExecutions,
  recoveryError
};