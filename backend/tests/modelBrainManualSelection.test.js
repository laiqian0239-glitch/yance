'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const modelBrainUserPolicy = require('../services/modelBrainUserPolicy');
const modelBrainProjection = require('../services/modelBrainProjection');
const { installR32StoreBridge, CHANNELS } = require('../../electron/r32StoreBridge');

function model(id, provider = 'ollama', extra = {}) {
  return {
    id,
    name: id,
    provider,
    qualification: 'verified',
    enabled: true,
    available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director'],
    ...extra
  };
}

function projection(models, document, task = 'quick_reply') {
  const options = modelBrainUserPolicy.requestOptions(task, {}, document);
  return modelBrainProjection.project({ models }, { task, constraints: options.constraints });
}

test('user policy normalizes a per-task preferred physical model without creating route ownership', () => {
  const normalized = modelBrainUserPolicy.normalizeDocument({
    reasoningLevel: 'high',
    fastMode: true,
    preferredModelByTask: {
      quick_reply: 'ollama:qwen3:8b',
      deep_reply: 'openrouter:deepseek/deepseek-v4.1',
      not_a_task: 'must-be-dropped'
    }
  });
  assert.equal(normalized.schemaVersion, 3);
  assert.deepEqual(normalized.preferredModelByTask, {
    quick_reply: 'ollama:qwen3:8b',
    deep_reply: 'openrouter:deepseek/deepseek-v4.1'
  });
  assert.equal(modelBrainUserPolicy.preferredModelId('quick_reply', normalized), 'ollama:qwen3:8b');
  assert.equal('primaryModel' in normalized, false);
  assert.equal('fallbackModel' in normalized, false);
});

test('manual preference narrows only the already hard-qualified Model Brain candidates', () => {
  const local = model('ollama:qwen3:8b');
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const document = modelBrainUserPolicy.normalizeDocument({
    preferredModelByTask: { quick_reply: local.id }
  });
  const result = projection([cloud, local], document);
  assert.deepEqual(result.candidates.map(row => row.id), [local.id]);
  assert.equal(result.authority, 'LiteLLM v1.95.0');
  assert.equal(result.preferredModelId, local.id);
});

test('manual preference fails closed when the requested model is no longer eligible', () => {
  const disabledLocal = model('ollama:qwen3:8b', 'ollama', { enabled: false });
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const document = modelBrainUserPolicy.normalizeDocument({
    preferredModelByTask: { quick_reply: disabledLocal.id }
  });
  const result = projection([cloud, disabledLocal], document);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.preferredModelId, disabledLocal.id);
});

test('auto mode keeps all hard-qualified candidates under LiteLLM authority', () => {
  const local = model('ollama:qwen3:8b');
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const result = projection([cloud, local], modelBrainUserPolicy.normalizeDocument({}));
  assert.deepEqual(new Set(result.candidates.map(row => row.id)), new Set([cloud.id, local.id]));
  assert.equal(result.preferredModelId, '');
});

test('preferred model validation rejects models that are not eligible for the selected task', () => {
  const local = model('ollama:qwen3:8b', 'ollama', { qualification: 'untested' });
  assert.throws(
    () => modelBrainUserPolicy.assertPreferredModelEligible({ models: [local] }, 'quick_reply', local.id),
    error => error.code === 'MODEL_BRAIN_PREFERRED_MODEL_INELIGIBLE' && error.status === 409
  );
});

test('desktop mutation forwards task and preferredModelId through the existing Model Brain preference endpoint', async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() {}, removeHandler() {}, removeListener() {}
  };
  const dispose = installR32StoreBridge({
    ipcMain,
    apiRequest: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });
  try {
    await handlers.get(CHANNELS.productModelRuntimeMutation)({}, {
      action: 'set-model-brain-preferences',
      reasoningLevel: 'high',
      fastMode: false,
      task: 'quick_reply',
      preferredModelId: 'ollama:qwen3:8b'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/r32/models/model-brain/preferences');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      reasoningLevel: 'high',
      fastMode: false,
      task: 'quick_reply',
      preferredModelId: 'ollama:qwen3:8b'
    });
  } finally {
    dispose();
  }
});
