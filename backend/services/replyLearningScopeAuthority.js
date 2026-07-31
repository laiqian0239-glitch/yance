'use strict';

const { getStore } = require('../repositories/storeProvider');
const { inferFeedbackSignals, applySignals } = require('../store/social/replyFeedbackLearningEngine');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')); } catch (_) { return fallback; }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlatform(value) {
  const platform = clean(value).toLowerCase();
  return ['whatsapp', 'telegram', 'facebook'].includes(platform) ? platform : '';
}

function platformScopeId(platformValue, sourceAccountIdValue) {
  const platform = normalizePlatform(platformValue);
  const sourceAccountId = clean(sourceAccountIdValue);
  if (!platform) return '';
  return `${platform}:${sourceAccountId || 'unbound'}`;
}

function ensureSchema(store = getStore()) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS ai_reply_learning_scopes (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      profile_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id),
      CHECK(scope_type IN ('platform', 'global'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ai_reply_learning_scope_versions (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      profile_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT 'feedback-learning',
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id, version),
      CHECK(scope_type IN ('platform', 'global'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_reply_learning_scope_versions
      ON ai_reply_learning_scope_versions(scope_type, scope_id, version DESC);
  `);
  return store;
}

function read(scopeType, scopeId, store = getStore()) {
  ensureSchema(store);
  const type = clean(scopeType);
  const id = clean(scopeId);
  if (!type || !id) return { scopeType: type, scopeId: id, profile: {}, version: 0, updatedAt: '' };
  const row = store.db.prepare(`
    SELECT profile_json AS profileJson, version, updated_at AS updatedAt
    FROM ai_reply_learning_scopes WHERE scope_type=? AND scope_id=?
  `).get(type, id);
  return {
    scopeType: type,
    scopeId: id,
    profile: parseJson(row?.profileJson, {}) || {},
    version: Number(row?.version || 0),
    updatedAt: clean(row?.updatedAt)
  };
}

function write(scopeType, scopeId, profile, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const type = clean(scopeType);
  const id = clean(scopeId);
  if (!['platform', 'global'].includes(type) || !id) return read(type, id, store);
  const current = read(type, id, store);
  const version = current.version + 1;
  const updatedAt = clean(options.updatedAt) || nowIso();
  const profileJson = JSON.stringify({ ...object(profile), version, updatedAt });
  store.transaction(() => {
    store.db.prepare(`
      INSERT INTO ai_reply_learning_scopes(scope_type, scope_id, profile_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        profile_json=excluded.profile_json,
        version=excluded.version,
        updated_at=excluded.updated_at
    `).run(type, id, profileJson, version, updatedAt);
    store.db.prepare(`
      INSERT OR REPLACE INTO ai_reply_learning_scope_versions(
        scope_type, scope_id, version, profile_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, id, version, profileJson, clean(options.reason) || 'feedback-learning', updatedAt);
  });
  return { scopeType: type, scopeId: id, profile: parseJson(profileJson, {}), version, updatedAt };
}


function listVersions(scopeType, scopeId, options = {}, store = getStore()) {
  ensureSchema(store);
  const type = clean(scopeType);
  const id = clean(scopeId);
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  if (!['platform', 'global'].includes(type) || !id) return [];
  return store.db.prepare(`
    SELECT scope_type AS scopeType, scope_id AS scopeId, version,
           profile_json AS profileJson, reason, created_at AS createdAt
    FROM ai_reply_learning_scope_versions
    WHERE scope_type=? AND scope_id=?
    ORDER BY version DESC
    LIMIT ?
  `).all(type, id, limit).map(row => ({
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    version: Number(row.version || 0),
    profile: parseJson(row.profileJson, {}) || {},
    reason: clean(row.reason),
    createdAt: clean(row.createdAt)
  }));
}

function getVersion(scopeType, scopeId, version, store = getStore()) {
  ensureSchema(store);
  const type = clean(scopeType);
  const id = clean(scopeId);
  if (!['platform', 'global'].includes(type) || !id) return null;
  const row = store.db.prepare(`
    SELECT scope_type AS scopeType, scope_id AS scopeId, version,
           profile_json AS profileJson, reason, created_at AS createdAt
    FROM ai_reply_learning_scope_versions
    WHERE scope_type=? AND scope_id=? AND version=?
  `).get(type, id, Number(version));
  if (!row) return null;
  return {
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    version: Number(row.version || 0),
    profile: parseJson(row.profileJson, {}) || {},
    reason: clean(row.reason),
    createdAt: clean(row.createdAt)
  };
}

function mutatePreference(scopeType, scopeId, key, action, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const type = clean(scopeType);
  const id = clean(scopeId);
  const preferenceKey = clean(key);
  const operation = clean(action).toLowerCase();
  if (!['platform', 'global'].includes(type) || !id || !preferenceKey) {
    const error = new Error('学习范围或偏好键无效');
    error.code = 'LEARNING_SCOPE_PREFERENCE_INVALID';
    throw error;
  }
  if (!['enable', 'disable', 'delete'].includes(operation)) {
    const error = new Error('不支持的学习偏好操作');
    error.code = 'LEARNING_SCOPE_ACTION_INVALID';
    throw error;
  }
  const current = read(type, id, store);
  const profile = JSON.parse(JSON.stringify(object(current.profile)));
  profile.effective = object(profile.effective);
  const existing = object(profile.effective[preferenceKey]);
  if (operation !== 'delete' && !clean(existing.value)) {
    const error = new Error('指定学习偏好不存在');
    error.code = 'LEARNING_PREFERENCE_NOT_FOUND';
    throw error;
  }
  const timestamp = clean(options.updatedAt) || nowIso();
  if (operation === 'delete') {
    delete profile.effective[preferenceKey];
    if (object(profile.counts)[preferenceKey]) {
      profile.counts = { ...object(profile.counts) };
      delete profile.counts[preferenceKey];
    }
    profile.evidence = (Array.isArray(profile.evidence) ? profile.evidence : []).map(row => ({
      ...row,
      signals: (Array.isArray(row?.signals) ? row.signals : []).filter(signal => clean(signal?.key) !== preferenceKey)
    })).filter(row => (row.signals || []).length || clean(row?.eventType) === 'sent');
  } else {
    profile.effective[preferenceKey] = {
      ...existing,
      disabled: operation === 'disable',
      disabledAt: operation === 'disable' ? timestamp : '',
      disabledBy: operation === 'disable' ? clean(options.actor) || 'user' : ''
    };
  }
  return write(type, id, profile, {
    store,
    updatedAt: timestamp,
    reason: `preference:${operation}:${preferenceKey}:${clean(options.actor) || 'user'}`
  });
}

function restoreVersion(scopeType, scopeId, version, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const row = getVersion(scopeType, scopeId, version, store);
  if (!row) {
    const error = new Error('指定学习版本不存在');
    error.code = 'LEARNING_SCOPE_VERSION_NOT_FOUND';
    throw error;
  }
  return write(scopeType, scopeId, row.profile, {
    store,
    updatedAt: clean(options.updatedAt) || nowIso(),
    reason: `restore:${Number(version)}:${clean(options.actor) || 'user'}`
  });
}

function evidenceSupport(profile = {}, key, value) {
  const contacts = new Set();
  const platforms = new Set();
  for (const row of Array.isArray(profile.evidence) ? profile.evidence : []) {
    const hit = (Array.isArray(row.signals) ? row.signals : [])
      .some(signal => clean(signal.key) === key && clean(signal.value) === value);
    if (!hit) continue;
    if (clean(row.contactId)) contacts.add(clean(row.contactId));
    if (normalizePlatform(row.platform)) platforms.add(normalizePlatform(row.platform));
  }
  return { contactCount: contacts.size, platformCount: platforms.size };
}

function enforceIsolation(profileInput = {}, scopeType) {
  const profile = JSON.parse(JSON.stringify(object(profileInput)));
  profile.recentExamples = [];
  const effective = object(profile.effective);
  for (const [key, preference] of Object.entries(effective)) {
    const support = evidenceSupport(profile, key, clean(preference?.value));
    const allowed = scopeType === 'platform'
      ? support.contactCount >= 2
      : support.contactCount >= 3 && support.platformCount >= 2;
    if (!allowed) delete effective[key];
  }
  profile.effective = effective;
  return profile;
}

function hasEvidence(profile = {}, evidenceId = '') {
  const id = clean(evidenceId);
  return Boolean(id) && (Array.isArray(profile.evidence) ? profile.evidence : []).some(row => clean(row?.id) === id);
}

function recordFeedback(input = {}, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const platform = normalizePlatform(input.platform);
  const sourceAccountId = clean(input.sourceAccountId);
  const platformId = platformScopeId(platform, sourceAccountId);
  const signals = Array.isArray(input.signals) && input.signals.length
    ? input.signals
    : inferFeedbackSignals(input);
  if (!signals.length) return { changed: false, platform: null, global: null };
  const evidence = {
    id: clean(input.evidenceId || input.id),
    eventType: clean(input.eventType),
    candidateId: clean(input.candidateId),
    outboxId: clean(input.outboxId),
    contactId: clean(input.contactId),
    conversationId: clean(input.conversationId),
    platform,
    sourceAccountId,
    platformContactIdentity: clean(input.platformContactIdentity),
    canonicalContactId: clean(input.canonicalContactId),
    targetLanguage: clean(input.targetLanguage),
    translatedZh: '',
    modelId: clean(input.modelId),
    replyTask: clean(input.replyTask),
    styleVariant: clean(input.styleVariant),
    finalText: '',
    source: clean(input.source)
  };
  const timestamp = clean(input.observedAt) || nowIso();
  let platformResult = null;
  let globalResult = null;
  if (platformId) {
    const current = read('platform', platformId, store);
    const applied = hasEvidence(current.profile, evidence.id)
      ? { changed: false, profile: current.profile }
      : applySignals(current.profile, signals, evidence, { now: timestamp, threshold: 3 });
    if (applied.changed) {
      platformResult = write('platform', platformId, enforceIsolation(applied.profile, 'platform'), {
        store,
        updatedAt: timestamp,
        reason: `feedback:${clean(input.eventType) || 'event'}`
      });
    }
  }
  const currentGlobal = read('global', 'owner', store);
  const appliedGlobal = hasEvidence(currentGlobal.profile, evidence.id)
    ? { changed: false, profile: currentGlobal.profile }
    : applySignals(currentGlobal.profile, signals, evidence, { now: timestamp, threshold: 4 });
  if (appliedGlobal.changed) {
    globalResult = write('global', 'owner', enforceIsolation(appliedGlobal.profile, 'global'), {
      store,
      updatedAt: timestamp,
      reason: `feedback:${clean(input.eventType) || 'event'}`
    });
  }
  return { changed: Boolean(platformResult || globalResult), platform: platformResult, global: globalResult };
}

function mergeEffective(globalProfile = {}, platformProfile = {}, contactProfile = {}) {
  const effective = {};
  const provenance = {};
  for (const [scope, profile] of [
    ['global', globalProfile],
    ['platform', platformProfile],
    ['contact', contactProfile]
  ]) {
    for (const [key, value] of Object.entries(object(profile.effective))) {
      if (!clean(value?.value) || value?.disabled === true) continue;
      effective[key] = { ...value, scope };
      provenance[key] = {
        scope,
        value: clean(value.value),
        confidence: Number(value.confidence || 0),
        evidenceCount: Number(value.evidenceCount || 0),
        updatedAt: clean(value.updatedAt)
      };
    }
  }
  return { effective, provenance };
}

function layered(input = {}, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const contactProfile = object(input.contactProfile);
  const platform = normalizePlatform(input.platform);
  const sourceAccountId = clean(input.sourceAccountId);
  const platformId = platformScopeId(platform, sourceAccountId);
  const platformProfile = platformId ? read('platform', platformId, store).profile : {};
  const globalProfile = read('global', 'owner', store).profile;
  const merged = mergeEffective(globalProfile, platformProfile, contactProfile);
  return {
    version: Math.max(
      Number(contactProfile.version || 0),
      Number(platformProfile.version || 0),
      Number(globalProfile.version || 0)
    ),
    effective: merged.effective,
    provenance: merged.provenance,
    recentExamples: Array.isArray(contactProfile.recentExamples) ? contactProfile.recentExamples.slice(-4) : [],
    evidenceCount: Number((contactProfile.evidence || []).length),
    layers: {
      contact: { scope: 'contact', id: clean(input.contactId), profile: contactProfile },
      platform: { scope: 'platform', id: platformId, platform, sourceAccountId, profile: platformProfile },
      global: { scope: 'global', id: 'owner', profile: globalProfile }
    },
    updatedAt: [contactProfile.updatedAt, platformProfile.updatedAt, globalProfile.updatedAt].map(clean).sort().at(-1) || '',
    engineVersion: clean(contactProfile.engineVersion || platformProfile.engineVersion || globalProfile.engineVersion)
  };
}

function rebuildProfileFromEvidence(evidenceRows = [], scopeType, timestamp = nowIso()) {
  let profile = {};
  for (const row of evidenceRows) {
    const signals = Array.isArray(row?.signals) ? row.signals : [];
    const applied = applySignals(profile, signals, { ...row, finalText: '' }, {
      now: clean(row?.createdAt) || timestamp,
      threshold: scopeType === 'platform' ? 3 : 4
    });
    profile = applied.profile;
  }
  return enforceIsolation(profile, scopeType);
}

function forgetContact(contactIdValue, options = {}) {
  const store = ensureSchema(options.store || getStore());
  const contactId = clean(contactIdValue);
  if (!contactId) return { changed: false, scopes: [] };
  const rows = store.db.prepare(`
    SELECT scope_type AS scopeType, scope_id AS scopeId,
           profile_json AS profileJson, version, updated_at AS updatedAt
    FROM ai_reply_learning_scopes
    WHERE scope_type IN ('platform','global')
  `).all();
  const timestamp = clean(options.updatedAt) || nowIso();
  const changedScopes = [];
  store.transaction(() => {
    for (const row of rows) {
      const profile = parseJson(row.profileJson, {}) || {};
      const evidence = Array.isArray(profile.evidence) ? profile.evidence : [];
      const remaining = evidence.filter(item => clean(item?.contactId) !== contactId);
      if (remaining.length === evidence.length) continue;
      const rebuilt = rebuildProfileFromEvidence(remaining, row.scopeType, timestamp);
      const version = Number(row.version || 0) + 1;
      const profileJson = JSON.stringify({ ...rebuilt, version, updatedAt: timestamp });
      store.db.prepare(`
        UPDATE ai_reply_learning_scopes
        SET profile_json=?, version=?, updated_at=?
        WHERE scope_type=? AND scope_id=?
      `).run(profileJson, version, timestamp, row.scopeType, row.scopeId);
      store.db.prepare(`
        DELETE FROM ai_reply_learning_scope_versions
        WHERE scope_type=? AND scope_id=?
      `).run(row.scopeType, row.scopeId);
      store.db.prepare(`
        INSERT INTO ai_reply_learning_scope_versions(
          scope_type, scope_id, version, profile_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(row.scopeType, row.scopeId, version, profileJson, `forget-contact:${contactId}`, timestamp);
      changedScopes.push({ scopeType: row.scopeType, scopeId: row.scopeId, version });
    }
  });
  return { changed: changedScopes.length > 0, contactId, scopes: changedScopes };
}

module.exports = {
  ensureSchema,
  read,
  write,
  recordFeedback,
  layered,
  mergeEffective,
  enforceIsolation,
  normalizePlatform,
  platformScopeId,
  hasEvidence,
  listVersions,
  getVersion,
  mutatePreference,
  restoreVersion,
  forgetContact,
  rebuildProfileFromEvidence
};
