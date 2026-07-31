'use strict';

const VALID_MODES = new Set(['production', 'development', 'test', 'demo']);

function resolveRuntimeMode(env = process.env) {
  const explicit = String(env.YANCE_RUNTIME_MODE || '').trim().toLowerCase();
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const requested = explicit || (nodeEnv === 'test' ? 'test' : nodeEnv === 'development' ? 'development' : 'production');

  if (!VALID_MODES.has(requested)) {
    const error = new Error(`Unsupported YANCE_RUNTIME_MODE: ${requested}`);
    error.code = 'INVALID_RUNTIME_MODE';
    throw error;
  }

  if (requested === 'demo' && String(env.YANCE_ALLOW_DEMO_MODE || '') !== '1') {
    const error = new Error('Demo mode is physically isolated and requires YANCE_ALLOW_DEMO_MODE=1.');
    error.code = 'DEMO_MODE_NOT_AUTHORIZED';
    throw error;
  }

  return requested;
}

const mode = resolveRuntimeMode();

module.exports = Object.freeze({
  mode,
  isProduction: mode === 'production',
  isDevelopment: mode === 'development',
  isTest: mode === 'test',
  isDemo: mode === 'demo',
  resolveRuntimeMode
});
