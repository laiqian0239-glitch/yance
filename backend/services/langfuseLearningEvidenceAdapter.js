'use strict';

function evidenceError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function createLangfuseLearningEvidenceAdapter(options = {}) {
  const client = options.client || null;
  const enabled = options.enabled === true;

  function snapshot() {
    return Object.freeze({
      authority: 'Langfuse',
      enabled,
      remoteTelemetry: enabled ? 'explicitly-enabled' : 'off'
    });
  }

  async function recordExecution(evidence = {}) {
    if (!enabled) return Object.freeze({ recorded: false, reasonCode: 'LANGFUSE_TELEMETRY_OFF' });
    if (!client) throw evidenceError('LANGFUSE_CLIENT_REQUIRED', 'Explicitly enabled Langfuse evidence requires an injected Langfuse client.');
    const executionId = String(evidence.executionId || evidence.id || '').trim();
    if (!executionId) throw evidenceError('LANGFUSE_EXECUTION_ID_REQUIRED', 'Langfuse evidence requires an execution id.');
    if (typeof client.trace === 'function') {
      const trace = client.trace({ id: executionId, name: 'yance-learning-model-execution', metadata: evidence.metadata || {} });
      if (trace && typeof trace.update === 'function') trace.update({ output: evidence.output, input: evidence.input });
      return Object.freeze({ recorded: true, executionId, authority: 'Langfuse' });
    }
    if (typeof client.startObservation === 'function') {
      const observation = client.startObservation('yance-learning-model-execution', { metadata: evidence.metadata || {} });
      observation?.update?.({ output: evidence.output, input: evidence.input });
      observation?.end?.();
      return Object.freeze({ recorded: true, executionId, authority: 'Langfuse' });
    }
    throw evidenceError('LANGFUSE_CLIENT_CONTRACT_UNAVAILABLE', 'Injected Langfuse client does not expose a supported public evidence API.');
  }

  return Object.freeze({ snapshot, recordExecution });
}

module.exports = { createLangfuseLearningEvidenceAdapter };
