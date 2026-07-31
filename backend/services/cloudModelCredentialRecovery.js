'use strict';

const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const registry = require('./modelRegistry');
const logger = require('./logger');

function looksCloud(ref, value = {}) {
  const text = `${ref} ${value.provider || ''} ${value.model || value.modelName || ''}`.toLowerCase();
  return Boolean(value.apiKey || value.key || value.token) && /(openai|gpt|cloud-model|compatible)/.test(text);
}

async function register(ref) {
  const value = securityGuard.credentials.get(ref) || {};
  if (!looksCloud(ref, value)) return null;
  const endpoint = String(value.endpoint || value.baseUrl || 'https://api.openai.com/v1');
  const name = String(value.model || value.modelName || 'gpt-4o-mini');
  const state = await registry.upsertCloudModel({ name, endpoint, credentialRef: ref, provider: value.provider || 'openai-compatible', source: 'startup-safe-storage-recovery' });
  logger.info('models', 'cloud-model-credential-recovered-at-startup', { ref, name, endpoint });
  return (state.models || []).find(model => model.credentialRef === ref && model.name === name) || null;
}

function install() {
  for (const ref of securityGuard.credentials.listRefs()) {
    register(ref).catch(error => logger.warn('models', 'startup-cloud-model-credential-recovery-failed', { ref, error: error.message }));
  }
}

module.exports = { install, register, looksCloud };
