'use strict';

const { deepFreeze } = require('../lib/deepFreeze');

function authorityTimeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizePurpose(value) {
  const purpose = String(value == null ? '' : value).trim();
  if (!purpose || purpose.length > 128 || /[\u0000-\u001f\u007f]/u.test(purpose)) {
    throw authorityTimeError(
      'WP_B_AUTHORITY_TIME_PURPOSE_INVALID',
      'Authority timestamp purpose must be a non-empty stable identifier'
    );
  }
  return purpose;
}

function normalizeEpochMs(value, field) {
  const raw = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) {
    throw authorityTimeError(
      'WP_B_AUTHORITY_TIME_INVALID',
      `${field} must resolve to a finite integer epoch millisecond`,
      { field }
    );
  }
  try {
    new Date(raw).toISOString();
  } catch (_) {
    throw authorityTimeError('WP_B_AUTHORITY_TIME_INVALID', `${field} is outside the ISO timestamp range`, { field });
  }
  return raw;
}

function normalizePreviousIso(value) {
  if (value == null || value === '') return null;
  const epochMs = Date.parse(String(value));
  if (!Number.isFinite(epochMs)) {
    throw authorityTimeError(
      'WP_B_AUTHORITY_PREVIOUS_TIME_INVALID',
      'previousIso must be a valid ISO timestamp when provided'
    );
  }
  const iso = new Date(epochMs).toISOString();
  if (iso !== String(value)) {
    throw authorityTimeError(
      'WP_B_AUTHORITY_PREVIOUS_TIME_INVALID',
      'previousIso must be normalized UTC ISO-8601'
    );
  }
  return Object.freeze({ epochMs, iso });
}

function issueAuthorityTimestamp(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw authorityTimeError('WP_B_AUTHORITY_TIME_OPTIONS_INVALID', 'Authority timestamp options must be an object');
  }
  if (typeof options.clock !== 'function') {
    throw authorityTimeError('WP_B_AUTHORITY_CLOCK_REQUIRED', 'An explicit authority clock is required');
  }

  const purpose = normalizePurpose(options.purpose);
  const epochMs = normalizeEpochMs(options.clock(), 'clock');
  const iso = new Date(epochMs).toISOString();
  const previous = normalizePreviousIso(options.previousIso);
  if (previous && epochMs < previous.epochMs) {
    throw authorityTimeError(
      'WP_B_AUTHORITY_TIME_ROLLBACK',
      'Authority clock moved backwards relative to previousIso',
      { previousIso: previous.iso, incomingIso: iso, purpose }
    );
  }

  return deepFreeze({
    schemaVersion: 1,
    authority: 'AuthorityClock',
    purpose,
    iso,
    epochMs
  });
}

module.exports = Object.freeze({
  issueAuthorityTimestamp
});
