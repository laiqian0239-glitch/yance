'use strict';

const productionCloud = require('./openAiCompatibleClient');
const productionOllama = require('./ollamaClient');

async function executeIsolatedModel(executionSpec = {}, messages = [], options = {}, signal = null, clients = {}) {
  const provider = String(executionSpec.provider || '').trim().toLowerCase();
  const cloud = clients.cloud || productionCloud;
  const ollama = clients.ollama || productionOllama;
  if (['openai', 'openai-compatible', 'cloud'].includes(provider)) {
    return cloud.chat({
      endpoint: executionSpec.endpoint,
      apiKey: executionSpec.credential?.apiKey || '',
      model: executionSpec.modelName,
      messages,
      options,
      signal
    });
  }
  if (provider === 'ollama') {
    return ollama.streamChat({ endpoint: executionSpec.endpoint, model: executionSpec.modelName, messages, options, signal });
  }
  throw Object.assign(new Error(`UNSUPPORTED_MODEL_PROVIDER:${provider}`), { code: 'UNSUPPORTED_MODEL_PROVIDER', status: 400 });
}

module.exports = { executeIsolatedModel };
