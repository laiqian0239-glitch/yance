'use strict';

const crypto = require('node:crypto');

function evidenceError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function createLangfuseLearningEvidenceAdapter(options = {}) {
  const client = options.client || null;
  const enabled = options.enabled === true;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

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
    const executionId = clean(evidence.executionId || evidence.id);
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

  function datasetItemId(datasetName, signalId) {
    const digest = crypto.createHash('sha256').update(`${datasetName}\0${signalId}`).digest('hex').slice(0, 32);
    return `learning-dataset-item-${digest}`;
  }

  function scoreSubject(score = {}) {
    const traceId = clean(score.traceId);
    const sessionId = clean(score.sessionId);
    const datasetRunId = clean(score.datasetRunId);
    const observationId = clean(score.observationId);
    const count = [traceId, sessionId, datasetRunId].filter(Boolean).length;
    if (count !== 1 || (observationId && !traceId)) {
      throw evidenceError(
        'LANGFUSE_SCORE_SUBJECT_REQUIRED',
        'A Learning-approved score must reference exactly one Langfuse trace, session, or dataset run; observation requires trace.'
      );
    }
    if (traceId) return observationId ? { traceId, observationId } : { traceId };
    if (sessionId) return { sessionId };
    return { datasetRunId };
  }

  function optionalScoreFields(score = {}) {
    const fields = {};
    if (score.dataType != null) fields.dataType = score.dataType;
    if (score.configId != null) fields.configId = score.configId;
    if (score.comment != null) fields.comment = score.comment;
    return fields;
  }

  async function bindTrainingEvidence(input = {}) {
    if (!enabled) throw evidenceError('LANGFUSE_TRAINING_EVIDENCE_DISABLED', 'Langfuse must be explicitly enabled for training evidence binding.');
    if (!client) throw evidenceError('LANGFUSE_CLIENT_REQUIRED', 'Langfuse Dataset/Score binding requires an injected client.');
    if (!client.api?.datasets || typeof client.api.datasets.create !== 'function') {
      throw evidenceError('LANGFUSE_DATASET_API_REQUIRED', 'Official @langfuse/client api.datasets.create API is required.');
    }
    if (!client.dataset || typeof client.dataset.createItem !== 'function') {
      throw evidenceError('LANGFUSE_DATASET_ITEM_API_REQUIRED', 'Official @langfuse/client dataset.createItem API is required.');
    }
    if (!client.api?.scores || typeof client.api.scores.create !== 'function') {
      throw evidenceError('LANGFUSE_SCORE_API_REQUIRED', 'Official @langfuse/client api.scores.create API is required for fail-closed score binding.');
    }

    const datasetName = clean(input.datasetName);
    const record = input.record || {};
    const signalId = clean(record.signalId);
    const score = record.score || {};
    if (!datasetName || !signalId) {
      throw evidenceError('LANGFUSE_TRAINING_RECORD_REQUIRED', 'Dataset name and canonical signal id are required.');
    }
    if (
      score.authority !== 'Langfuse' ||
      score.approvedByLearning !== true ||
      !clean(score.scoreId) ||
      !clean(score.name) ||
      score.value == null ||
      (typeof score.value === 'string' && !score.value.trim())
    ) {
      throw evidenceError('LANGFUSE_LEARNING_APPROVED_SCORE_REQUIRED', 'Only a complete Learning-approved Langfuse Score may bind training evidence.');
    }
    const subject = scoreSubject(score);
    const itemId = datasetItemId(datasetName, signalId);

    const dataset = await client.api.datasets.create({ name: datasetName });
    const item = await client.dataset.createItem({
      id: itemId,
      datasetName,
      input: record.content,
      expectedOutput: record.outcome,
      metadata: { canonicalSignalId: signalId, scoreId: score.scoreId, approvedByLearning: true }
    });
    const remoteScore = await client.api.scores.create({
      id: score.scoreId,
      ...subject,
      name: score.name,
      value: score.value,
      ...optionalScoreFields(score),
      metadata: { canonicalSignalId: signalId, datasetName, approvedByLearning: true }
    });

    return Object.freeze({
      bound: true,
      authority: 'Langfuse Dataset + Score',
      datasetName,
      datasetId: dataset?.id || null,
      datasetItemId: item?.id || itemId,
      canonicalSignalId: signalId,
      scoreId: score.scoreId,
      remoteScoreId: remoteScore?.id || null
    });
  }

  return Object.freeze({ snapshot, recordExecution, bindTrainingEvidence });
}

module.exports = { createLangfuseLearningEvidenceAdapter };
