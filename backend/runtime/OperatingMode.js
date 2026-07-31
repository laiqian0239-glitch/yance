'use strict';

const { AppRuntimeError } = require('./errors');

const OPERATING_MODES = Object.freeze({
  NORMAL: 'normal',
  SAFE_MODE: 'safeMode'
});
const OPERATING_MODE_VALUES = Object.freeze(new Set(Object.values(OPERATING_MODES)));

function normalizeLegacyOperatingMode(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (raw === OPERATING_MODES.SAFE_MODE || raw.toLowerCase() === 'safemode' || raw.toLowerCase() === 'safe') return OPERATING_MODES.SAFE_MODE;
  if (['normal', 'ready', 'offline', 'suspended', 'updating', 'shuttingdown', 'created'].includes(raw.toLowerCase())) return OPERATING_MODES.NORMAL;
  return null;
}

function assertOperatingMode(value, details = {}) {
  const normalized = String(value == null ? '' : value).trim();
  if (!OPERATING_MODE_VALUES.has(normalized)) {
    throw new AppRuntimeError('OPERATING_MODE_INVALID', `Unsupported operating mode: ${normalized || '<empty>'}`, {
      status: 400,
      details: { ...details, allowed: [...OPERATING_MODE_VALUES], supplied: normalized }
    });
  }
  return normalized;
}

function transitionAllowed(from, to) {
  return OPERATING_MODE_VALUES.has(from) && OPERATING_MODE_VALUES.has(to);
}

module.exports = {
  OPERATING_MODES,
  OPERATING_MODE_VALUES,
  assertOperatingMode,
  normalizeLegacyOperatingMode,
  transitionAllowed
};
