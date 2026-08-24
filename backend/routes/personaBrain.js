'use strict';

const { createPersonaBrain } = require('../personaBrain');
const defaultEventBus = require('../services/eventBus');
const defaultSystemPolicy = require('../services/systemPolicy');
const {
  PERSONA_BRAIN_EVENTS,
  PERSONA_BRAIN_EVENT_PAYLOAD_POLICY
} = require('../../shared/personaBrainContract');
const { ensureOwnerPersonaBaseline } = require('../services/personaBaselineBootstrapService');
const characterCardParser = require('../../vendor/sillytavern/1.18.0/src/character-card-parser.cjs');
const TavernCardValidator = require('../../vendor/sillytavern/1.18.0/src/validator/TavernCardValidator.cjs');

const CHARACTER_CARD_MAX_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';

function parseCharacterCardPreviewBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length) throw routeError('PERSONA_CHARACTER_CARD_EMPTY', 'Character Card payload is empty', 400);
  if (buffer.length > CHARACTER_CARD_MAX_BYTES) throw routeError('PERSONA_CHARACTER_CARD_TOO_LARGE', 'Character Card payload exceeds 8mb', 413);

  let parsed;
  try {
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === PNG_SIGNATURE_HEX;
    const jsonText = isPng ? characterCardParser.read(buffer) : buffer.toString('utf8');
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw routeError('PERSONA_CHARACTER_CARD_INVALID', `Character Card could not be parsed: ${String(error?.message || error)}`, 400);
  }

  const validator = new TavernCardValidator(parsed);
  const version = validator.validate();
  if (!version) {
    throw routeError('PERSONA_CHARACTER_CARD_INVALID', `Character Card validation failed at ${validator.lastValidationError || 'unknown field'}`, 400, {
      validationField: validator.lastValidationError || ''
    });
  }

  const data = version === 1 ? parsed : (parsed.data || {});
  return {
    version,
    spec: version === 1 ? 'chara_card_v1' : String(parsed.spec || ''),
    specVersion: version === 1 ? '1.0' : String(parsed.spec_version || ''),
    characterCard: {
      name: String(data.name || ''),
      description: String(data.description || ''),
      personality: String(data.personality || ''),
      scenario: String(data.scenario || ''),
      firstMessage: String(data.first_mes || ''),
      exampleDialogueText: String(data.mes_example || ''),
      creatorNotes: String(data.creator_notes || ''),
      systemPrompt: String(data.system_prompt || ''),
      postHistoryInstructions: String(data.post_history_instructions || ''),
      alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(String) : [],
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      characterBook: data.character_book && typeof data.character_book === 'object' ? data.character_book : undefined,
      extensions: data.extensions && typeof data.extensions === 'object' ? data.extensions : {}
    }
  };
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function routeError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message || code), { code, reasonCode: code, status, details });
}

function normalizeProfileId(value) {
  const profileId = String(value == null ? '' : value).trim();
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    throw routeError('PERSONA_PROFILE_ID_INVALID', 'Persona profile ID is invalid', 400);
  }
  return profileId;
}


function normalizeScopeType(value) {
  const scopeType = String(value == null ? '' : value).trim().toLowerCase();
  if (!['global', 'contact', 'conversation'].includes(scopeType)) {
    throw routeError('PERSONA_SCOPE_TYPE_INVALID', 'Persona scope type is invalid', 400, { scopeType });
  }
  return scopeType;
}

function normalizeScopeId(value) {
  const scopeId = String(value == null ? '' : value).trim();
  if (!scopeId || scopeId.length > 256 || /[\x00-\x1F]/u.test(scopeId)) {
    throw routeError('PERSONA_SCOPE_ID_INVALID', 'Persona scope ID is invalid', 400);
  }
  return scopeId;
}

function normalizePendingState(value) {
  const state = String(value == null ? '' : value).trim().toLowerCase();
  if (!state) return '';
  if (!['pending', 'approved', 'rejected'].includes(state)) {
    throw routeError('PERSONA_PENDING_CHANGE_STATE_INVALID', 'Persona pending change state is invalid', 400, { state });
  }
  return state;
}

function normalizePositiveInteger(value, field, options = {}) {
  if (value == null || value === '') return options.optional ? undefined : options.defaultValue;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || (options.max && number > options.max)) {
    throw routeError('PERSONA_INTEGER_INVALID', `${field} must be a positive integer`, 400, { field });
  }
  return number;
}

function statusForPersonaError(error) {
  switch (error?.code) {
    case 'PERSONA_PROFILE_NOT_FOUND':
    case 'PERSONA_ROLLBACK_TARGET_NOT_FOUND':
    case 'PERSONA_VERSION_NOT_FOUND':
    case 'PERSONA_PENDING_CHANGE_NOT_FOUND':
      return 404;
    case 'PERSONA_VERSION_CONFLICT':
    case 'PERSONA_SCOPE_VERSION_CONFLICT':
    case 'PERSONA_PENDING_CHANGE_STALE':
    case 'PERSONA_PENDING_CHANGE_ALREADY_DECIDED':
    case 'PERSONA_PENDING_CHANGE_CONFLICT':
      return 409;
    case 'PERSONA_DOCUMENT_TOO_LARGE':
      return 413;
    default:
      return Number(error?.status || 400);
  }
}

function exposePersonaError(error) {
  if (!String(error?.code || '').startsWith('PERSONA_')) return error;
  error.status = statusForPersonaError(error);
  error.reasonCode = error.code;
  return error;
}

function versionEventPayload(profileId, version) {
  return {
    profileId,
    version: Number(version.version),
    parentVersion: Number(version.parentVersion || 0),
    operation: String(version.operation || ''),
    contentSha256: String(version.contentSha256 || ''),
    changedPaths: Array.isArray(version.changedPaths) ? [...version.changedPaths] : [],
    rollbackOfVersion: Number(version.rollbackOfVersion || 0)
  };
}

function publishVersionEvents(eventBus, profileId, result, eventName) {
  const payload = versionEventPayload(profileId, result.version);
  eventBus.publish(eventName, payload);
  eventBus.publish(PERSONA_BRAIN_EVENTS.contextInvalidated, {
    profileId,
    version: payload.version,
    operation: payload.operation,
    contentSha256: payload.contentSha256,
    changedPaths: payload.changedPaths
  });
}

function assertEventPayloadPolicy(payload) {
  const allowed = new Set(PERSONA_BRAIN_EVENT_PAYLOAD_POLICY.allowedFields);
  for (const key of Object.keys(payload || {})) {
    if (!allowed.has(key)) throw routeError('PERSONA_EVENT_PAYLOAD_POLICY_VIOLATION', `Persona event payload field is not allowed: ${key}`, 500);
  }
}

function safePublish(eventBus, type, payload) {
  assertEventPayloadPolicy(payload);
  return eventBus.publish(type, payload);
}


function compilePersonaContext(brain, profileIdValue, body = {}) {
  const profileId = normalizeProfileId(profileIdValue);
  const compileOptions = body && typeof body === 'object' ? body : {};
  const scope = {
    profileId,
    contactId: compileOptions.contactId,
    conversationId: compileOptions.conversationId,
    globalScopeId: compileOptions.globalScopeId
  };
  return { ok: true, ...brain.compileEffectiveContext(scope, compileOptions) };
}

function createPersonaBrainRouter(options = {}) {
  const express = options.express || require('express');
  const router = express.Router();
  const brain = options.brain || createPersonaBrain(options);
  const service = options.service || brain.service;
  const eventBus = options.eventBus || defaultEventBus;
  const systemPolicy = options.systemPolicy || defaultSystemPolicy;
  const ownerBaseline = options.initializeOwnerBaseline === true
    ? ensureOwnerPersonaBaseline(service, { ...(options.ownerBaseline || {}), eventBus })
    : { ok: true, created: false, skipped: true };
  router.personaOwnerBaseline = ownerBaseline;

  const write = operation => systemPolicy.assertWriteAllowed(`persona-brain-${operation}`);

  router.get('/bootstrap-status', (_req, res) => {
    res.status(ownerBaseline.ok === false ? 503 : 200).json({ ok: ownerBaseline.ok !== false, ownerBaseline });
  });

  router.post('/character-card/preview', express.raw({ type: 'application/octet-stream', limit: '8mb' }), (req, res, next) => {
    try {
      const preview = parseCharacterCardPreviewBuffer(req.body);
      res.set('Cache-Control', 'no-store').json({ ok: true, preview });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/profiles', (req, res, next) => {
    try {
      const limit = normalizePositiveInteger(req.query.limit, 'limit', { optional: true, max: 1000 }) || 100;
      res.json({ ok: true, profiles: service.listProfiles(limit) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/presets', (_req, res, next) => {
    try { res.json({ ok: true, presets: service.listPresets() }); }
    catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/effective', (req, res, next) => {
    try {
      const effective = service.resolveEffective({
        contactId: req.query.contactId,
        conversationId: req.query.conversationId,
        globalScopeId: req.query.globalScopeId
      });
      res.json({ ok: true, effective });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/scopes', (req, res, next) => {
    try {
      const scopeType = req.query.scopeType ? normalizeScopeType(req.query.scopeType) : '';
      const limit = normalizePositiveInteger(req.query.limit, 'limit', { optional: true, max: 1000 }) || 200;
      res.json({ ok: true, bindings: service.listScopeBindings({ scopeType, profileId: req.query.profileId, limit }) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.put('/scopes/:scopeType/:scopeId', (req, res, next) => {
    try {
      write('set-scope');
      const scopeType = normalizeScopeType(req.params.scopeType);
      const scopeId = normalizeScopeId(req.params.scopeId);
      const result = service.setScopeBinding({ ...(req.body || {}), scopeType, scopeId });
      safePublish(eventBus, PERSONA_BRAIN_EVENTS.scopeUpdated, {
        profileId: String(result.binding.profileId || ''),
        version: 0,
        operation: 'scope-update',
        scopeType,
        scopeId,
        bindingVersion: Number(result.binding.bindingVersion || 0)
      });
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.delete('/scopes/:scopeType/:scopeId', (req, res, next) => {
    try {
      write('clear-scope');
      const scopeType = normalizeScopeType(req.params.scopeType);
      const scopeId = normalizeScopeId(req.params.scopeId);
      const result = service.clearScopeBinding({ scopeType, scopeId });
      if (result.cleared) safePublish(eventBus, PERSONA_BRAIN_EVENTS.scopeCleared, {
        profileId: String(result.binding?.profileId || ''),
        version: 0,
        operation: 'scope-clear',
        scopeType,
        scopeId,
        bindingVersion: Number(result.binding?.bindingVersion || 0)
      });
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/current', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const current = service.getCurrent(profileId);
      if (!current) throw routeError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', 404, { profileId });
      res.json({ ok: true, ...current });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/validate', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const validation = service.validate({
        profileId,
        document: req.body?.document,
        authoritative: req.body?.authoritative
      });
      res.json({ ok: true, profileId, validation });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/export', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      res.json({ ok: true, exportedPayload: service.exportPersona(profileId) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/import', (req, res, next) => {
    try {
      write('import');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.importPersona({ profileId, exportedPayload: req.body?.exportedPayload || req.body });
      if (result.imported && result.version) {
        publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionCreated);
      }
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  // AC-038: signature verification status — active version + stale candidate/outbox counts
  router.get('/:profileId/signature-status', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const status = service.getSignatureStatus(profileId);
      res.json({ ok: true, profileId, ...status });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/versions', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const limit = normalizePositiveInteger(req.query.limit, 'limit', { optional: true, max: 1000 }) || 100;
      res.json({ ok: true, profileId, versions: service.listVersions(profileId, limit) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/versions/:version', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const versionNumber = normalizePositiveInteger(req.params.version, 'version');
      const version = service.getVersion(profileId, versionNumber);
      if (!version) throw routeError('PERSONA_VERSION_NOT_FOUND', 'Persona version does not exist', 404, { profileId, version: versionNumber });
      res.json({ ok: true, profileId, version });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/diff', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const fromVersion = normalizePositiveInteger(req.query.fromVersion, 'fromVersion');
      const toVersion = normalizePositiveInteger(req.query.toVersion, 'toVersion');
      res.json({ ok: true, ...service.diffVersions(profileId, fromVersion, toVersion) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/authoritative/preview', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const preview = service.previewAuthoritativeReplacement({
        profileId,
        authoritative: req.body?.authoritative || req.body?.document?.authoritative
      });
      res.set('Cache-Control', 'no-store').json({ ok: true, preview });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/changes', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const limit = normalizePositiveInteger(req.query.limit, 'limit', { optional: true, max: 1000 }) || 100;
      res.json({ ok: true, profileId, changes: service.listChanges(profileId, limit) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/initialize', (req, res, next) => {
    try {
      write('initialize');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.initialize({ ...(req.body || {}), profileId, source: 'user', validateAuthoritative: true });
      if (result.created) {
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.initialized, versionEventPayload(profileId, result.version));
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.contextInvalidated, {
          profileId,
          version: Number(result.version.version),
          operation: String(result.version.operation || 'create'),
          contentSha256: String(result.version.contentSha256 || ''),
          changedPaths: Array.isArray(result.version.changedPaths) ? result.version.changedPaths : []
        });
      }
      res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/initialize-default', (req, res, next) => {
    try {
      write('initialize-default');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.initializeDefault({ ...(req.body || {}), profileId, source: 'user-default-preset' });
      if (result.created) {
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.initialized, versionEventPayload(profileId, result.version));
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.contextInvalidated, {
          profileId,
          version: Number(result.version.version),
          operation: String(result.version.operation || 'create'),
          contentSha256: String(result.version.contentSha256 || ''),
          changedPaths: Array.isArray(result.version.changedPaths) ? result.version.changedPaths : []
        });
      }
      res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.patch('/:profileId/authoritative', (req, res, next) => {
    try {
      write('update-authoritative');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.updateAuthoritative({ ...(req.body || {}), profileId, source: 'user' });
      if (result.changed) publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionCreated);
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.put('/:profileId/authoritative', (req, res, next) => {
    try {
      write('replace-authoritative');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.replaceAuthoritative({
        ...(req.body || {}),
        profileId,
        authoritative: req.body?.authoritative || req.body?.document?.authoritative,
        source: 'user',
        actor: String(req.body?.actor || 'user'),
        previewReceipt: req.body?.previewReceipt,
        requirePreviewReceipt: true
      });
      if (result.changed) publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionCreated);
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.patch('/:profileId/learned', (req, res, next) => {
    try {
      write('update-learned');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.updateLearned({ ...(req.body || {}), profileId });
      if (result.changed) publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionCreated);
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.get('/:profileId/pending-changes', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const limit = normalizePositiveInteger(req.query.limit, 'limit', { optional: true, max: 1000 }) || 100;
      const state = normalizePendingState(req.query.state);
      res.json({ ok: true, profileId, pendingChanges: service.listPendingChanges(profileId, { limit, state }) });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/pending-changes', (req, res, next) => {
    try {
      write('propose-change');
      const profileId = normalizeProfileId(req.params.profileId);
      const pendingChange = service.proposeChange({ ...(req.body || {}), profileId });
      safePublish(eventBus, PERSONA_BRAIN_EVENTS.pendingChangeProposed, {
        profileId,
        changeId: pendingChange.changeId,
        baseVersion: Number(pendingChange.baseVersion || 0),
        state: pendingChange.state
      });
      res.status(201).json({ ok: true, profileId, pendingChange });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/pending-changes/:changeId/decision', (req, res, next) => {
    try {
      write('decide-change');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.decideChange({ ...(req.body || {}), profileId, changeId: req.params.changeId });
      if (result.changed && result.version) {
        publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionCreated);
      }
      safePublish(eventBus, PERSONA_BRAIN_EVENTS.pendingChangeDecided, {
        profileId,
        changeId: result.pendingChange.changeId,
        baseVersion: Number(result.pendingChange.baseVersion || 0),
        state: result.pendingChange.state,
        appliedVersion: Number(result.pendingChange.appliedVersion || 0)
      });
      res.json({ ok: true, profileId, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/rollback', (req, res, next) => {
    try {
      write('rollback');
      const profileId = normalizeProfileId(req.params.profileId);
      const result = service.rollback({ ...(req.body || {}), profileId, source: 'user', actor: String(req.body?.actor || 'user') });
      publishVersionEvents({ publish: (type, payload) => safePublish(eventBus, type, payload) }, profileId, result, PERSONA_BRAIN_EVENTS.versionRolledBack);
      res.json({ ok: true, ...result });
    } catch (error) { next(exposePersonaError(error)); }
  });

  router.post('/:profileId/migrations/legacy', (req, res, next) => {
    let profileId = '';
    try {
      write('migrate-legacy');
      profileId = normalizeProfileId(req.params.profileId);
      const result = service.migrateLegacy({ ...(req.body || {}), profileId });
      if (result.migrated) {
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.migrationCompleted, {
          profileId,
          version: Number(result.version.version),
          operation: 'migrate',
          contentSha256: String(result.version.contentSha256 || ''),
          changedPaths: Array.isArray(result.version.changedPaths) ? result.version.changedPaths : [],
          migrationId: String(result.migrationId || ''),
          sourceKind: String(result.report?.sourceKind || req.body?.sourceKind || 'legacy-document'),
          sourceFingerprint: String(result.sourceFingerprint || ''),
          schemaVersion: Number(result.report?.schemaVersion || 1)
        });
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.contextInvalidated, {
          profileId,
          version: Number(result.version.version),
          operation: 'migrate',
          contentSha256: String(result.version.contentSha256 || ''),
          changedPaths: Array.isArray(result.version.changedPaths) ? result.version.changedPaths : []
        });
      }
      res.json({ ok: true, ...result });
    } catch (error) {
      if (profileId) {
        safePublish(eventBus, PERSONA_BRAIN_EVENTS.migrationFailed, {
          profileId,
          operation: 'migrate',
          reasonCode: String(error.code || 'MIGRATION_FAILED')
        });
      }
      next(exposePersonaError(error));
    }
  });

  router.post('/:profileId/compile-context', (req, res, next) => {
    try {
      res.json(compilePersonaContext(brain, req.params.profileId, req.body));
    } catch (error) {
      next(error);
    }
  });

  // AC-040: candidate/outbox reverify_required 状态（供前端 UI badge 查询）
  router.get('/:profileId/candidate-status', (req, res, next) => {
    try {
      const profileId = normalizeProfileId(req.params.profileId);
      const counts = brain.candidateCoordinator.countReverifyRequired(profileId);
      res.json({ ok: true, profileId, ...counts });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPersonaBrainRouter,
  normalizeProfileId,
  statusForPersonaError,
  versionEventPayload,
  assertEventPayloadPolicy,
  normalizeScopeType,
  normalizeScopeId,
  compilePersonaContext,
  parseCharacterCardPreviewBuffer
};
