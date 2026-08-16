'use strict';

function normalizeEndpoint(value) {
  if (!value) return null;
  try { return new URL(String(value)); } catch (_) { return null; }
}

function isLoopbackEndpoint(value) {
  const endpoint = normalizeEndpoint(value);
  if (!endpoint) return false;
  const host = endpoint.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function createLearningDataPolicy(options = {}) {
  const presidio = options.presidio || null; // Presidio is the PII authority.
  const remoteTelemetryEnabled = options.remoteTelemetryEnabled === true;

  async function minimize(input = {}) {
    const doNotLearn = input.doNotLearn === true || input.do_not_learn === true;
    if (doNotLearn) return Object.freeze({ allowed: false, reasonCode: 'DO_NOT_LEARN', text: '' });
    const text = String(input.text || '');
    if (!text) return Object.freeze({ allowed: true, text: '', minimized: true });
    if (!presidio || typeof presidio.anonymize !== 'function') {
      return Object.freeze({ allowed: false, reasonCode: 'PRESIDIO_UNAVAILABLE', text: '' });
    }
    const anonymized = await presidio.anonymize(text, { language: input.language || 'en' });
    return Object.freeze({ allowed: true, minimized: true, text: String(anonymized || '') });
  }

  function outboundPolicy(input = {}) {
    const endpoint = input.endpoint || '';
    if (!endpoint) return Object.freeze({ allowed: false, reasonCode: 'LEARNING_ENDPOINT_REQUIRED' });
    if (isLoopbackEndpoint(endpoint)) return Object.freeze({ allowed: true, mode: 'loopback' });
    if (!remoteTelemetryEnabled) return Object.freeze({ allowed: false, reasonCode: 'REMOTE_TELEMETRY_OFF' });
    return Object.freeze({ allowed: true, mode: 'explicit-remote' });
  }

  return Object.freeze({
    authority: 'Presidio',
    defaults: Object.freeze({ remoteTelemetry: 'off', rawPrivateChatTraining: 'off' }),
    minimize,
    outboundPolicy,
    isLoopbackEndpoint
  });
}

module.exports = { createLearningDataPolicy, isLoopbackEndpoint };
