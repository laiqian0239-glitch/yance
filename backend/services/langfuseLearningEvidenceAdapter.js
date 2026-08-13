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

  async function bindTrainingEvidence(input = {}) {
    if (!enabled) throw evidenceError('LANGFUSE_TRAINING_EVIDENCE_DISABLED', 'Langfuse must be explicitly enabled for training evidence binding.');
    if (!client) throw evidenceError('LANGFUSE_CLIENT_REQUIRED', 'Langfuse Dataset/Score binding requires an injected client.');
    if (!client.dataset || typeof client.dataset.create !== 'function' || typeof client.dataset.createItem !== 'function') {
      throw evidenceError('LANGFUSE_DATASET_API_REQUIRED', 'Official Langfuse Dataset create/createItem APIs are required.');
    }
    if (!client.score || typeof client.score.create !== 'function') {
      throw evidenceError('LANGFUSE_SCORE_API_REQUIRED', 'Official Langfuse Score create API is required.');
    }

    const datasetName = String(input.datasetName || '').trim();
    const record = input.record || {};
    const signalId = String(record.signalId || '').trim();
    const score = record.score || {};
    if (!datasetName || !signalId) {
      throw evidenceError('LANGFUSE_TRAINING_RECORD_REQUIRED', 'Dataset name and canonical signal id are required.');
    }
    if (score.authority !== 'Langfuse' || score.approvedByLearning !== true || !String(score.scoreId || '').trim()) {
      throw evidenceError('LANGFUSE_LEARNING_APPROVED_SCORE_REQUIRED', 'Only a Learning-approved Langfuse Score may bind training evidence.');
    }

    const dataset = await client.dataset.create({ name: datasetName });
    const item = await client.dataset.createItem({
      id: signalId,
      datasetName,
      input: record.content,
      expectedOutput: record.outcome,
      metadata: { signalId, scoreId: score.scoreId, approvedByLearning: true }
    });
    const remoteScore = await client.score.create({
      id: score.scoreId,
      name: score.name,
      value: score.value,
      metadata: { signalId, datasetName, approvedByLearning: true }
    });

    return Object.freeze({
      bound: true,
      authority: 'Langfuse Dataset + Score',
      datasetName,
      datasetId: dataset?.id || null,
      datasetItemId: item?.id || signalId,
      scoreId: score.scoreId,
      remoteScoreId: remoteScore?.id || null
    });
  }

  return Object.freeze({ snapshot, recordExecution, bindTrainingEvidence });
}

module.exports = { createLangfuseLearningEvidenceAdapter };
