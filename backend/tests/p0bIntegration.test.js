'use strict';

/**
 * P0-B 集成层测试（独立脚本）
 * 运行: node backend/tests/p0bIntegration.test.js
 *
 * 验证 身份确认 / 合并 / 关键节点 三个稳定契约已接到 R32 权威 SQLite：
 * 直接读回底层 contacts / relationship_timeline_events 表，证明写入是【持久、权威】的，
 * 不再依赖前端 localStorage。使用与线上一致的 R32SqliteStore 临时库。
 */

const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { cleanupSqliteTestStore } = require('../../tests/test-support/windows-cleanup');
const { ContactIdentityConfirmationRepository } = require('../store/contactIdentityConfirmationRepository');
const { createContactIdentityConfirmationService } = require('../services/contactIdentityConfirmationService');
const { ContactMergeRepository } = require('../store/contactMergeRepository');
const { createContactMergeService } = require('../services/contactMergeService');
const { RelationshipKeyNodeRepository } = require('../store/relationshipKeyNodeRepository');
const { createRelationshipKeyNodeService } = require('../services/relationshipKeyNodeService');

// ---------- 极简测试框架 ----------
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg || 'expectation failed'); }
function eq(a, b, msg) { expect(a === b, msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ---------- 测试装置 ----------
function makeFixture() {
  const dbPath = path.join(os.tmpdir(), `p0b_int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);
  const store = new R32SqliteStore({ dbPath });
  const db = store.db;
  function insertContact(id, name) {
    db.prepare("INSERT INTO contacts (id, account_id, display_name, created_at, updated_at) VALUES (?, '', ?, ?, ?)")
      .run(id, name, new Date(0).toISOString(), new Date(0).toISOString());
  }
  return { store, db, insertContact, dbPath };
}

function buildIdentity(db) {
  return createContactIdentityConfirmationService({ store: new ContactIdentityConfirmationRepository({ db }), now: () => 1700000000000 });
}
function buildMerge(db) {
  return createContactMergeService({ store: new ContactMergeRepository({ db }), now: () => 1700000000000 });
}
function buildKeyNode(db) {
  return createRelationshipKeyNodeService({ store: new RelationshipKeyNodeRepository({ db }), now: () => 1700000000000 });
}

let fixture = null;
function cleanup() {
  if (!fixture) return;
  const current = fixture;
  fixture = null;
  cleanupSqliteTestStore(current.store, current.dbPath);
}
function beginFixture() {
  cleanup();
  fixture = makeFixture();
  return fixture;
}

// ---------- AC-002 集成：身份确认接 contacts 权威表 ----------
test('AC-002 确认身份持久写入 contacts 表', () => {
  beginFixture();
  const { db, insertContact } = fixture;
  insertContact('c1', 'Alice');
  const svc = buildIdentity(db);
  const r = svc.confirmIdentity({ accountId: 'local', contactId: 'c1', confirmedBy: 'tester', note: 'verified' });
  eq(r.contact.identityConfirmed, true, 'identityConfirmed 应为 true');
  eq(r.contact.version, 1, 'version 应为 1');
  const row = db.prepare('SELECT identity_confirmed, identity_version, identity_confirmed_by FROM contacts WHERE id = ?').get('c1');
  eq(row.identity_confirmed, 1, '底层 contacts.identity_confirmed 应为 1（持久）');
  eq(row.identity_version, 1, '底层 contacts.identity_version 应为 1（持久）');
  eq(row.identity_confirmed_by, 'tester', '底层应记录 confirmedBy');
});

test('AC-002 乐观并发冲突（版本不符）回滚', () => {
  const { db } = fixture;
  const svc = buildIdentity(db);
  let threw = false;
  try { svc.confirmIdentity({ accountId: 'local', contactId: 'c1', expectedVersion: 0 }); }
  catch (err) { threw = (err.code === 'VERSION_CONFLICT'); }
  expect(threw, 'expectedVersion 不符应抛 VERSION_CONFLICT');
  const row = db.prepare('SELECT identity_version FROM contacts WHERE id = ?').get('c1');
  eq(row.identity_version, 1, '冲突后版本应保持 1（未部分改写）');
});

test('AC-002 撤销身份确认持久复位', () => {
  const { db } = fixture;
  const svc = buildIdentity(db);
  const r = svc.revokeIdentity({ accountId: 'local', contactId: 'c1' });
  eq(r.contact.identityConfirmed, false, '撤销后 identityConfirmed 应为 false');
  eq(r.contact.version, 2, '撤销后 version 应为 2');
  const row = db.prepare('SELECT identity_confirmed, identity_version FROM contacts WHERE id = ?').get('c1');
  eq(row.identity_confirmed, 0, '底层 contacts.identity_confirmed 应复位为 0');
  eq(row.identity_version, 2, '底层 version 应为 2');
});

// ---------- AC-003 集成：合并接 contacts 权威表 + 持久撤销 ----------
test('AC-003 合并持久墓碑化（merged_into_id 权威写入）', () => {
  beginFixture();
  const { db, insertContact } = fixture;
  insertContact('s', 'Survivor');
  insertContact('m', 'Merged');
  const svc = buildMerge(db);
  const r = svc.mergeContacts({ survivorId: 's', mergedId: 'm', by: 'tester' });
  expect(r.journalId, '应返回 journalId');
  const row = db.prepare('SELECT merged_into_id FROM contacts WHERE id = ?').get('m');
  eq(row.merged_into_id, 's', '被合并联系人 merged_into_id 应指向 survivor（持久墓碑）');
});

test('AC-003 持久撤销恢复被合并联系人', () => {
  const { db } = fixture;
  const svc = buildMerge(db);
  const state = svc.getMergeState({ journalId: db.prepare('SELECT journal_id FROM contact_merge_undo_journal ORDER BY rowid DESC LIMIT 1').get().journal_id });
  const r = svc.undoMerge({ journalId: state.journalId, by: 'tester' });
  eq(r.ok, true, 'undoMerge 应成功');
  const row = db.prepare('SELECT merged_into_id FROM contacts WHERE id = ?').get('m');
  expect(!row.merged_into_id, '撤销后 merged_into_id 应清空');
});

// ---------- AC-004 集成：关键节点接 relationship_timeline_events 权威表 ----------
test('AC-004 标记关键节点持久写入 timeline 表', () => {
  beginFixture();
  const { db, insertContact } = fixture;
  insertContact('c2', 'Bob');
  const svc = buildKeyNode(db);
  const r = svc.markKeyNode({ contactId: 'c2', kind: 'fact', source: 'tester' });
  expect(r.eventId, '应返回 eventId');
  eq(r.isKeyNode, true, 'isKeyNode 应为 true');
  const row = db.prepare('SELECT is_key_node, node_kind FROM relationship_timeline_events WHERE event_id = ?').get(r.eventId);
  eq(row.is_key_node, 1, '底层 is_key_node 应为 1（持久）');
  eq(row.node_kind, 'fact', '底层 node_kind 应为 fact');
});

test('AC-004 取消标记持久复位', () => {
  const { db } = fixture;
  const svc = buildKeyNode(db);
  const ev = db.prepare('SELECT event_id FROM relationship_timeline_events WHERE contact_id = ? ORDER BY rowid DESC LIMIT 1').get('c2').event_id;
  const r = svc.unmarkKeyNode({ eventId: ev });
  eq(r.isKeyNode, false, 'unmark 后 isKeyNode 应为 false');
  const row = db.prepare('SELECT is_key_node FROM relationship_timeline_events WHERE event_id = ?').get(ev);
  eq(row.is_key_node, 0, '底层 is_key_node 应复位为 0（持久）');
});

// ---------- 收尾 ----------
cleanup();
console.log(`\nP0-B integration: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
process.exit(0);
