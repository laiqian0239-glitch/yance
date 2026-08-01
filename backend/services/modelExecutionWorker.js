'use strict';

const { executeIsolatedModel } = require('./isolatedModelExecutor');
const { verifyModelExecutionEnvelope } = require('./modelExecutionEnvelopeAuthority');

let activeExecutionId = '';
let activeCorrelationId = '';
let controller = null;

function serializedError(error) {
  return {
    code: String(error?.code || 'MODEL_EXECUTION_FAILED'),
    message: String(error?.message || error || 'Model execution failed'),
    status: Number(error?.status || 0),
    stack: String(error?.stack || ''),
    details: error?.details && typeof error.details === 'object' ? error.details : undefined,
    providerRequestId: String(error?.providerRequestId || error?.requestId || '')
  };
}
function send(message) {
  return new Promise(resolve => {
    if (!process.connected || typeof process.send !== 'function') return resolve();
    process.send({ correlationId: activeCorrelationId, ...message }, () => resolve());
  });
}
function providerRequestId(value = {}) {
  return String(value.providerRequestId || value.requestId || value.id || value.raw?.id || '').trim();
}

process.on('uncaughtException', async error => {
  await send({ type: 'error', executionId: activeExecutionId, error: serializedError(error) });
  process.exit(1);
});
process.on('unhandledRejection', async error => {
  await send({ type: 'error', executionId: activeExecutionId, error: serializedError(error) });
  process.exit(1);
});

process.on('message', async message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'terminate') {
    if (!activeExecutionId || message.executionId !== activeExecutionId) return;
    controller?.abort?.(Object.assign(new Error(String(message.reason || 'Model execution terminated')), {
      code: 'MODEL_EXECUTION_TERMINATED',
      abortSource: String(message.abortSource || 'runtime')
    }));
    return;
  }
  if (message.type !== 'execute' || activeExecutionId) return;
  try {
    const envelope = verifyModelExecutionEnvelope(message.envelope);
    if (Date.parse(envelope.deadlineAt) <= Date.now()) {
      throw Object.assign(new Error('Model execution deadline exceeded'), {
        code: 'MODEL_EXECUTION_DEADLINE_EXCEEDED', status: 408
      });
    }
    activeExecutionId = String(envelope.executionId || process.env.YANCE_MODEL_EXECUTION_ID || '');
    activeCorrelationId = String(envelope.correlationId || process.env.YANCE_MODEL_CORRELATION_ID || activeExecutionId);
    controller = new AbortController();
    await send({ type: 'started', executionId: activeExecutionId });
    const options = { ...(envelope.options || {}) };
    const streamTokens = options.streamTokens === true;
    delete options.streamTokens;
    if (streamTokens) options.onToken = token => { void send({ type: 'token', executionId: activeExecutionId, token }); };
    const source = envelope.executionSpec;
    const executionSpec = Object.freeze({
      provider: String(source.provider || ''),
      endpoint: String(source.endpoint || ''),
      modelName: String(source.modelName || ''),
      modelId: String(source.modelId || ''),
      ...(source.credential && typeof source.credential === 'object'
        ? { credential: Object.freeze({ apiKey: String(source.credential.apiKey || '') }) }
        : {})
    });
    const result = await executeIsolatedModel(executionSpec, envelope.messages, options, controller.signal);
    const requestId = providerRequestId(result || {});
    if (requestId) await send({ type: 'provider-request', executionId: activeExecutionId, providerRequestId: requestId });
    await send({ type: 'result', executionId: activeExecutionId, providerRequestId: requestId, result });
    process.exit(0);
  } catch (error) {
    const serialized = serializedError(error);
    await send({ type: 'error', executionId: activeExecutionId, providerRequestId: serialized.providerRequestId, error: serialized });
    process.exit(1);
  }
});
