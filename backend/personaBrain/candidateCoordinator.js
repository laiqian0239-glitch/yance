'use strict';

function nowIso() { return new Date().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }

function createPersonaCandidateCoordinator({ store }) {
  if (!store?.db) throw new TypeError('store with .db is required');
  const db = store.db;
  const tableColumns = table => {
    try {
      const statement = db.prepare(`PRAGMA table_info(${table})`);
      if (typeof statement.all !== 'function') return new Set();
      return new Set(statement.all().map(row => row.name));
    } catch (_) {
      return new Set();
    }
  };
  const candidateColumns = tableColumns('ai_reply_candidates');
  const outboxColumns = tableColumns('ai_reply_outbox');
  const candidateHasProfile = candidateColumns.has('persona_profile_id');
  const outboxHasProfile = outboxColumns.has('persona_profile_id');
  const candidateHasVersion = candidateColumns.has('persona_version_id');
  const outboxHasVersion = outboxColumns.has('persona_version_id');

  function invalidateForPersonaVersion(profileId, newVersion) {
    const normalizedProfileId = clean(profileId) || 'owner';
    const revision = Number(newVersion) || 0;
    if (normalizedProfileId !== 'owner' && !candidateHasProfile && !outboxHasProfile) {
      return {
        invalidatedCandidates: 0,
        invalidatedOutbox: 0,
        profileId: normalizedProfileId,
        newPersonaVersion: revision,
        at: null
      };
    }
    const at = nowIso();
    const candidates = candidateHasProfile
      ? db.prepare(`
          UPDATE ai_reply_candidates
          SET state='reverify_required', updated_at=?
          WHERE persona_profile_id=? AND persona_version_id < ?
            AND state NOT IN ('approved','sent','invalidated','rejected')
        `).run(at, normalizedProfileId, revision)
      : normalizedProfileId === 'owner' && candidateHasVersion
        ? db.prepare(`
            UPDATE ai_reply_candidates
            SET state='reverify_required', updated_at=?
            WHERE persona_version_id < ?
              AND state NOT IN ('approved','sent','invalidated','rejected')
          `).run(at, revision)
      : normalizedProfileId === 'owner'
        ? db.prepare(`
            UPDATE ai_reply_candidates
            SET state='reverify_required', updated_at=?
            WHERE state NOT IN ('approved','sent','invalidated','rejected')
          `).run(at)
        : { changes: 0 };
    const outbox = outboxHasProfile
      ? db.prepare(`
          UPDATE ai_reply_outbox
          SET state='reverify_required', updated_at=?
          WHERE persona_profile_id=? AND persona_version_id < ?
            AND state NOT IN ('approved','sent','queued','failed','invalidated')
        `).run(at, normalizedProfileId, revision)
      : normalizedProfileId === 'owner' && outboxHasVersion
        ? db.prepare(`
            UPDATE ai_reply_outbox
            SET state='reverify_required', updated_at=?
            WHERE persona_version_id < ?
              AND state NOT IN ('approved','sent','queued','failed','invalidated')
          `).run(at, revision)
      : normalizedProfileId === 'owner'
        ? db.prepare(`
            UPDATE ai_reply_outbox
            SET state='reverify_required', updated_at=?
            WHERE state NOT IN ('approved','sent','queued','failed','invalidated')
          `).run(at)
        : { changes: 0 };
    return {
      invalidatedCandidates: Number(candidates.changes || 0),
      invalidatedOutbox: Number(outbox.changes || 0),
      profileId: normalizedProfileId,
      newPersonaVersion: revision,
      at
    };
  }

  function invalidateForScope(scopeType, scopeId) {
    const type = clean(scopeType);
    const id = clean(scopeId);
    if (!['global', 'contact', 'conversation'].includes(type) || !id) {
      return { invalidatedCandidates: 0, invalidatedOutbox: 0, scopeType: type, scopeId: id, at: null };
    }
    const at = nowIso();
    let candidateResult;
    let outboxResult;
    if (type === 'global') {
      candidateResult = db.prepare(`
        UPDATE ai_reply_candidates SET state='reverify_required', updated_at=?
        WHERE state NOT IN ('approved','sent','invalidated','rejected')
      `).run(at);
      outboxResult = db.prepare(`
        UPDATE ai_reply_outbox SET state='reverify_required', updated_at=?
        WHERE state NOT IN ('approved','sent','queued','failed','invalidated')
      `).run(at);
    } else {
      const column = type === 'contact' ? 'contact_id' : 'conversation_id';
      candidateResult = db.prepare(`
        UPDATE ai_reply_candidates SET state='reverify_required', updated_at=?
        WHERE ${column}=? AND state NOT IN ('approved','sent','invalidated','rejected')
      `).run(at, id);
      outboxResult = db.prepare(`
        UPDATE ai_reply_outbox SET state='reverify_required', updated_at=?
        WHERE ${column}=? AND state NOT IN ('approved','sent','queued','failed','invalidated')
      `).run(at, id);
    }
    return {
      invalidatedCandidates: Number(candidateResult.changes || 0),
      invalidatedOutbox: Number(outboxResult.changes || 0),
      scopeType: type,
      scopeId: id,
      at
    };
  }

  function countReverifyRequired(profileId = '') {
    const normalized = clean(profileId);
    if (normalized && normalized !== 'owner' && (!candidateHasProfile || !outboxHasProfile)) {
      return { candidates: 0, outbox: 0, total: 0 };
    }
    const candidateSql = normalized && candidateHasProfile
      ? `SELECT COUNT(*) c FROM ai_reply_candidates WHERE state='reverify_required' AND persona_profile_id=?`
      : `SELECT COUNT(*) c FROM ai_reply_candidates WHERE state='reverify_required'`;
    const outboxSql = normalized && outboxHasProfile
      ? `SELECT COUNT(*) c FROM ai_reply_outbox WHERE state='reverify_required' AND persona_profile_id=?`
      : `SELECT COUNT(*) c FROM ai_reply_outbox WHERE state='reverify_required'`;
    const candidates = Number((normalized && candidateHasProfile ? db.prepare(candidateSql).get(normalized) : db.prepare(candidateSql).get())?.c || 0);
    const outbox = Number((normalized && outboxHasProfile ? db.prepare(outboxSql).get(normalized) : db.prepare(outboxSql).get())?.c || 0);
    return { candidates, outbox, total: candidates + outbox };
  }

  return { invalidateForPersonaVersion, invalidateForScope, countReverifyRequired };
}

module.exports = { createPersonaCandidateCoordinator };
