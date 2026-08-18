'use strict';

const { randomUUID } = require('crypto');
const eventBus = require('./eventBus');

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedDeadlineAt(value) {
  const source = clean(value);
  if (!source) return '';
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw Object.assign(new Error('Execution authority deadline must be normalized UTC ISO-8601'), { code: 'EXECUTION_DEADLINE_AT_INVALID', deadlineAt: source });
  }
  return source;
}
function effectiveTimeoutMs(options = {}) {
  const deadlineAt = normalizedDeadlineAt(options.deadlineAt);
  if (deadlineAt) return Math.max(0, Date.parse(deadlineAt) - Date.now());
  return Math.max(1, Number(options.timeoutMs || 30_000));
}

function createDeadlineError(options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? effectiveTimeoutMs(options)));
  const deadlineAt = normalizedDeadlineAt(options.deadlineAt);
  return Object.assign(
    new Error(clean(options.message) || `Execution exceeded ${deadlineAt || `${timeoutMs}ms`} deadline`),
    {
      code: clean(options.code) || 'EXECUTION_DEADLINE_EXCEEDED',
      timeoutMs,
      deadlineAt,
      deadlineAuthority: deadlineAt ? 'PERSISTED_AUTHORITY_TIMESTAMP' : 'LOCAL_DIAGNOSTIC_ONLY',
      // A local/SDK deadline can prove only that the caller stopped waiting. It
      // cannot prove remote failure. Durable reconciliation owns final truth.
      outcomeUnknown: options.outcomeKnownLocal === true ? false : true,
      automaticRetryBlocked: options.outcomeKnownLocal === true ? options.automaticRetryBlocked === true : true,
      executionGeneration: clean(options.generation),
      operation: clean(options.operation),
      platform: clean(options.platform),
      accountId: clean(options.accountId),
      commandId: clean(options.commandId)
    }
  );
}

function executeWithDeadline(executor, options = {}) {
  if (typeof executor !== 'function') throw Object.assign(new Error('Deadline executor is required'), { code: 'DEADLINE_EXECUTOR_REQUIRED' });
  const deadlineAt = normalizedDeadlineAt(options.deadlineAt);
  const timeoutMs = effectiveTimeoutMs({ ...options, deadlineAt });
  const generation = clean(options.generation) || randomUUID();
  const controller = new AbortController();
  const externalSignal = options.signal || null;
  let externalAbortReject = null;
  let quarantineReason = '';
  const externalAbort = new Promise((_, reject) => { externalAbortReject = reject; });
  const abortFromExternal = () => {
    const reason = externalSignal?.reason instanceof Error
      ? externalSignal.reason
      : Object.assign(new Error('Execution aborted by caller'), { code: 'EXECUTION_ABORTED' });
    if (!reason.code) reason.code = 'EXECUTION_ABORTED';
    quarantineReason = quarantineReason || 'caller-abort';
    reason.executionGeneration = generation;
    reason.operation = clean(options.operation);
    reason.platform = clean(options.platform);
    reason.accountId = clean(options.accountId);
    reason.commandId = clean(options.commandId);
    if (!controller.signal.aborted) controller.abort(reason);
    externalAbortReject?.(reason);
    eventBus.publish('execution:caller-aborted', {
      code: reason.code, generation, operation: reason.operation, platform: reason.platform,
      accountId: reason.accountId, commandId: reason.commandId, at: new Date().toISOString()
    });
  };
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });

  let timer = null;
  const raw = Promise.resolve().then(() => executor({ signal: controller.signal, generation, deadlineAt }));
  const deadline = new Promise((_, reject) => {
    const expire = () => {
      quarantineReason = quarantineReason || 'deadline';
      const error = createDeadlineError({ ...options, deadlineAt, timeoutMs, generation });
      if (!controller.signal.aborted) controller.abort(error);
      try { options.onTimeout?.(error, { generation, signal: controller.signal, deadlineAt }); } catch (_) {}
      eventBus.publish('execution:deadline-exceeded', {
        code: error.code,
        timeoutMs,
        deadlineAt,
        deadlineAuthority: error.deadlineAuthority,
        generation,
        operation: error.operation,
        platform: error.platform,
        accountId: error.accountId,
        commandId: error.commandId,
        outcomeUnknown: true,
        automaticRetryBlocked: true,
        at: new Date().toISOString()
      });
      reject(error);
    };
    if (timeoutMs <= 0) queueMicrotask(expire);
    else timer = setTimeout(expire, timeoutMs);
  });

  raw.then(
    value => {
      if (!quarantineReason) return;
      try { options.onLateResult?.(null, value, { generation, reason: quarantineReason, deadlineAt }); } catch (_) {}
      eventBus.publish('execution:late-result-ignored', {
        generation, deadlineAt, operation: clean(options.operation), platform: clean(options.platform),
        accountId: clean(options.accountId), commandId: clean(options.commandId), ok: true,
        reason: quarantineReason, at: new Date().toISOString()
      });
    },
    error => {
      if (!quarantineReason) return;
      try { options.onLateResult?.(error, null, { generation, reason: quarantineReason, deadlineAt }); } catch (_) {}
      eventBus.publish('execution:late-result-ignored', {
        generation, deadlineAt, operation: clean(options.operation), platform: clean(options.platform),
        accountId: clean(options.accountId), commandId: clean(options.commandId), ok: false,
        reason: quarantineReason, errorCode: clean(error?.code || error?.message), at: new Date().toISOString()
      });
    }
  );

  const racers = externalSignal ? [raw, deadline, externalAbort] : [raw, deadline];
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
  });
}

module.exports = { executeWithDeadline, createDeadlineError, normalizedDeadlineAt, effectiveTimeoutMs };
