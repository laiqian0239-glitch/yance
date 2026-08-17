'use strict';

const { authority: lifecycleAuthority, STATES } = require('./asyncOperationLifecycleAuthority');

const entries = new Map();
const replacements = new Map();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function createAbortError(reason = 'AI_TASK_CANCELLED') {
  const error = new Error(reason);
  error.name = 'AbortError';
  error.code = reason;
  return error;
}

function replacementBlocked(reason, details = {}) {
  return Object.assign(new Error(`AI task replacement blocked: ${reason}`), {
    code: 'AI_REPLACEMENT_BLOCKED',
    reason,
    retryable: true,
    ...details
  });
}

function withTerminationDeadline(operation, timeoutMs) {
  const budgetMs = Math.max(1, Math.min(30_000, Number(timeoutMs || 5_000)));
  let timer = null;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(replacementBlocked('TERMINATION_TIMEOUT', { timeoutMs: budgetMs })), budgetMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function combineSignals(controller, externalSignal) {
  if (!externalSignal) return controller.signal;
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason || createAbortError('EXTERNAL_ABORT'));
    return controller.signal;
  }
  const abort = () => controller.abort(externalSignal.reason || createAbortError('EXTERNAL_ABORT'));
  externalSignal.addEventListener('abort', abort, { once: true });
  const entry = entries.get(controller.__taskId);
  if (entry) entry.detachExternal = () => externalSignal.removeEventListener('abort', abort);
  return controller.signal;
}

function operationIdentity(taskId, metadata = {}) {
  const conversationId = clean(metadata.conversationId);
  const contactId = clean(metadata.contactId);
  const scopeKey = conversationId || contactId || clean(taskId);
  const objectFingerprint = clean(metadata.objectFingerprint || metadata.fingerprint || [
    scopeKey,
    clean(metadata.contextVersion),
    clean(metadata.conversationRevision),
    clean(metadata.modelId),
    clean(taskId)
  ].join(':'));
  return { operationId: clean(taskId), operationType: 'ai.reply.candidates', scopeKey, objectFingerprint };
}

function removeEntry(taskId) {
  const id = clean(taskId);
  const entry = entries.get(id);
  if (!entry) return false;
  try { entry.detachExternal?.(); } catch (_) {}
  entries.delete(id);
  return true;
}

function start(taskId, metadata = {}, externalSignal = null) {
  const id = clean(taskId);
  if (!id) throw Object.assign(new Error('AI task id is required'), { code: 'AI_TASK_ID_REQUIRED' });
  if (entries.has(id)) {
    throw Object.assign(new Error('Active AI task must be replaced through the serialized coordinator'), {
      code: 'AI_REPLACEMENT_REQUIRED',
      taskId: id,
      retryable: true
    });
  }
  const operation = lifecycleAuthority.create({
    ...operationIdentity(id, metadata),
    metadata: {
      contactId: clean(metadata.contactId),
      conversationId: clean(metadata.conversationId),
      modelId: clean(metadata.modelId),
      contextVersion: clean(metadata.contextVersion),
      conversationRevision: Number(metadata.conversationRevision || 0)
    }
  }).operation;
  const started = lifecycleAuthority.start(operation.operationId, { progress: 2 }).operation || operation;
  const controller = new AbortController();
  controller.__taskId = id;
  const entry = {
    taskId: id,
    contactId: clean(metadata.contactId),
    conversationId: clean(metadata.conversationId),
    modelId: clean(metadata.modelId),
    controller,
    startedAt: started.startedAt || new Date().toISOString(),
    operationId: started.operationId,
    generation: started.generation,
    objectFingerprint: started.objectFingerprint,
    executionId: clean(metadata.executionId || taskId),
    hardTerminate: typeof metadata.hardTerminate === 'function' ? metadata.hardTerminate : null,
    detachExternal: null
  };
  entries.set(id, entry);
  return {
    taskId: id,
    operationId: entry.operationId,
    generation: entry.generation,
    objectFingerprint: entry.objectFingerprint,
    signal: combineSignals(controller, externalSignal),
    cancel: reason => cancel(id, reason)
  };
}

async function replace(taskId, metadata = {}, externalSignal = null) {
  const id = clean(taskId);
  if (!id) throw Object.assign(new Error('AI task id is required'), { code: 'AI_TASK_ID_REQUIRED' });
  const previous = replacements.get(id) || Promise.resolve();
  const coordinated = previous.catch(() => {}).then(async () => {
    const old = entries.get(id);
    if (!old) return start(id, metadata, externalSignal);
    const terminate = typeof metadata.hardTerminate === 'function' ? metadata.hardTerminate : old.hardTerminate;
    if (typeof terminate !== 'function') {
      throw replacementBlocked('TERMINATION_UNAVAILABLE', { taskId: id, executionId: old.executionId });
    }
    let receipt;
    try {
      receipt = await withTerminationDeadline(() => terminate({
        taskId: id,
        operationId: old.operationId,
        generation: old.generation,
        objectFingerprint: old.objectFingerprint,
        executionId: old.executionId,
        signal: old.controller.signal
      }), metadata.terminationTimeoutMs);
    } catch (error) {
      if (error?.code === 'AI_REPLACEMENT_BLOCKED') {
        throw Object.assign(error, { taskId: id, executionId: old.executionId });
      }
      throw replacementBlocked('TERMINATION_FAILED', {
        taskId: id, executionId: old.executionId, cause: clean(error?.code || error?.message)
      });
    }
    const validReceipt = receipt?.terminated === true
      && clean(receipt.executionId) === clean(old.executionId)
      && (Number.isInteger(receipt.exitCode) || Boolean(clean(receipt.signal)));
    if (!validReceipt) {
      throw replacementBlocked('EXIT_RECEIPT_MISMATCH', {
        taskId: id, executionId: old.executionId, receiptExecutionId: clean(receipt?.executionId)
      });
    }
    const durableCancel = typeof metadata.durableCancel === 'function'
      ? metadata.durableCancel
      : (entry => lifecycleAuthority.cancel(entry.operationId, 'AI_TASK_REPLACED', {
        generation: entry.generation,
        objectFingerprint: entry.objectFingerprint,
        message: 'A verified replacement terminated the old physical execution.'
      }));
    let cancelled;
    try {
      cancelled = await durableCancel(old);
    } catch (error) {
      throw replacementBlocked('DURABLE_CANCEL_FAILED', {
        taskId: id, executionId: old.executionId, cause: clean(error?.code || error?.message)
      });
    }
    if (cancelled?.updated !== true) {
      throw replacementBlocked('DURABLE_CANCEL_REJECTED', {
        taskId: id, executionId: old.executionId, durableReason: clean(cancelled?.reason)
      });
    }
    if (entries.get(id) !== old) {
      throw replacementBlocked('RUNTIME_GENERATION_CHANGED', { taskId: id, executionId: old.executionId });
    }
    removeEntry(id);
    return start(id, metadata, externalSignal);
  });
  replacements.set(id, coordinated);
  try {
    return await coordinated;
  } finally {
    if (replacements.get(id) === coordinated) replacements.delete(id);
  }
}


function assertCurrent(taskId, expected = {}) {
  const id = clean(taskId);
  const entry = entries.get(id);
  if (!entry) {
    throw Object.assign(new Error('AI runtime task no longer exists'), {
      code: 'AI_TASK_RUNTIME_NOT_CURRENT', taskId: id
    });
  }
  if (expected.generation != null && Number(expected.generation) !== Number(entry.generation)) {
    throw Object.assign(new Error('AI runtime generation changed'), {
      code: 'AI_TASK_GENERATION_STALE', taskId: id,
      expectedGeneration: Number(expected.generation), currentGeneration: Number(entry.generation)
    });
  }
  if (expected.objectFingerprint && clean(expected.objectFingerprint) !== clean(entry.objectFingerprint)) {
    throw Object.assign(new Error('AI runtime object fingerprint changed'), {
      code: 'AI_TASK_FINGERPRINT_STALE', taskId: id
    });
  }
  if (entry.controller.signal.aborted) {
    const reason = entry.controller.signal.reason;
    if (reason instanceof Error) throw reason;
    throw createAbortError(clean(reason) || 'AI_TASK_CANCELLED');
  }
  const durable = lifecycleAuthority.read(entry.operationId);
  if (!durable || durable.state !== STATES.RUNNING
    || Number(durable.generation) !== Number(entry.generation)
    || clean(durable.objectFingerprint) !== clean(entry.objectFingerprint)) {
    throw Object.assign(new Error('AI durable runtime task is no longer running'), {
      code: 'AI_TASK_DURABLE_STATE_STALE', taskId: id,
      durableState: clean(durable?.state)
    });
  }
  return {
    taskId: id, operationId: entry.operationId, generation: entry.generation,
    objectFingerprint: entry.objectFingerprint, signal: entry.controller.signal
  };
}

function cancel(taskId, reason = 'AI_TASK_CANCELLED') {
  const id = clean(taskId);
  const entry = entries.get(id);
  if (!entry) return false;
  if (!entry.controller.signal.aborted) entry.controller.abort(createAbortError(reason));
  lifecycleAuthority.cancel(entry.operationId, reason, {
    generation: entry.generation,
    objectFingerprint: entry.objectFingerprint,
    message: reason
  });
  return true;
}

function succeed(taskId, result = {}) {
  const entry = entries.get(clean(taskId));
  if (!entry) return { updated: false, reason: 'runtime-entry-not-found' };
  return lifecycleAuthority.succeed(entry.operationId, result, {
    generation: entry.generation,
    objectFingerprint: entry.objectFingerprint
  });
}

function fail(taskId, error = {}) {
  const entry = entries.get(clean(taskId));
  if (!entry) return { updated: false, reason: 'runtime-entry-not-found' };
  const code = clean(error.code || error.errorCode).toUpperCase();
  const cancellationCodes = new Set(['MODEL_CANCELLED', 'JOB_CANCELLED', 'ABORT_ERR', 'ABORTED', 'NEW_INCOMING_MESSAGE', 'SOCIAL_CONTEXT_CHANGED', 'AI_TASK_CANCELLED']);
  if (cancellationCodes.has(code)) {
    return lifecycleAuthority.cancel(entry.operationId, code || 'AI_TASK_CANCELLED', {
      generation: entry.generation,
      objectFingerprint: entry.objectFingerprint,
      message: clean(error.message || code)
    });
  }
  return lifecycleAuthority.fail(entry.operationId, error, {
    generation: entry.generation,
    objectFingerprint: entry.objectFingerprint
  });
}

function cancelForContact(contactId, reason = 'SOCIAL_CONTEXT_CHANGED') {
  const id = clean(contactId);
  let count = 0;
  for (const entry of entries.values()) {
    if (entry.contactId === id && cancel(entry.taskId, reason)) count += 1;
  }
  return count;
}

function cancelForConversation(conversationId, reason = 'NEW_INCOMING_MESSAGE') {
  const id = clean(conversationId);
  let count = 0;
  for (const entry of entries.values()) {
    if (entry.conversationId === id && cancel(entry.taskId, reason)) count += 1;
  }
  return count;
}

function cancelAll(reason = 'AI_ROUTING_CHANGED') {
  let count = 0;
  for (const entry of entries.values()) if (cancel(entry.taskId, reason)) count += 1;
  return count;
}

function finish(taskId, generation) {
  const id = clean(taskId);
  const entry = entries.get(id);
  if (!entry) return false;
  if (generation != null && Number(generation) !== Number(entry.generation)) return false;
  return removeEntry(id);
}

function recoverInterrupted(reason = 'PROCESS_RESTARTED_AI_TASK_INTERRUPTED') {
  let cursor = null; let hasMore = true; let scanned = 0; let recovered = 0; let pages = 0; let oldestPendingAt = '';
  while (hasMore && pages < 1000) {
    const snapshot = lifecycleAuthority.snapshot({ operationType: 'ai.reply.candidates', states: [STATES.CREATED, STATES.RUNNING], limit: 500, order: 'oldest', cursor });
    const rows = Array.isArray(snapshot?.operations) ? snapshot.operations : [];
    if (!oldestPendingAt) oldestPendingAt = snapshot.oldestPendingAt || '';
    scanned += rows.length; pages += 1;
    for (const operation of rows) {
      if (![STATES.CREATED, STATES.RUNNING, 'CREATED', 'RUNNING'].includes(operation.state)) continue;
      const result = lifecycleAuthority.fail(operation.operationId, {
        code: reason,
        message: '进程重启中断了内存模型调用；旧运行任务已明确失败，禁止永久保持 running。'
      }, {
        generation: operation.generation,
        objectFingerprint: operation.objectFingerprint
      });
      if (result?.updated !== false) recovered += 1;
    }
    hasMore = snapshot.hasMore === true;
    cursor = snapshot.nextCursor;
    if (!rows.length) break;
  }
  const remainingSnapshot = lifecycleAuthority.snapshot({
    operationType: 'ai.reply.candidates', states: [STATES.CREATED, STATES.RUNNING], limit: 1, order: 'oldest'
  });
  return {
    scanned, recovered, remaining: Number(remainingSnapshot.total || 0),
    oldestPendingAt: remainingSnapshot.oldestPendingAt || oldestPendingAt,
    pages, reason, budgetExhausted: hasMore, hasMore: Number(remainingSnapshot.total || 0) > 0
  };
}

function status() {
  const durable = lifecycleAuthority.snapshot({ operationType: 'ai.reply.candidates', limit: 100 });
  return {
    active: entries.size,
    durable,
    tasks: [...entries.values()].map(entry => ({
      taskId: entry.taskId,
      operationId: entry.operationId,
      generation: entry.generation,
      objectFingerprint: entry.objectFingerprint,
      executionId: entry.executionId,
      contactId: entry.contactId,
      conversationId: entry.conversationId,
      modelId: entry.modelId,
      startedAt: entry.startedAt,
      aborted: entry.controller.signal.aborted,
      state: lifecycleAuthority.read(entry.operationId)?.state || STATES.RUNNING
    }))
  };
}

module.exports = {
  start,
  replace,
  cancel,
  succeed,
  fail,
  cancelForContact,
  cancelForConversation,
  cancelAll,
  finish,
  status,
  recoverInterrupted,
  assertCurrent
};
