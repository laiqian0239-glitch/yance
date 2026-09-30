'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const modelBrainUserPolicy = require('../services/modelBrainUserPolicy');
const { AiGateway } = require('../services/aiGateway');

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

function gateway(models) {
  return new AiGateway({
    registry: {
      read: () => ({ models }),
      recordInvocation: async () => ({ models }),
      recordInvocationFailure: async () => ({ models })
    }
  });
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
});

test('manual preference narrows only the already hard-qualified Model Brain candidates', () => {
  const local = model('ollama:qwen3:8b');
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const originalRead = modelBrainUserPolicy.read;
  modelBrainUserPolicy.read = () => modelBrainUserPolicy.normalizeDocument({
    preferredModelByTask: { quick_reply: local.id }
  });
  try {
    const projection = gateway([cloud, local]).projection('quick_reply');
    assert.deepEqual(projection.candidates.map(row => row.id), [local.id]);
    assert.equal(projection.routePreference.mode, 'manual');
    assert.equal(projection.routePreference.preferredModelId, local.id);
    assert.equal(projection.authority, 'LiteLLM v1.95.0');
  } finally {
    modelBrainUserPolicy.read = originalRead;
  }
});

test('manual preference fails closed when the requested model is no longer eligible', () => {
  const disabledLocal = model('ollama:qwen3:8b', 'ollama', { enabled: false });
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const originalRead = modelBrainUserPolicy.read;
  modelBrainUserPolicy.read = () => modelBrainUserPolicy.normalizeDocument({
    preferredModelByTask: { quick_reply: disabledLocal.id }
  });
  try {
    const projection = gateway([cloud, disabledLocal]).projection('quick_reply');
    assert.equal(projection.candidates.length, 0);
    assert.equal(projection.routePreference.mode, 'manual');
    assert.equal(projection.routePreference.preferredModelId, disabledLocal.id);
  } finally {
    modelBrainUserPolicy.read = originalRead;
  }
});

test('auto mode keeps all hard-qualified candidates under LiteLLM authority', () => {
  const local = model('ollama:qwen3:8b');
  const cloud = model('openrouter:deepseek-v4.1', 'openrouter');
  const originalRead = modelBrainUserPolicy.read;
  modelBrainUserPolicy.read = () => modelBrainUserPolicy.normalizeDocument({});
  try {
    const projection = gateway([cloud, local]).projection('quick_reply');
    assert.deepEqual(new Set(projection.candidates.map(row => row.id)), new Set([cloud.id, local.id]));
    assert.equal(projection.routePreference.mode, 'auto');
    assert.equal(projection.routePreference.preferredModelId, '');
  } finally {
    modelBrainUserPolicy.read = originalRead;
  }
});
