'use strict';

/**
 * AC-004 — 关系轨迹关键节点仓库（SQLite，生产接线层）
 *
 * 本模块是稳定契约 relationshipKeyNodeService 的"真实存储后端"。直接操作
 * node:sqlite 的 DatabaseSync，把"关键节点"写入关系轨迹权威表
 * relationship_timeline_events，并满足 P0-B 计划对 AC-004 的要求：
 *
 *   - 区分 fact / inference（node_kind 列）
 *   - 写入关系轨迹权威（relationship_timeline_events）
 *   - 返回版本（updated_at）和事件（由契约层 emit）
 *   - 失败恢复旧投影（事务 ROLLBACK，无部分写入）
 *
 * 事务语义（与 AC-003 一致）：BEGIN IMMEDIATE → fn → COMMIT；异常则 ROLLBACK。
 *
 * 扩展 schema：在 relationship_timeline_events 上增量加 4 列（幂等，已存在则跳过）：
 *   is_key_node INTEGER NOT NULL DEFAULT 0
 *   node_kind    TEXT    NOT NULL DEFAULT 'inference'   -- fact | inference
 *   marked_by    TEXT    NOT NULL DEFAULT ''
 *   marked_at    TEXT    NOT NULL DEFAULT ''
 */

const { DatabaseSync } = require('node:sqlite');

function nowIso() { return new Date().toISOString(); }
function parseJson(v, f = null) {
  try { return v == null || v === '' ? f : JSON.parse(v); } catch (_) { return f; }
}

class RelationshipKeyNodeRepository {
  constructor({ db, now } = {}) {
    if (!db) throw new Error('RelationshipKeyNodeRepository requires a node:sqlite DatabaseSync (db)');
    this.db = db;
    this.now = typeof now === 'function' ? now : nowIso;
    this.ensureSchema();
  }

  /** 增量扩展 relationship_timeline_events（幂等）。调用方需保证该表已存在。 */
  ensureSchema() {
    const hasColumn = (col) =>
      this.db.prepare("PRAGMA table_info(relationship_timeline_events)").all().some((r) => r.name === col);
    if (!hasColumn('is_key_node')) {
      this.db.exec('ALTER TABLE relationship_timeline_events ADD COLUMN is_key_node INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn('node_kind')) {
      this.db.exec("ALTER TABLE relationship_timeline_events ADD COLUMN node_kind TEXT NOT NULL DEFAULT 'inference'");
    }
    if (!hasColumn('marked_by')) {
      this.db.exec("ALTER TABLE relationship_timeline_events ADD COLUMN marked_by TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn('marked_at')) {
      this.db.exec("ALTER TABLE relationship_timeline_events ADD COLUMN marked_at TEXT NOT NULL DEFAULT ''");
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

  getEvent(eventId) {
    return this.db.prepare('SELECT * FROM relationship_timeline_events WHERE event_id=?').get(eventId) || null;
  }

  /** 标记一个已存在的关系轨迹事件为关键节点（可携带 fact/inference 区分）。 */
  markExistingEvent(eventId, { nodeKind, markedBy, markedAt, status }) {
    const atIso = new Date(this.now()).toISOString();
    this.db.prepare(
      "UPDATE relationship_timeline_events SET is_key_node=1, node_kind=?, marked_by=?, marked_at=?, status=?, updated_at=? WHERE event_id=?"
    ).run(nodeKind, markedBy, markedAt, status || 'confirmed', atIso, eventId);
  }

  /** 新建一条用户/引擎标记的关键节点事件（关系轨迹权威的新行）。 */
  insertKeyNode(rec) {
    const at = new Date(this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO relationship_timeline_events(
        event_id, contact_id, conversation_id, event_type,
        started_at, confirmed_at,
        before_json, after_json, interpretation,
        evidence_message_ids_json, source_signal_ids_json,
        confidence, status, engine_version,
        created_at, updated_at,
        is_key_node, node_kind, marked_by, marked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '1.0', ?, ?, 1, ?, ?, ?)
    `).run(
      rec.eventId,
      rec.contactId,
      rec.conversationId || '',
      rec.eventType || 'key_node_manual',
      at, at,
      JSON.stringify(rec.beforeJson || {}),
      JSON.stringify(rec.afterJson || {}),
      rec.summary || '',
      JSON.stringify(rec.evidenceMessageIds || []),
      '[]',
      rec.confidence != null ? rec.confidence : 1.0,
      at, at,
      rec.kind,
      rec.markedBy || 'user',
      at
    );
  }

  /** 取消关键节点标记（保留 node_kind / status 作为历史，仅清 is_key_node / marked_at）。 */
  unmarkEvent(eventId, { markedAt } = {}) {
    const atIso = new Date(this.now()).toISOString();
    this.db.prepare(
      "UPDATE relationship_timeline_events SET is_key_node=0, marked_at=?, updated_at=? WHERE event_id=?"
    ).run(markedAt || '', atIso, eventId);
  }

  listKeyNodes(contactId, { nodeKind } = {}) {
    if (nodeKind) {
      return this.db.prepare(
        "SELECT * FROM relationship_timeline_events WHERE contact_id=? AND is_key_node=1 AND node_kind=? ORDER BY confirmed_at DESC"
      ).all(contactId, nodeKind);
    }
    return this.db.prepare(
      "SELECT * FROM relationship_timeline_events WHERE contact_id=? AND is_key_node=1 ORDER BY confirmed_at DESC"
    ).all(contactId);
  }

  /** Graphiti owns temporal relationship inference/provenance; Yance preserves epistemic classification separately. */
  projectGraphitiFacts({ contactId, conversationId, facts } = {}) {
    const rows = Array.isArray(facts) ? facts : [];
    const at = new Date(this.now()).toISOString();
    const statement = this.db.prepare(`
      INSERT INTO relationship_timeline_events(
        event_id, contact_id, conversation_id, event_type,
        started_at, confirmed_at, before_json, after_json, interpretation,
        evidence_message_ids_json, source_signal_ids_json, confidence, status, engine_version,
        created_at, updated_at, is_key_node, node_kind, marked_by, marked_at
      ) VALUES (?, ?, ?, 'graphiti_inference', ?, ?, '{}', ?, ?, '[]', ?, 0.0, ?, 'graphiti:v0.29.3', ?, ?, 0, 'inference', '', '')
      ON CONFLICT(event_id) DO UPDATE SET
        contact_id=excluded.contact_id,
        conversation_id=excluded.conversation_id,
        event_type=excluded.event_type,
        started_at=excluded.started_at,
        confirmed_at=excluded.confirmed_at,
        after_json=excluded.after_json,
        interpretation=excluded.interpretation,
        source_signal_ids_json=excluded.source_signal_ids_json,
        confidence=excluded.confidence,
        status=CASE
          WHEN relationship_timeline_events.marked_by='user' THEN relationship_timeline_events.status
          ELSE excluded.status
        END,
        engine_version=excluded.engine_version,
        updated_at=excluded.updated_at,
        node_kind=CASE
          WHEN relationship_timeline_events.marked_by='user' THEN relationship_timeline_events.node_kind
          ELSE 'inference'
        END
    `);
    let applied = 0;
    for (const fact of rows) {
      const validAt = fact.validAt || fact.referenceTime || fact.createdAt || at;
      const confirmedAt = fact.createdAt || fact.referenceTime || validAt || at;
      const status = fact.invalidAt ? 'invalidated' : 'inferred';
      const afterJson = JSON.stringify({
        graphitiFactId: fact.factId,
        graphitiGroupId: fact.groupId,
        graphitiEpisodeUuid: fact.episodeUuid,
        sourceEpistemicStatus: 'ai_inference',
        confidenceStatus: 'unscored',
        confidenceSource: null,
        validAt: fact.validAt || null,
        invalidAt: fact.invalidAt || null,
        referenceTime: fact.referenceTime || null
      });
      statement.run(
        `graphiti:${fact.factId}`,
        contactId,
        conversationId || '',
        validAt,
        confirmedAt,
        afterJson,
        fact.fact || fact.name || 'Graphiti relationship fact',
        JSON.stringify([`graphiti:${fact.episodeUuid}`]),
        status,
        at,
        at
      );
      applied += 1;
    }
    return { applied, unchanged: 0 };
  }

  /** 仅当该事件确为关键节点时返回，否则 null。 */
  getKeyNode(eventId) {
    return this.db.prepare(
      "SELECT * FROM relationship_timeline_events WHERE event_id=? AND is_key_node=1"
    ).get(eventId) || null;
  }
}

module.exports = { RelationshipKeyNodeRepository };
