'use strict';

const { randomUUID } = require('crypto');
const eventBus = require('./eventBus');

function clean(value) { return String(value == null ? '' : value).trim(); }

function createDeadlineError(options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 1));
  const error = Object.assign(
    new Error(clean(options.message) || `Execution exceeded ${timeoutMs}ms deadline`),
    {
      code: clean(options.code) || 'EXECUTION_DEADLINE_EXCEEDED',
      timeoutMs,
      outcomeUnknown: options.outcomeUnknown === true,
      automaticRetryBlocked: options.automaticRetryBlocked === true,
      executionGeneration: clean(options.generation),
      operation: clean(options.operation),
      platform: clean(options.platform),
      accountId: clean(options.accountId),
      commandId: clean(options.commandId)
    }
  );
  return error;
}

function executeWithDeadline(executor, options = {}) {
  if (typeof executor !== 'function') throw Object.assign(new Error('Deadline executor is required'), { code: 'DEADLINE_EXECUTOR_REQUIRED' });
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 30_000));
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
  const raw = Promise.resolve().then(() => executor({ signal: controller.signal, generation }));
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      quarantineReason = quarantineReason || 'deadline';
      const error = createDeadlineError({ ...options, timeoutMs, generation });
      if (!controller.signal.aborted) controller.abort(error);
      try { options.onTimeout?.(error, { generation, signal: controller.signal }); } catch (_) {}
      eventBus.publish('execution:deadline-exceeded', {
        code: error.code,
        timeoutMs,
        generation,
        operation: error.operation,
        platform: error.platform,
        accountId: error.accountId,
        commandId: error.commandId,
        outcomeUnknown: error.outcomeUnknown === true,
        at: new Date().toISOString()
      });
      reject(error);
    }, timeoutMs);
  });

  // A timed-out SDK call may still settle later because some libraries ignore
  // AbortSignal. Observe it for diagnostics only; never let it mutate the
  // authoritative result of the expired generation.
  raw.then(
    value => {
      if (!quarantineReason) return;
      try { options.onLateResult?.(null, value, { generation, reason: quarantineReason }); } catch (_) {}
      eventBus.publish('execution:late-result-ignored', {
        generation,
        operation: clean(options.operation),
        platform: clean(options.platform),
        accountId: clean(options.accountId),
        commandId: clean(options.commandId),
        ok: true,
        reason: quarantineReason,
        at: new Date().toISOString()
      });
    },
    error => {
      if (!quarantineReason) return;
      try { options.onLateResult?.(error, null, { generation, reason: quarantineReason }); } catch (_) {}
      eventBus.publish('execution:late-result-ignored', {
        generation,
        operation: clean(options.operation),
        platform: clean(options.platform),
        accountId: clean(options.accountId),
        commandId: clean(options.commandId),
        ok: false,
        reason: quarantineReason,
        errorCode: clean(error?.code || error?.message),
        at: new Date().toISOString()
      });
    }
  );

  const racers = externalSignal ? [raw, deadline, externalAbort] : [raw, deadline];
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
  });
}

module.exports = { executeWithDeadline, createDeadlineError };
