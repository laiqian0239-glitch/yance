'use strict';

const ollama = require('./ollamaClient');
const cloud = require('./openAiCompatibleClient');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();

const MINIMUM_VISION_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';

function providerOf(model = {}) {
  return String(model.provider || model.kind || 'ollama').toLowerCase();
}

function credentialFor(model = {}) {
  const value = securityGuard.credentials.get(model.credentialRef || '') || {};
  return {
    apiKey: String(value.apiKey || value.key || value.token || ''),
    endpoint: String(value.endpoint || value.baseUrl || model.endpoint || ''),
    model: String(value.model || value.modelName || model.name || '')
  };
}

async function executeModel(model, messages, options = {}, signal) {
  const provider = providerOf(model);
  if (provider === 'ollama') {
    return ollama.streamChat({ endpoint: model.endpoint, model: model.name, messages, options, signal });
  }
  if (['openai', 'openai-compatible', 'cloud'].includes(provider)) {
    const credential = credentialFor(model);
    return cloud.chat({ endpoint: credential.endpoint || model.endpoint, apiKey: credential.apiKey, model: credential.model || model.name, messages, options, signal });
  }
  throw Object.assign(new Error(`UNSUPPORTED_MODEL_PROVIDER:${provider}`), { code: 'UNSUPPORTED_MODEL_PROVIDER' });
}

async function verifyCloudAccess({ endpoint, apiKey = '', model = '', signal, runInference = true, testVision = false } = {}) {
  const resolvedEndpoint = String(endpoint || '');
  let models;
  try {
    models = await cloud.listModels({ endpoint: resolvedEndpoint, apiKey, signal, timeoutMs: 30000 });
  } catch (error) {
    error.testStage = 'model-discovery';
    throw error;
  }
  const verification = {
    endpoint: cloud.normalizeEndpoint(resolvedEndpoint),
    models,
    modelAvailable: !model || models.includes(model),
    inference: null,
    vision: null,
    tests: { discovery: { pass: true, modelCount: models.length }, text: null, vision: null }
  };
  if (runInference && model) {
    try {
      verification.inference = await cloud.chat({
        endpoint: resolvedEndpoint,
        apiKey,
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: YANCE_MODEL_OK' }],
        options: { maxTokens: 24, temperature: 0, timeoutMs: 180000 },
        signal
      });
      verification.tests.text = {
        pass: /YANCE_MODEL_OK/i.test(String(verification.inference.text || '')),
        status: 200,
        returnedModel: String(verification.inference.returnedModel || ''),
        totalMs: Number(verification.inference.totalMs || 0),
        totalTokens: Number(verification.inference.totalTokens || 0)
      };
    } catch (error) {
      error.testStage = 'text-inference';
      error.availableModels = models;
      error.modelAvailable = verification.modelAvailable;
      error.details = { ...(error.details || {}), model, modelAvailable: verification.modelAvailable, availableModels: models.slice(0, 200), testStage: error.testStage };
      throw error;
    }
  }
  if (runInference && model && testVision) {
    try {
      verification.vision = await cloud.chat({
        endpoint: resolvedEndpoint,
        apiKey,
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'This is a one-pixel PNG test image. Reply with exactly: YANCE_VISION_OK' },
          { type: 'image_url', image_url: { url: MINIMUM_VISION_TEST_IMAGE, detail: 'low' } }
        ] }],
        options: { maxTokens: 24, temperature: 0, timeoutMs: 180000 },
        signal
      });
      verification.tests.vision = {
        pass: /YANCE_VISION_OK/i.test(String(verification.vision.text || '')),
        status: 200,
        returnedModel: String(verification.vision.returnedModel || ''),
        totalMs: Number(verification.vision.totalMs || 0),
        totalTokens: Number(verification.vision.totalTokens || 0)
      };
    } catch (error) {
      error.testStage = 'vision-inference';
      error.availableModels = models;
      error.modelAvailable = verification.modelAvailable;
      error.details = { ...(error.details || {}), model, modelAvailable: verification.modelAvailable, availableModels: models.slice(0, 200), testStage: error.testStage };
      throw error;
    }
  }
  return verification;
}


async function verifyCloudCredential({ endpoint, credentialRef, model = '', signal, runInference = true, testVision = false } = {}) {
  const credential = securityGuard.credentials.get(credentialRef) || {};
  return verifyCloudAccess({
    endpoint: String(credential.endpoint || credential.baseUrl || endpoint || ''),
    apiKey: String(credential.apiKey || credential.key || credential.token || ''),
    model, signal, runInference, testVision
  });
}

module.exports = { providerOf, credentialFor, executeModel, verifyCloudAccess, verifyCloudCredential, MINIMUM_VISION_TEST_IMAGE };
