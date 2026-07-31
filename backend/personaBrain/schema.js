'use strict';

const PERSONA_BRAIN_SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_ID = 'owner';

const AUTHORITATIVE_SECTIONS = Object.freeze([
  'coreIdentity',
  'familyAndUpbringing',
  'educationAndCareer',
  'relationshipHistory',
  'emotionalAndHealthBoundaries',
  'investmentBackground',
  'travelMemories',
  'socialRelationships',
  'languageCapabilities',
  'financialAndAssets',
  'expressionMatrix',
  'localizedChatStyles',
  'disclosureRules',
  'forbiddenFabrications',
  'personaProfile',
  'replyStylePolicy'
]);

function createEmptyAuthoritativePersona() {
  return {
    coreIdentity: {},
    familyAndUpbringing: {},
    educationAndCareer: {},
    relationshipHistory: {},
    emotionalAndHealthBoundaries: {},
    investmentBackground: {},
    travelMemories: [],
    socialRelationships: [],
    languageCapabilities: {},
    financialAndAssets: {},
    expressionMatrix: {},
    localizedChatStyles: {},
    disclosureRules: {},
    forbiddenFabrications: [],
    personaProfile: {
      name: '',
      age: null,
      city: '',
      occupation: '',
      experiences: [],
      personality: [],
      relationshipViews: [],
      lifeStatus: '',
      interests: [],
      expressionHabits: [],
      replyStylePreferences: [],
      forbiddenExpressions: [],
      specialRelationshipSettings: {}
    },
    replyStylePolicy: {
      directions: {},
      intensity: 'natural',
      allowBoldInitiative: true,
      avoidMechanicalFlirting: true
    }
  };
}

function createEmptyLearnedPersona() {
  return {
    observations: [],
    preferences: {},
    interactionPatterns: {},
    confidenceByPath: {},
    sourceBindings: [],
    updatedAt: ''
  };
}

function createEmptyPersonaDocument(profileId = DEFAULT_PROFILE_ID) {
  return {
    schemaVersion: PERSONA_BRAIN_SCHEMA_VERSION,
    profileId: String(profileId || DEFAULT_PROFILE_ID),
    authoritative: createEmptyAuthoritativePersona(),
    learned: createEmptyLearnedPersona(),
    metadata: {
      title: '',
      locale: '',
      createdAt: '',
      updatedAt: ''
    }
  };
}

function ensurePersonaBrainSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS persona_brain_profiles (
      profile_id TEXT PRIMARY KEY,
      active_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS persona_brain_versions (
      profile_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parent_version INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL,
      operation TEXT NOT NULL,
      content_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      changed_paths_json TEXT NOT NULL DEFAULT '[]',
      change_reason TEXT NOT NULL,
      change_source TEXT NOT NULL DEFAULT 'user',
      rollback_of_version INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY(profile_id, version),
      FOREIGN KEY(profile_id) REFERENCES persona_brain_profiles(profile_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_persona_brain_versions_created
      ON persona_brain_versions(profile_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_brain_versions_hash
      ON persona_brain_versions(profile_id, content_sha256, version);

    CREATE TABLE IF NOT EXISTS persona_brain_change_log (
      change_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      from_version INTEGER NOT NULL DEFAULT 0,
      to_version INTEGER NOT NULL,
      operation TEXT NOT NULL,
      changed_paths_json TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(profile_id) REFERENCES persona_brain_profiles(profile_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_persona_brain_change_log_profile
      ON persona_brain_change_log(profile_id, to_version DESC);

    CREATE TABLE IF NOT EXISTS persona_brain_pending_changes (
      change_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      base_version INTEGER NOT NULL,
      patch_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'ai-suggestion',
      reason TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT NOT NULL DEFAULT 'ai',
      decided_by TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      decided_at TEXT NOT NULL DEFAULT '',
      applied_version INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(profile_id) REFERENCES persona_brain_profiles(profile_id) ON DELETE CASCADE,
      CHECK(state IN ('pending', 'approved', 'rejected'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_persona_brain_pending_profile
      ON persona_brain_pending_changes(profile_id, state, created_at DESC);

    CREATE TABLE IF NOT EXISTS persona_brain_scope_bindings (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT '',
      binding_version INTEGER NOT NULL DEFAULT 1,
      authoritative_patch_json TEXT NOT NULL DEFAULT '{}',
      style_overlay_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'active',
      temporary INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id),
      CHECK(scope_type IN ('global', 'contact', 'conversation')),
      CHECK(state IN ('active', 'disabled')),
      CHECK(temporary IN (0, 1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_persona_scope_profile
      ON persona_brain_scope_bindings(profile_id, state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS persona_brain_migration_runs (
      migration_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      source_fingerprint TEXT NOT NULL,
      from_schema_version INTEGER NOT NULL,
      to_schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      report_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_brain_migration_source
      ON persona_brain_migration_runs(profile_id, source_kind, source_fingerprint, to_schema_version)
      WHERE status='completed';
  `);
}

module.exports = {
  PERSONA_BRAIN_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  AUTHORITATIVE_SECTIONS,
  createEmptyAuthoritativePersona,
  createEmptyLearnedPersona,
  createEmptyPersonaDocument,
  ensurePersonaBrainSchema
};
