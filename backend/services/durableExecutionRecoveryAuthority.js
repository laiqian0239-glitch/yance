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

function clean(value) {
  return String(value == null ? '' : value).trim();
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
    nextAttemptAt: clean(row.nextAttemptAt || row.next_attempt_at),
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

function decideRecovery(executionInput, attemptsInput, authorityTimestampInput) {
  const execution = executionSnapshot(executionInput);
  if (!execution?.executionId) {
    throw recoveryError('WP_B_RECOVERY_EXECUTION_REQUIRED', 'A persisted durable execution is required');
  }
  const authorityTimestamp = normalizedTimestamp(authorityTimestampInput);
  const attempts = deepFreeze((Array.isArray(attemptsInput) ? attemptsInput : [])
    .map(attemptSnapshot)
    .filter(attempt => attempt.attemptId));
  const persistedAttemptCount = attempts.length;

  if (TERMINAL_STATE_SET.has(execution.state)) {
    return deepFreeze({
      decision: DECISIONS.NO_ACTION,
      targetState: execution.state,
      reasonCode: 'TERMINAL_EXECUTION',
      clearOwnership: false,
      persistedAttemptCount
    });
  }

  // Once any physical attempt has been persisted, recovery can never infer
  // remote absence. Reconciliation or cancel confirmation must decide truth.
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
      persistedAttemptCount
    });
  }

  if (REMOTE_UNCERTAIN_STATES.has(execution.state)) {
    return deepFreeze({
      decision: DECISIONS.RECONCILE_REQUIRED,
      targetState: STATES.UNCERTAIN_REMOTE_OUTCOME,
      reasonCode: 'UNCERTAIN_REMOTE_OUTCOME',
      clearOwnership: true,
      persistedAttemptCount
    });
  }

  if (execution.state === STATES.CANCEL_REQUESTED) {
    return deepFreeze({
      decision: DECISIONS.CANCEL_CONFIRMATION_REQUIRED,
      targetState: STATES.CANCEL_REQUESTED,
      reasonCode: 'CANCEL_CONFIRMATION_REQUIRED',
      clearOwnership: true,
      persistedAttemptCount
    });
  }

  if (timestampReached(execution.deadlineAt, authorityTimestamp)) {
    return deepFreeze({
      decision: DECISIONS.DEADLINE_EXPIRED,
      targetState: STATES.FAILED,
      reasonCode: 'DEADLINE_EXPIRED',
      clearOwnership: true,
      persistedAttemptCount
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
      persistedAttemptCount
    });
  }

  return deepFreeze({
    decision: DECISIONS.NO_ACTION,
    targetState: execution.state,
    reasonCode: 'ACTIVE_OR_NOT_DUE',
    clearOwnership: false,
    persistedAttemptCount
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
      persistedAttemptCount: input.persistedAttemptCount
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
    const targetState = requiredString(input.targetState, 'targetState', 64);
    const decision = requiredString(input.decision, 'decision', 64);
    const authorityTimestamp = normalizedTimestamp(input.authorityTimestamp);
    const reasonCode = requiredString(input.reasonCode, 'reasonCode', 256);
    const persistedAttemptCount = safeInteger(input.persistedAttemptCount, 'persistedAttemptCount');
    const completedAt = TERMINAL_STATE_SET.has(targetState) ? authorityTimestamp : '';

    return store.transaction(() => {
      assertCurrentAuthorityWriteHostToken(authorityWriteHostCapability, store.db);
      const result = store.db.prepare(`UPDATE durable_executions SET
          state=?,state_version=state_version+1,generation=generation+1,
          owner_id='',claim_id='',host_generation=0,fencing_token=0,
          lease_started_at='',lease_expires_at='',last_heartbeat_at='',
          completed_at=CASE WHEN ?<>'' THEN ? ELSE completed_at END,
          failure_code=CASE WHEN ?='DEADLINE_EXPIRED' THEN 'DEADLINE_EXPIRED' ELSE failure_code END,
          updated_at=?
        WHERE execution_id=? AND state=? AND state_version=? AND generation=?
          AND owner_id=? AND claim_id=? AND host_generation=? AND fencing_token=?
          AND EXISTS(
            SELECT 1 FROM authority_write_host_lease
            WHERE singleton_id=1 AND owner_instance_id=? AND host_generation=?
              AND fencing_token=? AND state='ACTIVE'
          )`).run(
        targetState,
        completedAt,
        completedAt,
        decision,
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
        authorityTimestamp
      });
    });
  };
}

class DurableExecutionRecoveryAuthority {
  constructor(options = {}) {
    const storeProvider = typeof options.storeProvider === 'function' ? options.storeProvider : getStore;
    const sqliteReaders = createSqliteReaders(storeProvider);
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
    this.executionReader = typeof options.executionReader === 'function'
      ? options.executionReader
      : sqliteReaders.executionReader;
    this.attemptReader = typeof options.attemptReader === 'function'
      ? options.attemptReader
      : sqliteReaders.attemptReader;
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
    const decision = decideRecovery(execution, attempts, authorityTimestamp);
    let transition = null;
    if (decision.decision !== DECISIONS.NO_ACTION) {
      transition = this.decisionWriter({
        execution,
        decision: decision.decision,
        targetState: decision.targetState,
        reasonCode: decision.reasonCode,
        clearOwnership: decision.clearOwnership,
        persistedAttemptCount: decision.persistedAttemptCount,
        authorityTimestamp
      });
    }
    return deepFreeze({
      authority: 'DurableExecutionRecoveryAuthority',
      schemaVersion: 1,
      executionId: execution.executionId,
      fromState: execution.state,
      targetState: decision.targetState,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      clearOwnership: decision.clearOwnership,
      persistedAttemptCount: decision.persistedAttemptCount,
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

module.exports = {
  DECISIONS,
  DurableExecutionRecoveryAuthority,
  createSqliteDecisionWriter,
  createSqliteReaders,
  decideRecovery,
  recoveryError
};
