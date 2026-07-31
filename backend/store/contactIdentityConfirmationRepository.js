'use strict';

/**
 * AC-002 仓储（集成层）—— 把联系人身份确认接到 R32 权威 contacts 表。
 *
 * 设计原则（与 P0-A/P0-B 一致）: 稳定契约 + 依赖注入缝 + 增量 schema。
 *  - 通过依赖注入的 node:sqlite DatabaseSync（生产来自 getR32Store().db）。
 *  - schema 采用 ADD COLUMN IF NOT EXISTS 增量扩展，幂等、对现有数据非破坏。
 *  - 乐观并发: updateContactIdentity 基于 identity_version 做 CAS；
 *    版本不符抛 STORE_VERSION_CONFLICT，权威身份保持原状（原子回滚）。
 *
 * 这是 AC-002 稳定契约（contactIdentityConfirmationService）缺省的持久层；
 * AC-002 提交时仅含服务 + mock 测试，本文件在集成层补全真实 SQLite 桥接。
 */

class ContactIdentityConfirmationRepository {
  constructor(deps) {
    const db = deps && deps.db;
    if (!db) throw new Error('ContactIdentityConfirmationRepository requires node:sqlite DatabaseSync (db)');
    this.db = db;
    this.ensureSchema();
  }

  ensureSchema() {
    const hasColumn = (col) =>
      this.db.prepare('PRAGMA table_info(contacts)').all().some((r) => r.name === col);
    if (!hasColumn('identity_confirmed')) {
      this.db.exec('ALTER TABLE contacts ADD COLUMN identity_confirmed INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn('identity_confirmed_at')) {
      this.db.exec("ALTER TABLE contacts ADD COLUMN identity_confirmed_at TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn('identity_confirmed_by')) {
      this.db.exec("ALTER TABLE contacts ADD COLUMN identity_confirmed_by TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn('identity_note')) {
      this.db.exec("ALTER TABLE contacts ADD COLUMN identity_note TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn('identity_version')) {
      this.db.exec('ALTER TABLE contacts ADD COLUMN identity_version INTEGER NOT NULL DEFAULT 0');
    }
  }

  _normalize(row) {
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      version: row.identity_version || 0,
      identityConfirmed: !!row.identity_confirmed,
      confirmedAt: row.identity_confirmed_at || null,
      confirmedBy: row.identity_confirmed_by || null,
      note: row.identity_note || null
    };
  }

  // 本应用联系人以 id 为权威主键（account_id 多为空），故按 id 解析；
  // accountId 作为契约透传参数（满足稳定契约的非空校验），不参与 WHERE。
  getContact(accountId, contactId) {
    const row = this.db.prepare('SELECT id, account_id, identity_confirmed, identity_confirmed_at, identity_confirmed_by, identity_note, identity_version FROM contacts WHERE id = ?').get(contactId);
    return this._normalize(row);
  }

  updateContactIdentity(accountId, contactId, patch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT identity_version FROM contacts WHERE id = ?').get(contactId);
      if (!current) {
        const e = new Error('contact not found');
        e.code = 'CONTACT_NOT_FOUND';
        throw e;
      }
      if (current.identity_version !== patch.version) {
        const e = new Error('contact identity version conflict');
        e.code = 'STORE_VERSION_CONFLICT';
        throw e;
      }
      const nextVersion = current.identity_version + 1;
      const confirmedAt = patch.confirmedAt == null
        ? ''
        : (typeof patch.confirmedAt === 'string' ? patch.confirmedAt : new Date(patch.confirmedAt).toISOString());
      const info = this.db.prepare(
        'UPDATE contacts SET identity_confirmed = ?, identity_confirmed_at = ?, identity_confirmed_by = ?, identity_note = ?, identity_version = ?, updated_at = ? WHERE id = ?'
      ).run(
        patch.identityConfirmed ? 1 : 0,
        confirmedAt,
        patch.confirmedBy || '',
        patch.note == null ? '' : String(patch.note),
        nextVersion,
        new Date(Date.now()).toISOString(),
        contactId
      );
      if (info.changes === 0) {
        const e = new Error('contact identity version conflict');
        e.code = 'STORE_VERSION_CONFLICT';
        throw e;
      }
      this.db.exec('COMMIT');
      return this.getContact(accountId, contactId);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = { ContactIdentityConfirmationRepository };
