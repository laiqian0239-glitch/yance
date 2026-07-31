'use strict';

const { createEmptyPersonaDocument, PERSONA_BRAIN_SCHEMA_VERSION } = require('./schema');
const { normalizePersonaDocument, applyAuthoritativePatch, applyLearnedPatch, personaError } = require('./document');
const { isPlainObject, sha256Json, clone } = require('./canonicalJson');
const { migrateLegacyDocumentToV1, fingerprintMigrationSource, hasRecognizableLegacyPersonaContent } = require('./migrations');
const { buildDefaultPersonaDocument } = require('./defaultProfile');
const { listPersonaPresets } = require('../persona/defaultPersonaProfile');
const { mergeStylePolicy, candidateAdjustmentOverlay, describeStylePolicy } = require('./stylePolicy');
const { compilePersonaContext } = require('./compiler');
const { buildDiff, buildPreviewReceipt } = require('./versionDiff');

function nowIso() { return new Date().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }

class PersonaBrainService {
  constructor(repository, { candidateCoordinator, validator } = {}) {
    if (!repository?.getCurrent || !repository?.appendVersion) throw new TypeError('PersonaBrainRepository is required');
    this.repository = repository;
    this._candidateCoordinator = candidateCoordinator || null;
    this._validator = validator || null;
  }

  _assertAuthoritative(content, operation) {
    if (this._validator) {
      this._validator.assertAuthoritative(content, operation);
    }
  }

  _invalidateCandidates(profileId, newVersion) {
    if (this._candidateCoordinator) {
      return this._candidateCoordinator.invalidateForPersonaVersion(profileId, newVersion);
    }
    return null;
  }

  _appendVersionAndInvalidate(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    return this.repository.appendVersion({ ...input, profileId }, {
      afterAppend: version => this._invalidateCandidates(profileId, version.version)
    });
  }

  _assertDirectAuthoritativeSource(source, operation) {
    const normalized = clean(source).toLowerCase();
    if (/^(?:ai|model|learning|auto)(?:$|[-_:])/.test(normalized)) {
      throw personaError(
        'PERSONA_AI_AUTHORITATIVE_WRITE_REQUIRES_APPROVAL',
        'AI and learning systems must propose authoritative Persona changes for explicit user approval',
        { source: normalized, operation }
      );
    }
  }

  // AC-038: Return signature verification status for a profile
  getSignatureStatus(profileId = 'owner') {
    const current = this.repository.getCurrent(profileId);
    const activeVersion = current?.version?.version || 0;
    const activePolicyHash = String(current?.version?.contentSha256 || '');
    let reverifyRequired = { candidates: 0, outbox: 0 };
    if (this._candidateCoordinator) {
      reverifyRequired = this._candidateCoordinator.countReverifyRequired(profileId);
    }
    return {
      activeVersion,
      activePolicyHash,
      reverifyRequired
    };
  }

  getCurrent(profileId = 'owner') {
    return this.repository.getCurrent(profileId);
  }
  listProfiles(limit = 100) {
    return this.repository.listProfiles(limit);
  }

  listPresets() {
    return listPersonaPresets();
  }

  getScopeBinding(scopeType, scopeId) {
    return this.repository.getScopeBinding(scopeType, scopeId);
  }

  listScopeBindings(options = {}) {
    return this.repository.listScopeBindings(options);
  }

  _activeScopeBinding(scopeType, scopeId, at = Date.now()) {
    if (!clean(scopeId)) return null;
    const binding = this.repository.getScopeBinding(scopeType, scopeId);
    if (!binding || binding.state !== 'active') return null;
    if (binding.expiresAt && Date.parse(binding.expiresAt) <= at) return null;
    return binding;
  }

  resolveEffective(input = {}) {
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    const globalScopeId = clean(input.globalScopeId) || 'owner';
    const bindings = [
      this._activeScopeBinding('global', globalScopeId),
      this._activeScopeBinding('contact', contactId),
      this._activeScopeBinding('conversation', conversationId)
    ].filter(Boolean);
    let profileId = clean(input.profileId) || 'owner';
    for (const binding of bindings) if (clean(binding.profileId)) profileId = clean(binding.profileId);
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Effective Persona profile does not exist', { profileId, contactId, conversationId });

    let document = clone(current.version.content);
    const appliedScopes = [];
    for (const binding of bindings) {
      if (isPlainObject(binding.authoritativePatch) && Object.keys(binding.authoritativePatch).length) {
        document = applyAuthoritativePatch(document, binding.authoritativePatch, { updatedAt: current.version.createdAt }).document;
      }
      appliedScopes.push({
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        bindingVersion: binding.bindingVersion,
        temporary: binding.temporary,
        expiresAt: binding.expiresAt
      });
    }
    let stylePolicy = document.authoritative?.replyStylePolicy || {};
    for (const binding of bindings) stylePolicy = mergeStylePolicy(stylePolicy, binding.styleOverlay);
    stylePolicy = mergeStylePolicy(stylePolicy, candidateAdjustmentOverlay(input.candidateAdjustment || {}));
    document.authoritative.replyStylePolicy = stylePolicy;

    const effectivePolicyHash = sha256Json({
      profileId,
      version: current.version.version,
      basePolicyHash: current.version.contentSha256,
      appliedScopes,
      authoritative: document.authoritative,
      learned: document.learned
    });
    return {
      profileId,
      profile: current.profile,
      version: { ...current.version, content: document, contentSha256: effectivePolicyHash },
      baseVersion: current.version.version,
      basePolicyHash: current.version.contentSha256,
      effectivePolicyHash,
      appliedScopes,
      stylePolicy: describeStylePolicy(stylePolicy),
      effectiveLabel: `${profileId} · v${current.version.version}${appliedScopes.length ? ` · ${appliedScopes.map(row => `${row.scopeType}:${row.bindingVersion}`).join(' + ')}` : ''}`
    };
  }

  compileEffectiveContext(input = {}, options = {}) {
    let effective;
    try {
      effective = this.resolveEffective({ ...input, candidateAdjustment: options.candidateAdjustment || input.candidateAdjustment });
    } catch (error) {
      if (error.code !== 'PERSONA_PROFILE_NOT_FOUND') throw error;
      const fallback = compilePersonaContext(null, options);
      fallback.profileId = clean(input.profileId) || 'owner';
      fallback.effectiveLabel = 'Persona 未初始化';
      fallback.appliedScopes = [];
      return fallback;
    }
    const compiled = compilePersonaContext(effective.version, { ...options, effectivePersona: effective });
    compiled.profileId = effective.profileId;
    compiled.baseVersion = effective.baseVersion;
    compiled.basePolicyHash = effective.basePolicyHash;
    compiled.effectiveLabel = effective.effectiveLabel;
    compiled.appliedScopes = effective.appliedScopes;
    compiled.stylePolicy = effective.stylePolicy;
    return compiled;
  }

  setScopeBinding(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const profileId = clean(input.profileId);
    if (profileId && !this.repository.getCurrent(profileId)) {
      throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    }
    const baseProfileId = profileId || clean(this.resolveEffective({
      contactId: scopeType === 'contact' ? scopeId : clean(input.contactId),
      conversationId: scopeType === 'conversation' ? scopeId : clean(input.conversationId)
    }).profileId) || 'owner';
    const current = this.repository.getCurrent(baseProfileId);
    if (isPlainObject(input.authoritativePatch) && Object.keys(input.authoritativePatch).length) {
      const applied = applyAuthoritativePatch(current.version.content, input.authoritativePatch, { updatedAt: nowIso() });
      this._assertAuthoritative(applied.document, 'setScopeBinding');
    }
    const binding = this.repository.upsertScopeBinding({
      ...input,
      scopeType,
      scopeId,
      profileId,
      styleOverlay: isPlainObject(input.styleOverlay) ? clone(input.styleOverlay) : {},
      updatedAt: clean(input.updatedAt) || nowIso()
    });
    const invalidated = this._candidateCoordinator?.invalidateForScope?.(scopeType, scopeId) || null;
    return { binding, invalidated };
  }

  clearScopeBinding(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    const binding = this.repository.clearScopeBinding(scopeType, scopeId);
    const invalidated = binding ? (this._candidateCoordinator?.invalidateForScope?.(scopeType, scopeId) || null) : null;
    return { cleared: Boolean(binding), binding, invalidated };
  }


  getVersion(profileId = 'owner', version) {
    return this.repository.getVersion(profileId, version);
  }

  listVersions(profileId = 'owner', limit = 100) {
    return this.repository.listVersions(profileId, limit);
  }

  listChanges(profileId = 'owner', limit = 100) {
    return this.repository.listChanges(profileId, limit);
  }


  diffVersions(profileId = 'owner', fromVersion, toVersion) {
    const id = clean(profileId) || 'owner';
    const from = this.repository.getVersion(id, Number(fromVersion));
    const to = this.repository.getVersion(id, Number(toVersion));
    if (!from) throw personaError('PERSONA_VERSION_NOT_FOUND', 'Persona source version does not exist', { profileId: id, version: Number(fromVersion) });
    if (!to) throw personaError('PERSONA_VERSION_NOT_FOUND', 'Persona target version does not exist', { profileId: id, version: Number(toVersion) });
    return {
      profileId: id,
      fromVersion: from.version,
      toVersion: to.version,
      diff: buildDiff(from.content.authoritative, to.content.authoritative, { limit: 1000 })
    };
  }

  previewAuthoritativeReplacement(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    if (!isPlainObject(input.authoritative)) throw personaError('PERSONA_AUTHORITATIVE_REPLACEMENT_INVALID', 'Authoritative replacement must be an object');
    const timestamp = clean(input.createdAt) || nowIso();
    const document = normalizePersonaDocument({
      ...clone(current.version.content),
      authoritative: clone(input.authoritative),
      metadata: { ...clone(current.version.content.metadata || {}), updatedAt: timestamp }
    }, profileId, {
      createdAt: current.version.content.metadata?.createdAt || timestamp,
      updatedAt: timestamp
    });
    this._assertAuthoritative(document, 'previewAuthoritativeReplacement');
    const diff = buildDiff(current.version.content.authoritative, document.authoritative, { limit: 1000 });
    const previewReceipt = buildPreviewReceipt({
      profileId,
      currentVersion: current.profile.activeVersion,
      currentContentSha256: current.version.contentSha256,
      proposedAuthoritativeSha256: sha256Json(document.authoritative),
      changedPaths: diff.changedPaths,
      createdAt: timestamp
    });
    return {
      profileId,
      currentVersion: current.profile.activeVersion,
      currentContentSha256: current.version.contentSha256,
      proposedAuthoritativeSha256: previewReceipt.proposedAuthoritativeSha256,
      diff,
      previewReceipt
    };
  }

  listPendingChanges(profileId = 'owner', options = {}) {
    return this.repository.listPendingChanges(profileId, options);
  }

  validate(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const current = this.repository.getCurrent(profileId);
    const source = input.document || (input.authoritative ? {
      ...(current?.version?.content || createEmptyPersonaDocument(profileId)),
      authoritative: input.authoritative
    } : current?.version?.content);
    if (!source) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    if (!this._validator) return { valid: true, errors: [], warnings: [], checks: [] };
    return this._validator.validate(normalizePersonaDocument(source, profileId, {
      createdAt: source.metadata?.createdAt || '',
      updatedAt: source.metadata?.updatedAt || ''
    }));
  }

  initialize(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const existing = this.repository.getCurrent(profileId);
    if (existing) return { created: false, ...existing };
    const timestamp = clean(input.createdAt) || nowIso();
    const document = normalizePersonaDocument(
      input.document || createEmptyPersonaDocument(profileId),
      profileId,
      { createdAt: timestamp, updatedAt: timestamp }
    );
    if (input.validateAuthoritative === true) this._assertAuthoritative(document, 'initialize');
    const version = this.repository.appendVersion({
      profileId,
      expectedVersion: 0,
      operation: 'create',
      document,
      changedPaths: ['authoritative', 'learned', 'metadata'],
      reason: clean(input.reason) || 'Initialize Persona Brain profile',
      source: clean(input.source) || 'system',
      metadata: input.metadata || {},
      createdAt: timestamp
    });
    return { created: true, profile: this.repository.getProfile(profileId), version };
  }

  initializeDefault(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const presetId = clean(input.presetId) || undefined;
    const document = buildDefaultPersonaDocument(profileId, presetId);
    this._assertAuthoritative(document, 'initializeDefault');
    return this.initialize({
      ...input,
      profileId,
      document,
      reason: clean(input.reason) || 'Initialize versioned editable persona preset',
      source: clean(input.source) || 'user-default-preset',
      metadata: { ...(input.metadata || {}), preset: presetId || 'yeonhee-kim-v1', fictionalRoleplay: document.authoritative.coreIdentity?.mode === 'fictional_roleplay' }
    });
  }

  updateAuthoritative(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    this._assertDirectAuthoritativeSource(input.source, 'updateAuthoritative');
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    const timestamp = clean(input.createdAt) || nowIso();
    const applied = applyAuthoritativePatch(current.version.content, input.patch || {}, { updatedAt: timestamp });
    if (!applied.changedPaths.length) return { changed: false, profile: current.profile, version: current.version };
    this._assertAuthoritative(applied.document, 'updateAuthoritative');
    const version = this._appendVersionAndInvalidate({
      profileId,
      expectedVersion: input.expectedVersion == null ? current.profile.activeVersion : input.expectedVersion,
      operation: 'update',
      document: applied.document,
      changedPaths: applied.changedPaths,
      reason: input.reason,
      source: clean(input.source) || 'user',
      metadata: input.metadata || {},
      createdAt: timestamp
    });
    return { changed: true, profile: this.repository.getProfile(profileId), version };
  }

  replaceAuthoritative(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    this._assertDirectAuthoritativeSource(input.source, 'replaceAuthoritative');
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    if (!isPlainObject(input.authoritative)) throw personaError('PERSONA_AUTHORITATIVE_REPLACEMENT_INVALID', 'Authoritative replacement must be an object');
    const timestamp = clean(input.createdAt) || nowIso();
    const document = normalizePersonaDocument({
      ...clone(current.version.content),
      authoritative: clone(input.authoritative),
      metadata: { ...clone(current.version.content.metadata || {}), updatedAt: timestamp }
    }, profileId, {
      createdAt: current.version.content.metadata?.createdAt || timestamp,
      updatedAt: timestamp
    });
    this._assertAuthoritative(document, 'replaceAuthoritative');
    const diff = buildDiff(current.version.content.authoritative, document.authoritative, { limit: 1000 });
    const expectedPreview = buildPreviewReceipt({
      profileId,
      currentVersion: current.profile.activeVersion,
      currentContentSha256: current.version.contentSha256,
      proposedAuthoritativeSha256: sha256Json(document.authoritative),
      changedPaths: diff.changedPaths,
      createdAt: clean(input.previewReceipt?.createdAt || timestamp)
    });
    if (input.requirePreviewReceipt === true) {
      const supplied = clean(input.previewReceipt?.receiptSha256 || input.previewReceiptSha256);
      if (!supplied || supplied !== expectedPreview.receiptSha256) {
        throw personaError('PERSONA_PREVIEW_RECEIPT_REQUIRED', 'Persona save requires a current field-level preview receipt', {
          currentVersion: current.profile.activeVersion,
          expectedPreviewReceiptSha256: expectedPreview.receiptSha256
        });
      }
    }
    if (sha256Json(document) === current.version.contentSha256) {
      return { changed: false, profile: current.profile, version: current.version };
    }
    const version = this._appendVersionAndInvalidate({
      profileId,
      expectedVersion: input.expectedVersion == null ? current.profile.activeVersion : input.expectedVersion,
      operation: 'replace-authoritative',
      document,
      changedPaths: diff.changedPaths.length ? diff.changedPaths : ['authoritative'],
      reason: input.reason,
      source: clean(input.source) || 'user',
      metadata: {
        ...(input.metadata || {}),
        actor: clean(input.actor) || 'user',
        approvalMode: 'explicit-user-save-after-diff-preview',
        approvedAt: timestamp,
        previewReceiptSha256: expectedPreview.receiptSha256,
        previousContentSha256: current.version.contentSha256,
        proposedAuthoritativeSha256: expectedPreview.proposedAuthoritativeSha256,
        changedCount: diff.changedCount
      },
      createdAt: timestamp
    });
    return { changed: true, profile: this.repository.getProfile(profileId), version };
  }

  updateLearned(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    const timestamp = clean(input.createdAt) || nowIso();
    const applied = applyLearnedPatch(current.version.content, input.patch || {}, { updatedAt: timestamp });
    if (!applied.changedPaths.length) return { changed: false, profile: current.profile, version: current.version };
    const version = this._appendVersionAndInvalidate({
      profileId,
      expectedVersion: input.expectedVersion == null ? current.profile.activeVersion : input.expectedVersion,
      operation: 'learn',
      document: applied.document,
      changedPaths: applied.changedPaths,
      reason: input.reason,
      source: clean(input.source) || 'learning-engine',
      metadata: input.metadata || {},
      createdAt: timestamp
    });
    return { changed: true, profile: this.repository.getProfile(profileId), version };
  }

  proposeChange(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    const patch = input.patch || {};
    // Validate the proposed document before accepting it into the review queue.
    const applied = applyAuthoritativePatch(current.version.content, patch, { updatedAt: clean(input.createdAt) || nowIso() });
    this._assertAuthoritative(applied.document, 'proposeChange');
    return this.repository.createPendingChange({
      profileId,
      baseVersion: current.profile.activeVersion,
      patch,
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      source: clean(input.source) || 'ai-suggestion',
      reason: clean(input.reason) || 'AI suggested an authoritative persona change',
      createdBy: clean(input.createdBy) || 'ai',
      createdAt: clean(input.createdAt) || nowIso()
    });
  }

  decideChange(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const changeId = clean(input.changeId);
    const decision = clean(input.decision).toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      throw personaError('PERSONA_CHANGE_DECISION_INVALID', 'Decision must be approved or rejected');
    }
    const pending = this.repository.getPendingChange(profileId, changeId);
    if (!pending) throw personaError('PERSONA_PENDING_CHANGE_NOT_FOUND', 'Pending persona change does not exist', { changeId });
    if (pending.state !== 'pending') {
      throw personaError('PERSONA_PENDING_CHANGE_ALREADY_DECIDED', 'Pending persona change has already been decided', {
        changeId,
        state: pending.state
      });
    }
    const decidedAt = clean(input.decidedAt) || nowIso();
    if (decision === 'rejected') {
      return {
        changed: false,
        pendingChange: this.repository.decidePendingChange({
          profileId,
          changeId,
          decision,
          decidedBy: clean(input.decidedBy) || 'user',
          reason: clean(input.reason),
          decidedAt
        })
      };
    }

    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    if (current.profile.activeVersion !== pending.baseVersion) {
      throw personaError('PERSONA_PENDING_CHANGE_STALE', 'Persona changed after this suggestion was created; review and resubmit it', {
        changeId,
        baseVersion: pending.baseVersion,
        currentVersion: current.profile.activeVersion
      });
    }
    const applied = applyAuthoritativePatch(current.version.content, pending.patch, { updatedAt: decidedAt });
    if (!applied.changedPaths.length) {
      const pendingChange = this.repository.decidePendingChange({
        profileId,
        changeId,
        decision: 'approved',
        decidedBy: clean(input.decidedBy) || 'user',
        reason: clean(input.reason),
        appliedVersion: current.profile.activeVersion,
        decidedAt
      });
      return { changed: false, profile: current.profile, version: current.version, pendingChange };
    }
    this._assertAuthoritative(applied.document, 'approvePendingChange');
    const committed = this.repository.approvePendingChangeWithVersion({
      profileId,
      changeId,
      document: applied.document,
      changedPaths: applied.changedPaths,
      reason: clean(input.reason) || pending.reason,
      source: 'user-approved-ai-change',
      metadata: { evidence: pending.evidence },
      createdAt: decidedAt,
      decidedAt,
      decidedBy: clean(input.decidedBy) || 'user',
      decisionReason: clean(input.reason)
    }, {
      afterAppend: version => this._invalidateCandidates(profileId, version.version)
    });
    return {
      changed: true,
      profile: this.repository.getProfile(profileId),
      version: committed.version,
      pendingChange: committed.pendingChange
    };
  }

  rollback(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const current = this.repository.getCurrent(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    const targetVersion = Number(input.targetVersion);
    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      throw personaError('PERSONA_ROLLBACK_TARGET_INVALID', 'Rollback target version must be a positive integer');
    }
    const target = this.repository.getVersion(profileId, targetVersion);
    if (!target) throw personaError('PERSONA_ROLLBACK_TARGET_NOT_FOUND', 'Rollback target version does not exist', { targetVersion });
    const timestamp = clean(input.createdAt) || nowIso();
    const targetDocument = JSON.parse(JSON.stringify(target.content));
    targetDocument.metadata = {
      ...(targetDocument.metadata || {}),
      createdAt: current.version.content.metadata?.createdAt || targetDocument.metadata?.createdAt || timestamp,
      updatedAt: timestamp
    };
    const document = normalizePersonaDocument(targetDocument, profileId, {
      createdAt: targetDocument.metadata.createdAt,
      updatedAt: timestamp
    });
    this._assertAuthoritative(document, 'rollback');
    const version = this._appendVersionAndInvalidate({
      profileId,
      expectedVersion: input.expectedVersion == null ? current.profile.activeVersion : input.expectedVersion,
      operation: 'rollback',
      document,
      changedPaths: ['authoritative', 'learned', 'metadata'],
      reason: clean(input.reason) || `Rollback to persona version ${targetVersion}`,
      source: clean(input.source) || 'user',
      rollbackOfVersion: targetVersion,
      metadata: {
        ...(input.metadata || {}),
        actor: clean(input.actor) || 'user',
        approvalMode: 'explicit-user-rollback',
        approvedAt: timestamp,
        restoredContentSha256: target.contentSha256,
        restoredAuthoritativeSha256: sha256Json(target.content.authoritative),
        rollbackVerification: {
          authoritativeMatch: sha256Json(document.authoritative) === sha256Json(target.content.authoritative),
          learnedMatch: sha256Json(document.learned) === sha256Json(target.content.learned)
        }
      },
      createdAt: timestamp
    });
    return {
      rolledBack: true,
      profile: this.repository.getProfile(profileId),
      version,
      target,
      rollbackVerification: {
        authoritativeMatch: sha256Json(document.authoritative) === sha256Json(target.content.authoritative),
        learnedMatch: sha256Json(document.learned) === sha256Json(target.content.learned),
        targetVersion,
        targetContentSha256: target.contentSha256,
        newContentSha256: version.contentSha256
      }
    };
  }

  // AC-029: migrate a legacy persona document into the current schema
  migrateLegacy(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const sourceKind = clean(input.sourceKind) || 'legacy-document';
    const sourceId = clean(input.sourceId);
    const sourceDocument = input.legacyDocument;
    const sourceFingerprint = fingerprintMigrationSource(sourceKind, sourceId, sourceDocument);
    const timestamp = clean(input.createdAt) || nowIso();

    if (!isPlainObject(sourceDocument)) {
      const migrationId = this.repository.startMigration({
        profileId,
        sourceKind,
        sourceId,
        sourceFingerprint,
        fromSchemaVersion: 0,
        toSchemaVersion: PERSONA_BRAIN_SCHEMA_VERSION,
        startedAt: timestamp
      });
      const error = personaError('PERSONA_MIGRATION_SOURCE_INVALID', 'legacyDocument must be a plain object', { profileId, sourceKind, sourceId });
      this.repository.finishMigration(migrationId, 'failed', { code: error.code, error: `${error.code}: ${error.message}` });
      throw error;
    }

    const completed = this.repository.findCompletedMigration(profileId, sourceKind, sourceFingerprint, PERSONA_BRAIN_SCHEMA_VERSION);
    if (completed) return { migrated: false, idempotent: true, sourceFingerprint, migration: completed };

    const current = this.repository.getCurrent(profileId);
    const migrationId = this.repository.startMigration({
      profileId,
      sourceKind,
      sourceId,
      sourceFingerprint,
      fromSchemaVersion: Number(sourceDocument.schemaVersion || 0),
      toSchemaVersion: PERSONA_BRAIN_SCHEMA_VERSION,
      startedAt: timestamp
    });

    try {
      if (!hasRecognizableLegacyPersonaContent(sourceDocument)) {
        throw personaError('PERSONA_MIGRATION_SOURCE_INVALID', 'legacyDocument has no recognizable persona content', { profileId, sourceKind, sourceId });
      }
      const migrated = migrateLegacyDocumentToV1(sourceDocument, profileId, {
        createdAt: current?.version?.content?.metadata?.createdAt || timestamp,
        updatedAt: timestamp
      });
      this._assertAuthoritative(migrated, 'migrateLegacy');
      const committed = this.repository.completeMigrationWithVersion({
        migrationId,
        version: {
          profileId,
          expectedVersion: input.expectedVersion == null ? (current?.profile?.activeVersion || 0) : input.expectedVersion,
          operation: 'migrate',
          document: migrated,
          changedPaths: ['authoritative', 'learned', 'metadata'],
          reason: clean(input.reason) || `Migrate ${sourceKind} into Persona Brain schema v${PERSONA_BRAIN_SCHEMA_VERSION}`,
          source: clean(input.source) || 'migration',
          metadata: { ...(input.metadata || {}), migrationId, sourceKind, sourceId, sourceFingerprint },
          createdAt: timestamp
        }
      }, {
        afterAppend: version => this._invalidateCandidates(profileId, version.version),
        beforeComplete: typeof input.beforeCompleteMigration === 'function' ? input.beforeCompleteMigration : undefined,
        reportFactory: version => ({
          profileId,
          version: version.version,
          sourceKind,
          sourceId,
          sourceFingerprint,
          schemaVersion: PERSONA_BRAIN_SCHEMA_VERSION
        })
      });
      return {
        migrated: true,
        idempotent: false,
        migrationId,
        sourceFingerprint,
        version: committed.version,
        report: committed.report
      };
    } catch (error) {
      try {
        this.repository.finishMigration(migrationId, 'failed', {
          code: error.code || 'MIGRATION_FAILED',
          error: `${error.code || 'MIGRATION_FAILED'}: ${error.message}`,
          message: error.message
        });
      } catch (recordError) {
        error.migrationRecordError = {
          code: recordError.code || 'MIGRATION_RECORD_FAILED',
          message: recordError.message
        };
      }
      throw error;
    }
  }
  // ─────────────────────────────────────────────────────────────────────
  // AC-021: serialize the current persona as a portable JSON snapshot
  // ─────────────────────────────────────────────────────────────────────
  serialize(profileId = 'owner') {
    const id = clean(profileId) || 'owner';
    const current = this.repository.getCurrent(id);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId: id });

    // T6: fingerprint = stable SHA256 of current version's content
    const fingerprint = current.version.contentSha256;

    // listVersions() returns DESC; flip to ASC for portable roundtrip
    const versions = this.repository.listVersions(id, 1000).reverse();

    return {
      schemaVersion: PERSONA_BRAIN_SCHEMA_VERSION,
      profileId: id,
      fingerprint,
      metadata: current.version.content.metadata,
      versions
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // AC-021: import a portable persona snapshot into the local store
  // ─────────────────────────────────────────────────────────────────────
  deserialize(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const payload = input.exportedPayload;
    if (!isPlainObject(payload) || !Array.isArray(payload.versions) || payload.versions.length < 1) {
      throw personaError('PERSONA_IMPORT_INVALID', 'Imported Persona payload must contain a non-empty versions array');
    }
    if (payload.versions.length > 1000) {
      throw personaError('PERSONA_IMPORT_TOO_LARGE', 'Imported Persona payload contains too many versions', { limit: 1000 });
    }
    for (const [index, version] of payload.versions.entries()) {
      if (!isPlainObject(version) || !isPlainObject(version.content)) {
        throw personaError('PERSONA_IMPORT_INVALID', 'Every imported Persona version must contain an object document', { index });
      }
      const normalized = normalizePersonaDocument(clone(version.content), profileId, {
        createdAt: version.content?.metadata?.createdAt || '',
        updatedAt: version.content?.metadata?.updatedAt || ''
      });
      this._assertAuthoritative(normalized, `importPersona[${index}]`);
    }

    // Stable source fingerprint is calculated from the actual imported documents,
    // not caller-supplied hashes. It remains stable when importing into another profile.
    const sourceVersionFingerprints = payload.versions.map(version => sha256Json(version.content));
    const importFingerprint = sha256Json({
      schemaVersion: Number(payload.schemaVersion || PERSONA_BRAIN_SCHEMA_VERSION),
      sourceProfileId: clean(payload.profileId),
      sourceVersionFingerprints
    });
    const existingImportedVersions = this.repository.listVersions(profileId, 1000)
      .filter(version => version.metadata?.importedFromFingerprint === importFingerprint)
      .sort((left, right) => Number(left.metadata?.importedVersion || 0) - Number(right.metadata?.importedVersion || 0));
    if (existingImportedVersions.length === payload.versions.length) {
      return {
        imported: false,
        idempotent: true,
        version: existingImportedVersions[existingImportedVersions.length - 1]
      };
    }

    const timestamp = clean(input.createdAt) || nowIso();
    const versionInputs = payload.versions.map((sourceVersion, index) => {
      const document = normalizePersonaDocument(
        clone(sourceVersion.content),
        profileId,
        {
          createdAt: sourceVersion.content?.metadata?.createdAt || timestamp,
          updatedAt: sourceVersion.content?.metadata?.updatedAt || sourceVersion.createdAt || timestamp
        }
      );
      return {
        profileId,
        operation: String(sourceVersion.operation || 'import'),
        document,
        changedPaths: Array.isArray(sourceVersion.changedPaths)
          ? sourceVersion.changedPaths
          : ['authoritative', 'learned', 'metadata'],
        reason: String(sourceVersion.reason || `Import source Persona version ${sourceVersion.version || index + 1}`),
        source: 'import',
        metadata: {
          ...(sourceVersion.metadata || {}),
          importedFromFingerprint: importFingerprint,
          importedVersion: Number(sourceVersion.version || index + 1),
          importedContentSha256: sourceVersionFingerprints[index]
        },
        createdAt: sourceVersion.createdAt || timestamp
      };
    });

    const insertedVersions = this.repository.appendVersionsAtomically(versionInputs, {
      afterAppend: version => this._invalidateCandidates(profileId, version.version)
    });
    const insertedVersion = insertedVersions[insertedVersions.length - 1];
    return { imported: true, idempotent: false, version: insertedVersion, importedCount: insertedVersions.length };
  }

  // ─────────────────────────────────────────────────────────────────────
  // AC-021: reset the persona store (test isolation only)
  // ─────────────────────────────────────────────────────────────────────
  _resetStore(profileId = 'owner') {
    this.repository.clearProfile(profileId);
  }


}


// 'export' and 'import' are reserved keywords in ES modules (Node.js v22).
// Expose the internal serialize/deserialize methods under the expected API names.
Object.defineProperty(PersonaBrainService.prototype, 'exportPersona', {
  value: PersonaBrainService.prototype.serialize,
  writable: true, configurable: true, enumerable: false
});
Object.defineProperty(PersonaBrainService.prototype, 'importPersona', {
  value: PersonaBrainService.prototype.deserialize,
  writable: true, configurable: true, enumerable: false
});
module.exports = { PersonaBrainService };
