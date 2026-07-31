'use strict';

/**
 * AC-003 — 联系人合并仓库（SQLite 8 步事务法，生产接线层）
 *
 * 本模块是稳定契约 contactMergeService 的"真实存储后端"。它直接操作 node:sqlite
 * 的 DatabaseSync，实现 AC-003 要求的 8 步事务与持久撤销：
 *
 *   step 1  校验 + 读取两侧联系人（乐观版本 = updated_at）
 *   step 2  开启事务 BEGIN IMMEDIATE
 *   step 3  事务内重读 + CAS（survivor 版本未变才继续）
 *   step 4  标记被合并联系人：merged_into_id = survivor，tombstoned_at = 现在（不删除，保留可撤销）
 *   step 5  重定向所有 contact_id 引用（对话/画像/关系信号/AI 任务…）到 survivor
 *   step 6  写入持久撤销日志 contact_merge_undo_journal（含精确变更清单，可回放）
 *   step 7  写入不可变审计 receipt（存入日志行 audit_json，与事务同原子）
 *   step 8  COMMIT；契约层在提交成功后 emit contact:merged / contact:unmerged
 *
 * 任何一步失败 → transaction() 自动 ROLLBACK，无部分写入、无事件、无审计。
 *
 * 引用重定向策略：
 *  - REPOINT_TABLES：contact_id 非主键 → 直接 UPDATE contact_id = survivor（安全）。
 *  - PK_TABLES：contact_id 即主键 → 仅当 survivor 无该行时重定向；否则合并行的数据
 *    被 survivor 吸收，删除被合并行（原行完整存入撤销日志，撤销时回插）。
 */

const { DatabaseSync } = require('node:sqlite');

function nowIso() { return new Date().toISOString(); }
function parseJson(v, f = null) {
  try { return v == null || v === '' ? f : JSON.parse(v); } catch (_) { return f; }
}

function rewriteContactIdentity(value, fromId, toId, key = '') {
  if (Array.isArray(value)) return value.map(item => rewriteContactIdentity(item, fromId, toId));
  if (!value || typeof value !== 'object') {
    if (['contactId', 'canonicalContactId'].includes(key) && String(value || '') === fromId) return toId;
    return value;
  }
  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = rewriteContactIdentity(childValue, fromId, toId, childKey);
  }
  return output;
}

// [table, pkColumn] — contact_id 不是主键，可安全重定向
const REPOINT_TABLES = [
  ['r32_conversations', 'session_key'],
  ['relationship_state_signals', 'signal_id'],
  ['relationship_timeline_events', 'event_id'],
  ['ai_analysis_runs', 'id'],
  ['social_inference_corrections', 'id'],
  ['ai_context_snapshots', 'id'],
  ['ai_reply_tasks', 'task_id'],
  ['ai_reply_candidates', 'candidate_id'],
  ['ai_reply_outbox', 'id'],
  ['ai_reply_feedback_events', 'id'],
];

// contact_id 即主键 → 行级合并处理
const PK_TABLES = [
  'interaction_policies',
  'customer_social_state',
  'customer_profiles',
  'relationship_insights',
];

function mergeFeedbackProfileJson(survivorInput, mergedInput, survivorId, mergedId, atIso) {
  const survivor = survivorInput && typeof survivorInput === 'object' ? survivorInput : {};
  const merged = mergedInput && typeof mergedInput === 'object' ? mergedInput : {};
  const counts = {};
  for (const source of [survivor.counts, merged.counts]) {
    for (const [key, bucketInput] of Object.entries(source && typeof source === 'object' ? source : {})) {
      const bucket = counts[key] || {};
      for (const [value, statsInput] of Object.entries(bucketInput && typeof bucketInput === 'object' ? bucketInput : {})) {
        const stats = statsInput && typeof statsInput === 'object' ? statsInput : {};
        const current = bucket[value] || { count: 0, weight: 0, lastObservedAt: '' };
        current.count += Number(stats.count || 0);
        current.weight = Number((current.weight + Number(stats.weight || 0)).toFixed(4));
        if (String(stats.lastObservedAt || '') > String(current.lastObservedAt || '')) current.lastObservedAt = stats.lastObservedAt;
        bucket[value] = current;
      }
      counts[key] = bucket;
    }
  }
  const evidenceById = new Map();
  for (const rowInput of [...(Array.isArray(survivor.evidence) ? survivor.evidence : []), ...(Array.isArray(merged.evidence) ? merged.evidence : [])]) {
    const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : null;
    if (!row) continue;
    if (String(row.contactId || '') === mergedId) row.contactId = survivorId;
    const id = String(row.id || `${row.eventType || 'feedback'}:${row.candidateId || ''}:${row.createdAt || ''}`);
    evidenceById.set(id, row);
  }
  const evidence = [...evidenceById.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).slice(-200);
  const effective = {};
  const existingEffective = { ...(survivor.effective || {}), ...(merged.effective || {}) };
  for (const [key, bucket] of Object.entries(counts)) {
    const ranked = Object.entries(bucket).map(([value, stats]) => ({ value, count: Number(stats.count || 0), weight: Number(stats.weight || 0) }))
      .sort((a, b) => b.count - a.count || b.weight - a.weight || a.value.localeCompare(b.value));
    const winner = ranked[0], runnerUp = ranked[1];
    if (winner && winner.count >= 3 && (!runnerUp || winner.count > runnerUp.count || winner.weight >= runnerUp.weight + 0.75)) {
      effective[key] = {
        value: winner.value,
        confidence: Math.min(0.99, Number((0.45 + winner.count * 0.08 + Math.min(0.18, winner.weight * 0.02)).toFixed(3))),
        evidenceCount: winner.count,
        source: 'user-feedback',
        updatedAt: atIso
      };
    } else if (existingEffective[key]) {
      effective[key] = existingEffective[key];
    }
  }
  return {
    ...survivor,
    version: Math.max(Number(survivor.version || 0), Number(merged.version || 0)) + 1,
    counts,
    effective,
    evidence,
    updatedAt: atIso,
    engineVersion: String(survivor.engineVersion || merged.engineVersion || '1.0.0')
  };
}

class ContactMergeRepository {
  constructor({ db, now } = {}) {
    if (!db) throw new Error('ContactMergeRepository requires a node:sqlite DatabaseSync (db)');
    this.db = db;
    this.now = typeof now === 'function' ? now : nowIso;
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contact_merge_undo_journal (
        journal_id TEXT PRIMARY KEY,
        survivor_id TEXT NOT NULL,
        merged_id TEXT NOT NULL,
        survivor_version_before TEXT NOT NULL DEFAULT '',
        merged_version_before TEXT NOT NULL DEFAULT '',
        changes_json TEXT NOT NULL DEFAULT '[]',
        by TEXT NOT NULL DEFAULT 'unknown',
        at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'applied',
        audit_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_merge_journal_merged ON contact_merge_undo_journal(merged_id);
      CREATE INDEX IF NOT EXISTS idx_merge_journal_status ON contact_merge_undo_journal(status);
    `);
  }

  tableExists(name) {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  }

  tableColumns(name) {
    if (!this.tableExists(name)) return new Set();
    return new Set(this.db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
  }

  migrateFeedbackVersions(fromId, toId, atIso, changes) {
    if (!this.tableExists('ai_reply_feedback_profile_versions')) return;
    const sourceRows = this.db.prepare("SELECT * FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=? ORDER BY version,created_at").all(fromId);
    if (!sourceRows.length) return;
    let nextVersion = Number(this.db.prepare("SELECT MAX(version) AS version FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(toId)?.version || 0);
    const insertedVersions = [];
    for (const row of sourceRows) {
      nextVersion += 1;
      const profile = rewriteContactIdentity(parseJson(row.profile_json, {}) || {}, fromId, toId);
      this.db.prepare(`INSERT INTO ai_reply_feedback_profile_versions(
        scope_type,scope_id,version,profile_json,reason,created_at
      ) VALUES('contact',?,?,?,?,?)`).run(
        toId, nextVersion, JSON.stringify(profile),
        `contact-merge:${String(row.reason || 'source-version')}:${row.version}`,
        row.created_at || atIso
      );
      insertedVersions.push(nextVersion);
    }
    this.db.prepare("DELETE FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").run(fromId);
    changes.push({
      op: 'feedback-version-move',
      table: 'ai_reply_feedback_profile_versions',
      fromId, toId, sourceRows, insertedVersions
    });
  }

  rewriteLearningScopeEvidence(fromId, toId, atIso, changes) {
    for (const table of ['ai_reply_learning_scopes', 'ai_reply_learning_scope_versions']) {
      if (!this.tableExists(table)) continue;
      const rows = this.db.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const profile = parseJson(row.profile_json, {}) || {};
        const rewritten = rewriteContactIdentity(profile, fromId, toId);
        if (JSON.stringify(profile) === JSON.stringify(rewritten)) continue;
        const keyColumns = table === 'ai_reply_learning_scopes'
          ? ['scope_type', 'scope_id']
          : ['scope_type', 'scope_id', 'version'];
        const where = keyColumns.map(name => `${name}=?`).join(' AND ');
        const params = keyColumns.map(name => row[name]);
        const updatedAt = table === 'ai_reply_learning_scopes' ? atIso : row.created_at;
        this.db.prepare(`UPDATE ${table} SET profile_json=?${table === 'ai_reply_learning_scopes' ? ',updated_at=?' : ''} WHERE ${where}`)
          .run(JSON.stringify(rewritten), ...(table === 'ai_reply_learning_scopes' ? [updatedAt] : []), ...params);
        changes.push({ op: 'json-row-restore', table, keyColumns, row });
      }
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  getContactPlain(id) {
    return this.db.prepare(
      'SELECT id, display_name, account_id, platform, external_id, merged_into_id, tombstoned_at, payload_json, updated_at FROM contacts WHERE id=?'
    ).get(id) || null;
  }

  markMerged(mergedId, survivorId, atIso) {
    this.db.prepare(
      "UPDATE contacts SET merged_into_id=?, tombstoned_at=?, updated_at=? WHERE id=?"
    ).run(survivorId, atIso, atIso, mergedId);
  }

  bumpSurvivorVersion(survivorId, atIso) {
    this.db.prepare('UPDATE contacts SET updated_at=? WHERE id=?').run(atIso, survivorId);
  }

  /**
   * 把 fromId 的所有 contact_id 引用重定向到 toId。
   * 返回精确变更清单（用于持久撤销回放）。
   */
  redirectReferences(fromId, toId) {
    const changes = [];
    for (const [table, pk] of REPOINT_TABLES) {
      if (!this.tableExists(table) || !this.tableColumns(table).has('contact_id')) continue;
      const hasCanonical = table === 'ai_reply_feedback_events' && this.tableColumns(table).has('canonical_contact_id');
      const rows = this.db.prepare(`SELECT ${pk} AS pk${hasCanonical ? ', canonical_contact_id AS canonicalContactId' : ''} FROM ${table} WHERE contact_id=?`).all(fromId);
      if (rows.length) {
        this.db.prepare(`UPDATE ${table} SET contact_id=? WHERE contact_id=?`).run(toId, fromId);
        for (const r of rows) {
          changes.push({ op: 'repoint', table, pkCol: pk, id: r.pk });
          if (hasCanonical && String(r.canonicalContactId || '') === fromId) {
            this.db.prepare(`UPDATE ${table} SET canonical_contact_id=? WHERE ${pk}=?`).run(toId, r.pk);
            changes.push({ op: 'column-restore', table, pkCol: pk, id: r.pk, column: 'canonical_contact_id', value: r.canonicalContactId });
          }
        }
      }
    }
    for (const table of PK_TABLES) {
      const mergedRow = this.db.prepare(`SELECT * FROM ${table} WHERE contact_id=?`).get(fromId);
      if (!mergedRow) continue;
      const survivorRow = this.db.prepare(`SELECT 1 FROM ${table} WHERE contact_id=?`).get(toId);
      if (!survivorRow) {
        this.db.prepare(`UPDATE ${table} SET contact_id=? WHERE contact_id=?`).run(toId, fromId);
        changes.push({ op: 'repoint', table, pkCol: 'contact_id', id: toId });
      } else {
        // survivor 已拥有该行 → 被合并行数据被吸收，删除之（完整行存入撤销日志以便回插）
        this.db.prepare(`DELETE FROM ${table} WHERE contact_id=?`).run(fromId);
        changes.push({ op: 'reinsert', table, row: mergedRow });
      }
    }
    const mergedFeedback = this.db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(fromId);
    if (mergedFeedback) {
      const survivorFeedback = this.db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(toId);
      if (!survivorFeedback) {
        const profile = parseJson(mergedFeedback.profile_json, {});
        if (Array.isArray(profile.evidence)) profile.evidence = profile.evidence.map(row => row && row.contactId === fromId ? { ...row, contactId: toId } : row);
        this.db.prepare("UPDATE ai_reply_feedback_profiles SET scope_id=?, profile_json=?, version=version+1, updated_at=? WHERE scope_type='contact' AND scope_id=?")
          .run(toId, JSON.stringify(profile), this.now(), fromId);
        changes.push({ op: 'feedback-scope-repoint', table: 'ai_reply_feedback_profiles', fromId, toId, row: mergedFeedback });
      } else {
        const mergedProfile = mergeFeedbackProfileJson(
          parseJson(survivorFeedback.profile_json, {}),
          parseJson(mergedFeedback.profile_json, {}),
          toId,
          fromId,
          this.now()
        );
        this.db.prepare("UPDATE ai_reply_feedback_profiles SET profile_json=?, version=?, updated_at=? WHERE scope_type='contact' AND scope_id=?")
          .run(JSON.stringify(mergedProfile), Number(mergedProfile.version || 0), mergedProfile.updatedAt, toId);
        this.db.prepare("DELETE FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").run(fromId);
        changes.push({ op: 'feedback-profile-merge', table: 'ai_reply_feedback_profiles', survivorRow: survivorFeedback, mergedRow: mergedFeedback });
      }
    }
    this.migrateFeedbackVersions(fromId, toId, this.now(), changes);
    this.rewriteLearningScopeEvidence(fromId, toId, this.now(), changes);
    return changes;
  }

  insertUndoJournal(rec) {
    this.db.prepare(`
      INSERT INTO contact_merge_undo_journal(
        journal_id, survivor_id, merged_id, survivor_version_before, merged_version_before,
        changes_json, by, at, status, audit_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)
    `).run(
      rec.journalId,
      rec.survivorId,
      rec.mergedId,
      rec.survivorVersionBefore,
      rec.mergedVersionBefore,
      JSON.stringify(rec.changes),
      rec.by,
      rec.at,
      JSON.stringify(rec.audit || {}),
      this.now()
    );
  }

  getUndoJournal(journalId) {
    const row = this.db.prepare('SELECT * FROM contact_merge_undo_journal WHERE journal_id=?').get(journalId);
    if (!row) return null;
    return Object.assign({}, row, {
      changes: parseJson(row.changes_json, []),
      audit: parseJson(row.audit_json, {}),
    });
  }

  setJournalStatus(journalId, status, atIso) {
    this.db.prepare('UPDATE contact_merge_undo_journal SET status=?, at=? WHERE journal_id=?')
      .run(status, atIso || this.now(), journalId);
  }

  restoreMerged(mergedId, atIso) {
    this.db.prepare("UPDATE contacts SET merged_into_id='', tombstoned_at='', updated_at=? WHERE id=?")
      .run(atIso, mergedId);
  }

  /** 按变更清单精确回退引用（撤销） */
  redirectBack(changes, fromId, toId) {
    for (const c of changes) {
      if (c.op === 'repoint') {
        this.db.prepare(`UPDATE ${c.table} SET contact_id=? WHERE ${c.pkCol}=? AND contact_id=?`)
          .run(fromId, c.id, toId);
      } else if (c.op === 'reinsert') {
        const cols = Object.keys(c.row);
        const placeholders = cols.map(() => '?').join(',');
        this.db.prepare(`INSERT OR IGNORE INTO ${c.table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...cols.map((k) => c.row[k]));
      } else if (c.op === 'feedback-scope-repoint') {
        const row = c.row || {};
        this.db.prepare("DELETE FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").run(c.toId);
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        this.db.prepare(`INSERT OR REPLACE INTO ai_reply_feedback_profiles (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...cols.map(key => row[key]));
      } else if (c.op === 'feedback-profile-merge') {
        for (const row of [c.survivorRow, c.mergedRow]) {
          if (!row) continue;
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(',');
          this.db.prepare(`INSERT OR REPLACE INTO ai_reply_feedback_profiles (${cols.join(',')}) VALUES (${placeholders})`)
            .run(...cols.map(key => row[key]));
        }
      } else if (c.op === 'feedback-version-move') {
        for (const version of c.insertedVersions || []) {
          this.db.prepare("DELETE FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=? AND version=?")
            .run(c.toId, Number(version));
        }
        for (const row of c.sourceRows || []) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(',');
          this.db.prepare(`INSERT OR REPLACE INTO ai_reply_feedback_profile_versions (${cols.join(',')}) VALUES (${placeholders})`)
            .run(...cols.map(key => row[key]));
        }
      } else if (c.op === 'json-row-restore') {
        const row = c.row || {};
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        this.db.prepare(`INSERT OR REPLACE INTO ${c.table} (${cols.join(',')}) VALUES (${placeholders})`)
          .run(...cols.map(key => row[key]));
      } else if (c.op === 'column-restore') {
        this.db.prepare(`UPDATE ${c.table} SET ${c.column}=? WHERE ${c.pkCol}=?`).run(c.value, c.id);
      }
    }
  }
}

module.exports = { ContactMergeRepository, REPOINT_TABLES, PK_TABLES };
