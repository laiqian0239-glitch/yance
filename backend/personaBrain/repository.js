'use strict';

const crypto = require('crypto');
const { parseJson } = require('../lib/r32SqliteStore');
const { sha256Json, clone } = require('./canonicalJson');
const { personaError } = require('./document');

function nowIso() { return new Date().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function json(value) { return JSON.stringify(value ?? null); }

function rowToVersion(row) {
  if (!row) return null;
  return {
    profileId: row.profile_id,
    version: Number(row.version),
    parentVersion: Number(row.parent_version),
    schemaVersion: Number(row.schema_version),
    operation: row.operation,
    content: parseJson(row.content_json, {}),
    contentSha256: row.content_sha256,
    changedPaths: parseJson(row.changed_paths_json, []),
    reason: row.change_reason,
    source: row.change_source,
    rollbackOfVersion: Number(row.rollback_of_version),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

function rowToPendingChange(row) {
  if (!row) return null;
  return {
    changeId: row.change_id,
    profileId: row.profile_id,
    baseVersion: Number(row.base_version),
    patch: parseJson(row.patch_json, {}),
    evidence: parseJson(row.evidence_json, []),
    source: row.source,
    reason: row.reason,
    state: row.state,
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    appliedVersion: Number(row.applied_version)
  };
}

function rowToScopeBinding(row) {
  if (!row) return null;
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    profileId: row.profile_id,
    bindingVersion: Number(row.binding_version || 1),
    authoritativePatch: parseJson(row.authoritative_patch_json, {}),
    styleOverlay: parseJson(row.style_overlay_json, {}),
    state: row.state,
    temporary: Number(row.temporary || 0) === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class PersonaBrainRepository {
  constructor(store) {
    if (!store?.db || typeof store.transaction !== 'function') throw new TypeError('R32SqliteStore is required');
    this.store = store;
    const { ensurePersonaBrainSchema } = require('./schema');
    ensurePersonaBrainSchema(store.db);
  }

  listProfiles(limit = 100) {
    return this.store.db.prepare(`
      SELECT profile_id, active_version, schema_version, state, created_at, updated_at
      FROM persona_brain_profiles
      ORDER BY updated_at DESC, profile_id ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(1000, Number(limit) || 100))).map(row => ({
      profileId: row.profile_id,
      activeVersion: Number(row.active_version),
      schemaVersion: Number(row.schema_version),
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getProfile(profileId = 'owner') {
    const id = clean(profileId) || 'owner';
    const row = this.store.db.prepare(`
      SELECT profile_id, active_version, schema_version, state, created_at, updated_at
      FROM persona_brain_profiles WHERE profile_id=?
    `).get(id);
    if (!row) return null;
    return {
      profileId: row.profile_id,
      activeVersion: Number(row.active_version),
      schemaVersion: Number(row.schema_version),
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  getVersion(profileId = 'owner', version) {
    const row = this.store.db.prepare(`
      SELECT * FROM persona_brain_versions WHERE profile_id=? AND version=?
    `).get(clean(profileId) || 'owner', Number(version));
    return rowToVersion(row);
  }

  getCurrent(profileId = 'owner') {
    const profile = this.getProfile(profileId);
    if (!profile) return null;
    const version = this.getVersion(profile.profileId, profile.activeVersion);
    return version ? { profile, version } : null;
  }

  listVersions(profileId = 'owner', limit = 100) {
    const rows = this.store.db.prepare(`
      SELECT * FROM persona_brain_versions
      WHERE profile_id=?
      ORDER BY version DESC
      LIMIT ?
    `).all(clean(profileId) || 'owner', Math.max(1, Math.min(1000, Number(limit) || 100)));
    return rows.map(rowToVersion);
  }

  listChanges(profileId = 'owner', limit = 100) {
    return this.store.db.prepare(`
      SELECT change_id AS changeId, profile_id AS profileId,
             from_version AS fromVersion, to_version AS toVersion,
             operation, changed_paths_json AS changedPathsJson,
             reason, source, metadata_json AS metadataJson, created_at AS createdAt
      FROM persona_brain_change_log
      WHERE profile_id=?
      ORDER BY to_version DESC
      LIMIT ?
    `).all(clean(profileId) || 'owner', Math.max(1, Math.min(1000, Number(limit) || 100))).map(row => ({
      ...row,
      fromVersion: Number(row.fromVersion),
      toVersion: Number(row.toVersion),
      changedPaths: parseJson(row.changedPathsJson, []),
      metadata: parseJson(row.metadataJson, {})
    }));
  }

  listPendingChanges(profileId = 'owner', options = {}) {
    const state = clean(options.state);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 100));
    const rows = state
      ? this.store.db.prepare(`SELECT * FROM persona_brain_pending_changes WHERE profile_id=? AND state=? ORDER BY created_at DESC LIMIT ?`).all(clean(profileId) || 'owner', state, limit)
      : this.store.db.prepare(`SELECT * FROM persona_brain_pending_changes WHERE profile_id=? ORDER BY created_at DESC LIMIT ?`).all(clean(profileId) || 'owner', limit);
    return rows.map(rowToPendingChange);
  }

  getScopeBinding(scopeType, scopeId) {
    return rowToScopeBinding(this.store.db.prepare(`
      SELECT * FROM persona_brain_scope_bindings WHERE scope_type=? AND scope_id=?
    `).get(clean(scopeType), clean(scopeId)));
  }

  listScopeBindings(options = {}) {
    const scopeType = clean(options.scopeType);
    const profileId = clean(options.profileId);
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    let rows;
    if (scopeType && profileId) {
      rows = this.store.db.prepare(`SELECT * FROM persona_brain_scope_bindings WHERE scope_type=? AND profile_id=? ORDER BY updated_at DESC LIMIT ?`).all(scopeType, profileId, limit);
    } else if (scopeType) {
      rows = this.store.db.prepare(`SELECT * FROM persona_brain_scope_bindings WHERE scope_type=? ORDER BY updated_at DESC LIMIT ?`).all(scopeType, limit);
    } else if (profileId) {
      rows = this.store.db.prepare(`SELECT * FROM persona_brain_scope_bindings WHERE profile_id=? ORDER BY updated_at DESC LIMIT ?`).all(profileId, limit);
    } else {
      rows = this.store.db.prepare(`SELECT * FROM persona_brain_scope_bindings ORDER BY updated_at DESC LIMIT ?`).all(limit);
    }
    return rows.map(rowToScopeBinding);
  }

  upsertScopeBinding(input = {}) {
    const scopeType = clean(input.scopeType);
    const scopeId = clean(input.scopeId);
    if (!['global', 'contact', 'conversation'].includes(scopeType) || !scopeId) {
      throw personaError('PERSONA_SCOPE_INVALID', 'Persona scope type and ID are required', { scopeType, scopeId });
    }
    const current = this.getScopeBinding(scopeType, scopeId);
    const expectedVersion = input.expectedBindingVersion == null ? null : Number(input.expectedBindingVersion);
    if (current && expectedVersion != null && current.bindingVersion !== expectedVersion) {
      throw personaError('PERSONA_SCOPE_VERSION_CONFLICT', 'Persona scope binding changed before this update', { expectedVersion, actualVersion: current.bindingVersion });
    }
    const now = clean(input.updatedAt) || nowIso();
    const nextVersion = current ? current.bindingVersion + 1 : 1;
    this.store.db.prepare(`
      INSERT INTO persona_brain_scope_bindings(
        scope_type, scope_id, profile_id, binding_version, authoritative_patch_json,
        style_overlay_json, state, temporary, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        profile_id=excluded.profile_id,
        binding_version=excluded.binding_version,
        authoritative_patch_json=excluded.authoritative_patch_json,
        style_overlay_json=excluded.style_overlay_json,
        state=excluded.state,
        temporary=excluded.temporary,
        expires_at=excluded.expires_at,
        updated_at=excluded.updated_at
    `).run(
      scopeType, scopeId, clean(input.profileId), nextVersion,
      json(input.authoritativePatch || {}), json(input.styleOverlay || {}),
      clean(input.state) || 'active', input.temporary === true ? 1 : 0,
      clean(input.expiresAt), current?.createdAt || now, now
    );
    return this.getScopeBinding(scopeType, scopeId);
  }

  clearScopeBinding(scopeType, scopeId) {
    const current = this.getScopeBinding(scopeType, scopeId);
    if (!current) return null;
    this.store.db.prepare(`DELETE FROM persona_brain_scope_bindings WHERE scope_type=? AND scope_id=?`).run(clean(scopeType), clean(scopeId));
    return current;
  }

  getPendingChange(profileId = 'owner', changeId) {
    return rowToPendingChange(this.store.db.prepare(`SELECT * FROM persona_brain_pending_changes WHERE profile_id=? AND change_id=?`).get(clean(profileId) || 'owner', clean(changeId)));
  }

  createPendingChange(input = {}) {
    const changeId = clean(input.changeId) || crypto.randomUUID();
    const profileId = clean(input.profileId) || 'owner';
    const current = this.getProfile(profileId);
    if (!current) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
    const reason = clean(input.reason);
    if (!reason) throw personaError('PERSONA_CHANGE_REASON_REQUIRED', 'A change reason is required');
    const createdAt = clean(input.createdAt) || nowIso();
    this.store.db.prepare(`
      INSERT INTO persona_brain_pending_changes(
        change_id, profile_id, base_version, patch_json, evidence_json,
        source, reason, state, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      changeId,
      profileId,
      Number(input.baseVersion == null ? current.activeVersion : input.baseVersion),
      json(input.patch || {}),
      json(Array.isArray(input.evidence) ? input.evidence : []),
      clean(input.source) || 'ai-suggestion',
      reason,
      clean(input.createdBy) || 'ai',
      createdAt
    );
    return this.getPendingChange(profileId, changeId);
  }

  decidePendingChange(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const changeId = clean(input.changeId);
    const decision = clean(input.decision);
    if (!['approved', 'rejected'].includes(decision)) {
      throw personaError('PERSONA_CHANGE_DECISION_INVALID', 'Decision must be approved or rejected');
    }
    const current = this.getPendingChange(profileId, changeId);
    if (!current) throw personaError('PERSONA_PENDING_CHANGE_NOT_FOUND', 'Pending persona change does not exist', { changeId });
    if (current.state !== 'pending') throw personaError('PERSONA_PENDING_CHANGE_ALREADY_DECIDED', 'Pending persona change has already been decided', { changeId, state: current.state });
    const decidedAt = clean(input.decidedAt) || nowIso();
    const result = this.store.db.prepare(`
      UPDATE persona_brain_pending_changes
      SET state=?, decided_by=?, decision_reason=?, decided_at=?, applied_version=?
      WHERE profile_id=? AND change_id=? AND state='pending'
    `).run(
      decision,
      clean(input.decidedBy) || 'user',
      clean(input.reason),
      decidedAt,
      Number(input.appliedVersion || 0),
      profileId,
      changeId
    );
    if (Number(result.changes || 0) !== 1) throw personaError('PERSONA_PENDING_CHANGE_CONFLICT', 'Pending persona change changed before decision');
    return this.getPendingChange(profileId, changeId);
  }

  _appendVersionWithinTransaction(input = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const reason = clean(input.reason);
    if (!reason) throw personaError('PERSONA_CHANGE_REASON_REQUIRED', 'A change reason is required');
    const document = clone(input.document);
    const contentSha256 = sha256Json(document);
    const changedPaths = Array.isArray(input.changedPaths)
      ? [...new Set(input.changedPaths.map(clean).filter(Boolean))].sort()
      : [];
    const timestamp = clean(input.createdAt) || nowIso();
    const profile = this.getProfile(profileId);
    const currentVersion = profile?.activeVersion || 0;
    const importMode = input.source === 'import';
    const expectedVersion = input.expectedVersion == null ? currentVersion : Number(input.expectedVersion);
    if (!importMode && expectedVersion !== currentVersion) {
      throw personaError('PERSONA_VERSION_CONFLICT', 'Persona version changed before the write could be committed', {
        expectedVersion,
        currentVersion
      });
    }

    const nextVersion = currentVersion + 1;
    const schemaVersion = Number(document.schemaVersion || 1);
    if (!profile) {
      this.store.db.prepare(`
        INSERT INTO persona_brain_profiles(profile_id, active_version, schema_version, state, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(profileId, nextVersion, schemaVersion, timestamp, timestamp);
    } else {
      const update = this.store.db.prepare(`
        UPDATE persona_brain_profiles
        SET active_version=?, schema_version=?, updated_at=?
        WHERE profile_id=? AND active_version=?
      `).run(nextVersion, schemaVersion, timestamp, profileId, currentVersion);
      if (Number(update.changes || 0) !== 1) {
        throw personaError('PERSONA_VERSION_CONFLICT', 'Persona version changed before the write could be committed', {
          expectedVersion,
          currentVersion
        });
      }
    }

    const operation = clean(input.operation) || (currentVersion ? 'update' : 'create');
    const source = clean(input.source) || 'user';
    this.store.db.prepare(`
      INSERT INTO persona_brain_versions(
        profile_id, version, parent_version, schema_version, operation,
        content_json, content_sha256, changed_paths_json, change_reason,
        change_source, rollback_of_version, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileId,
      nextVersion,
      currentVersion,
      schemaVersion,
      operation,
      json(document),
      contentSha256,
      json(changedPaths),
      reason,
      source,
      Number(input.rollbackOfVersion || 0),
      json(input.metadata || {}),
      timestamp
    );
    this.store.db.prepare(`
      INSERT INTO persona_brain_change_log(
        change_id, profile_id, from_version, to_version, operation,
        changed_paths_json, reason, source, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), profileId, currentVersion, nextVersion,
      operation, json(changedPaths), reason, source,
      json(input.metadata || {}), timestamp
    );
    return this.getVersion(profileId, nextVersion);
  }

  appendVersion(input = {}, options = {}) {
    let created;
    this.store.transaction(() => {
      created = this._appendVersionWithinTransaction(input);
      if (typeof options.afterAppend === 'function') options.afterAppend(created);
    });
    return created;
  }

  appendVersionsAtomically(inputs = [], options = {}) {
    if (!Array.isArray(inputs) || inputs.length < 1) {
      throw personaError('PERSONA_IMPORT_INVALID', 'Atomic Persona version import requires at least one version');
    }
    const created = [];
    this.store.transaction(() => {
      for (const input of inputs) created.push(this._appendVersionWithinTransaction(input));
      if (typeof options.afterAppend === 'function') options.afterAppend(created[created.length - 1], created);
    });
    return created;
  }

  approvePendingChangeWithVersion(input = {}, options = {}) {
    const profileId = clean(input.profileId) || 'owner';
    const changeId = clean(input.changeId);
    let version;
    let pendingChange;
    this.store.transaction(() => {
      const pending = this.getPendingChange(profileId, changeId);
      if (!pending) throw personaError('PERSONA_PENDING_CHANGE_NOT_FOUND', 'Pending persona change does not exist', { changeId });
      if (pending.state !== 'pending') {
        throw personaError('PERSONA_PENDING_CHANGE_ALREADY_DECIDED', 'Pending persona change has already been decided', {
          changeId,
          state: pending.state
        });
      }
      const profile = this.getProfile(profileId);
      if (!profile) throw personaError('PERSONA_PROFILE_NOT_FOUND', 'Persona profile does not exist', { profileId });
      if (profile.activeVersion !== pending.baseVersion) {
        throw personaError('PERSONA_PENDING_CHANGE_STALE', 'Persona changed after this suggestion was created; review and resubmit it', {
          changeId,
          baseVersion: pending.baseVersion,
          currentVersion: profile.activeVersion
        });
      }

      version = this._appendVersionWithinTransaction({
        ...input,
        profileId,
        expectedVersion: pending.baseVersion,
        operation: clean(input.operation) || 'update',
        source: clean(input.source) || 'user-approved-ai-change',
        metadata: {
          ...(input.metadata || {}),
          pendingChangeId: changeId,
          evidence: pending.evidence
        }
      });

      const decidedAt = clean(input.decidedAt) || nowIso();
      const update = this.store.db.prepare(`
        UPDATE persona_brain_pending_changes
        SET state='approved', decided_by=?, decision_reason=?, decided_at=?, applied_version=?
        WHERE profile_id=? AND change_id=? AND state='pending'
      `).run(
        clean(input.decidedBy) || 'user',
        clean(input.decisionReason),
        decidedAt,
        version.version,
        profileId,
        changeId
      );
      if (Number(update.changes || 0) !== 1) {
        throw personaError('PERSONA_PENDING_CHANGE_CONFLICT', 'Pending persona change changed before decision');
      }
      pendingChange = this.getPendingChange(profileId, changeId);
      if (typeof options.afterAppend === 'function') options.afterAppend(version, pendingChange);
    });
    return { version, pendingChange };
  }

  findCompletedMigration(profileId, sourceKind, sourceFingerprint, toSchemaVersion) {
    return this.store.db.prepare(`
      SELECT migration_id AS migrationId, profile_id AS profileId, source_kind AS sourceKind,
             source_id AS sourceId, source_fingerprint AS sourceFingerprint,
             from_schema_version AS fromSchemaVersion, to_schema_version AS toSchemaVersion,
             status, report_json AS reportJson, started_at AS startedAt, completed_at AS completedAt
      FROM persona_brain_migration_runs
      WHERE profile_id=? AND source_kind=? AND source_fingerprint=? AND to_schema_version=? AND status='completed'
      LIMIT 1
    `).get(clean(profileId) || 'owner', clean(sourceKind), clean(sourceFingerprint), Number(toSchemaVersion)) || null;
  }

  startMigration(input = {}) {
    const migrationId = clean(input.migrationId) || crypto.randomUUID();
    this.store.db.prepare(`
      INSERT INTO persona_brain_migration_runs(
        migration_id, profile_id, source_kind, source_id, source_fingerprint,
        from_schema_version, to_schema_version, status, report_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', '{}', ?, '')
    `).run(
      migrationId,
      clean(input.profileId) || 'owner',
      clean(input.sourceKind) || 'legacy-document',
      clean(input.sourceId),
      clean(input.sourceFingerprint),
      Number(input.fromSchemaVersion || 0),
      Number(input.toSchemaVersion || 1),
      clean(input.startedAt) || nowIso()
    );
    return migrationId;
  }

  _finishMigrationWithinTransaction(migrationId, status, report = {}, completedAt = nowIso()) {
    const normalizedStatus = clean(status);
    if (!['completed', 'failed'].includes(normalizedStatus)) {
      throw personaError('PERSONA_MIGRATION_STATUS_INVALID', 'Migration status must be completed or failed', { status: normalizedStatus });
    }
    const result = this.store.db.prepare(`
      UPDATE persona_brain_migration_runs
      SET status=?, report_json=?, completed_at=?
      WHERE migration_id=?
    `).run(normalizedStatus, json(report), clean(completedAt) || nowIso(), clean(migrationId));
    if (Number(result.changes || 0) !== 1) {
      throw personaError('PERSONA_MIGRATION_RUN_NOT_FOUND', 'Persona migration run does not exist', { migrationId: clean(migrationId) });
    }
    return { migrationId: clean(migrationId), status: normalizedStatus, report };
  }

  finishMigration(migrationId, status, report = {}, options = {}) {
    let completed;
    this.store.transaction(() => {
      completed = this._finishMigrationWithinTransaction(migrationId, status, report, options.completedAt);
    });
    return completed;
  }

  completeMigrationWithVersion(input = {}, options = {}) {
    const migrationId = clean(input.migrationId);
    if (!migrationId) throw personaError('PERSONA_MIGRATION_ID_REQUIRED', 'Migration ID is required');
    let version;
    let report;
    this.store.transaction(() => {
      version = this._appendVersionWithinTransaction(input.version || {});
      if (typeof options.afterAppend === 'function') options.afterAppend(version);
      if (typeof options.beforeComplete === 'function') options.beforeComplete(version);
      report = typeof options.reportFactory === 'function'
        ? options.reportFactory(version)
        : clone(input.report || {});
      this._finishMigrationWithinTransaction(migrationId, 'completed', report, input.completedAt);
      if (typeof options.afterComplete === 'function') options.afterComplete(version, report);
    });
    return { version, report };
  }

  // ─────────────────────────────────────────
  // AC-021: clearProfile (test isolation)
  // ─────────────────────────────────────────
  clearProfile(profileId = 'owner') {
    const id = clean(profileId) || 'owner';
    this.store.transaction(() => {
      this.store.db.prepare('DELETE FROM persona_brain_change_log WHERE profile_id=?').run(id);
      this.store.db.prepare('DELETE FROM persona_brain_pending_changes WHERE profile_id=?').run(id);
      this.store.db.prepare('DELETE FROM persona_brain_versions WHERE profile_id=?').run(id);
      this.store.db.prepare('DELETE FROM persona_brain_migration_runs WHERE profile_id=?').run(id);
      this.store.db.prepare('DELETE FROM persona_brain_profiles WHERE profile_id=?').run(id);
    });
  }

  // ─────────────────────────────────────────
  // AC-029: completeMigration alias (semantic alias for finishMigration)
  // Aligns with test comment: repository.completeMigration({ migrationId, status, report_json })
  // ─────────────────────────────────────────
  /**
   * @param {string} migrationId
   * @param {'running'|'completed'|'failed'} status
   * @param {object} report
   */
  completeMigration(migrationId, status, report = {}) {
    return this.finishMigration(migrationId, status, report);
  }
}

module.exports = { PersonaBrainRepository, rowToVersion, rowToPendingChange };
