'use strict';

const { executeModel } = require('./modelExecutor');

let activeExecutionId = '';
let controller = null;

function serializedError(error) {
  return {
    code: String(error?.code || 'MODEL_EXECUTION_FAILED'),
    message: String(error?.message || error || 'Model execution failed'),
    status: Number(error?.status || 0),
    stack: String(error?.stack || ''),
    details: error?.details && typeof error.details === 'object' ? error.details : undefined
  };
}

function send(message) {
  return new Promise(resolve => {
    if (!process.connected || typeof process.send !== 'function') {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}

process.on('message', async message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'terminate') {
    if (!activeExecutionId || message.executionId !== activeExecutionId) return;
    controller?.abort?.(Object.assign(new Error(String(message.reason || 'Model execution terminated')), {
      code: 'MODEL_EXECUTION_TERMINATED'
    }));
    return;
  }
  if (message.type !== 'execute' || activeExecutionId) return;
  activeExecutionId = String(message.executionId || process.env.YANCE_MODEL_EXECUTION_ID || '');
  controller = new AbortController();
  await send({ type: 'started', executionId: activeExecutionId });
  try {
    const options = { ...(message.options || {}) };
    const streamTokens = options.streamTokens === true;
    delete options.streamTokens;
    if (streamTokens) {
      options.onToken = token => {
        void send({ type: 'token', executionId: activeExecutionId, token });
      };
    }
    const result = await executeModel(
      message.model || {},
      Array.isArray(message.messages) ? message.messages : [],
      options,
      controller.signal
    );
    await send({ type: 'result', executionId: activeExecutionId, result });
    process.exit(0);
  } catch (error) {
    await send({ type: 'error', executionId: activeExecutionId, error: serializedError(error) });
    process.exit(1);
  }
});
