'use strict';

const defaultEventBus = require('./eventBus');
const { PERSONA_BRAIN_EVENTS } = require('../../shared/personaBrainContract');

function clean(value) { return String(value == null ? '' : value).trim(); }

function versionPayload(profileId, version) {
  return {
    profileId,
    version: Number(version?.version || 0),
    parentVersion: Number(version?.parentVersion || 0),
    operation: String(version?.operation || ''),
    contentSha256: String(version?.contentSha256 || ''),
    changedPaths: Array.isArray(version?.changedPaths) ? [...version.changedPaths] : [],
    rollbackOfVersion: Number(version?.rollbackOfVersion || 0)
  };
}

function ensureOwnerPersonaBaseline(service, options = {}) {
  const profileId = clean(options.profileId) || 'owner';
  const presetId = clean(options.presetId) || 'yeonhee-kim-v1';
  const eventBus = options.eventBus || defaultEventBus;
  if (!service || typeof service.getCurrent !== 'function' || typeof service.initializeDefault !== 'function') {
    return { ok: false, created: false, reasonCode: 'PERSONA_BASELINE_SERVICE_UNAVAILABLE', profileId, presetId };
  }
  try {
    const existing = service.getCurrent(profileId);
    if (existing) {
      return {
        ok: true,
        created: false,
        profileId,
        presetId,
        version: Number(existing.profile?.activeVersion || existing.version?.version || 0)
      };
    }
    const result = service.initializeDefault({
      profileId,
      presetId,
      source: 'system-bootstrap-default',
      reason: 'Initialize editable Yeonhee Persona baseline',
      metadata: { bootstrap: true, protectedExistingProfile: true }
    });
    if (result?.created && result?.version && eventBus?.publish) {
      const payload = versionPayload(profileId, result.version);
      eventBus.publish(PERSONA_BRAIN_EVENTS.initialized, payload);
      eventBus.publish(PERSONA_BRAIN_EVENTS.contextInvalidated, {
        profileId,
        version: payload.version,
        operation: payload.operation,
        contentSha256: payload.contentSha256,
        changedPaths: payload.changedPaths
      });
    }
    return {
      ok: true,
      created: Boolean(result?.created),
      profileId,
      presetId,
      version: Number(result?.version?.version || result?.profile?.activeVersion || 0)
    };
  } catch (error) {
    return {
      ok: false,
      created: false,
      profileId,
      presetId,
      reasonCode: String(error?.code || error?.reasonCode || 'PERSONA_BASELINE_INITIALIZATION_FAILED'),
      message: String(error?.message || 'Persona baseline initialization failed')
    };
  }
}

module.exports = { ensureOwnerPersonaBaseline, versionPayload };
