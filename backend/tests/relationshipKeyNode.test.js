'use strict';

/**
 * AC-004 — 关系轨迹关键节点持久化 集成测试
 * 真实 node:sqlite（:memory:）运行，无重依赖。DI 注入固定 now/uuid 以断言版本与幂等。
 */

const { DatabaseSync } = require('node:sqlite');
const assert = require('assert');
const { RelationshipKeyNodeRepository } = require('../store/relationshipKeyNodeRepository');
const { createRelationshipKeyNodeService, VALID_KINDS } = require('../services/relationshipKeyNodeService');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed += 1;
    failures.push({ name, message: err.message });
    console.log('  ✗ ' + name + ' -> ' + err.message);
  }
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE contacts(id TEXT PRIMARY KEY, display_name TEXT, merged_into_id TEXT NOT NULL DEFAULT '', tombstoned_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '') STRICT;"
  );
  db.exec(`
    CREATE TABLE relationship_timeline_events (
      event_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      interpretation TEXT NOT NULL DEFAULT '',
      evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
      source_signal_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'candidate',
      engine_version TEXT NOT NULL DEFAULT '1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    ) STRICT;
  `);
  return db;
}

function seedContact(db, id) {
  db.prepare("INSERT INTO contacts(id, display_name, updated_at) VALUES (?, ?, ?)").run(id, 'c-' + id, 'T0');
}

function seedEvent(db, eventId, contactId, updatedAt = 'T0') {
  db.prepare(`
    INSERT INTO relationship_timeline_events(
      event_id, contact_id, event_type, started_at, confirmed_at, interpretation, created_at, updated_at
    ) VALUES (?, ?, 'note', 'T0', 'T0', 'seed', 'T0', ?)
  `).run(eventId, contactId, updatedAt);
}

function buildService(db, overrides) {
  const events = [];
  const audits = [];
  const now = () => 1700000000000;
  const uuid = (() => { let n = 0; return () => 'evt-' + (++n); })();
  const repo = new RelationshipKeyNodeRepository({ db, now });
  const base = {
    store: repo,
    eventBus: { emit: (type, payload) => events.push({ type, payload }) },
    auditLog: { append: (r) => audits.push(r) },
    now,
    uuid,
  };
  const svc = createRelationshipKeyNodeService(Object.assign(base, overrides || {}));
  svc.__repo = repo;
  svc.__events = events;
  svc.__audits = audits;
  return svc;
}

console.log('AC-004 relationshipKeyNode — 真实 SQLite 集成测试');

test('扩展 schema：key node 列已存在', () => {
  const db = makeDb();
  const repo = new RelationshipKeyNodeRepository({ db });
  const cols = repo.db.prepare('PRAGMA table_info(relationship_timeline_events)').all().map((r) => r.name);
  for (const c of ['is_key_node', 'node_kind', 'marked_by', 'marked_at']) {
    assert.ok(cols.includes(c), 'missing column ' + c);
  }
});

test('markKeyNode 新建 fact 关键节点：持久化 + 版本 + 事件 + 审计', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  const svc = buildService(db);
  const out = svc.markKeyNode({ contactId: 'c1', kind: 'fact', summary: '客户确认预算' });
  assert.ok(out.eventId, 'eventId');
  assert.strictEqual(out.isKeyNode, true);
  assert.strictEqual(out.nodeKind, 'fact');
  assert.strictEqual(out.version, '2023-11-14T22:13:20.000Z');
  const row = svc.__repo.getKeyNode(out.eventId);
  assert.ok(row, '应写入关键节点');
  assert.strictEqual(row.node_kind, 'fact');
  assert.strictEqual(row.is_key_node, 1);
  assert.strictEqual(row.interpretation, '客户确认预算');
  assert.strictEqual(svc.__events.length, 1);
  assert.strictEqual(svc.__events[0].type, 'keyNode:marked');
  assert.strictEqual(svc.__audits.length, 1);
  assert.strictEqual(svc.__audits[0].action, 'markKeyNode');
});

test('markKeyNode 新建 inference 关键节点：node_kind=inference', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  const svc = buildService(db);
  const out = svc.markKeyNode({ contactId: 'c1', kind: 'inference', summary: '推测其决策权有限' });
  assert.strictEqual(out.nodeKind, 'inference');
  const row = svc.__repo.getKeyNode(out.eventId);
  assert.strictEqual(row.node_kind, 'inference');
});

test('markKeyNode kind 非法 → KEY_NODE_KIND_INVALID', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  const svc = buildService(db);
  let err;
  try { svc.markKeyNode({ contactId: 'c1', kind: 'opinion' }); } catch (e) { err = e; }
  assert.ok(err, '应抛错');
  assert.strictEqual(err.code, 'KEY_NODE_KIND_INVALID');
});

test('markKeyNode 新建但缺 contactId → INVALID_INPUT', () => {
  const db = makeDb();
  const svc = buildService(db);
  let err;
  try { svc.markKeyNode({ kind: 'fact' }); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'INVALID_INPUT');
});

test('markKeyNode 标记已有轨迹事件为关键节点', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  const svc = buildService(db);
  const out = svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  assert.strictEqual(out.eventId, 'e1');
  assert.strictEqual(out.isKeyNode, true);
  const row = svc.__repo.getKeyNode('e1');
  assert.ok(row);
  assert.strictEqual(row.node_kind, 'fact');
  assert.strictEqual(row.status, 'confirmed');
});

test('markKeyNode 幂等：同 kind 再次标记不产生事件/审计', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  const svc = buildService(db);
  const first = svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  assert.strictEqual(first.idempotent, undefined);
  const second = svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(svc.__events.length, 1, '不应产生第二个事件');
  assert.strictEqual(svc.__audits.length, 1, '不应产生第二条审计');
});

test('markKeyNode CAS 冲突：expectedVersion 不符 → VERSION_CONFLICT 且无写入', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1', 'V1');
  const svc = buildService(db);
  let err;
  try { svc.markKeyNode({ eventId: 'e1', kind: 'fact', expectedVersion: 'WRONG' }); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'VERSION_CONFLICT');
  // 无写入：仍为非关键节点
  assert.strictEqual(svc.__repo.getKeyNode('e1'), null);
});

test('markKeyNode 未知 eventId → KEY_NODE_EVENT_NOT_FOUND', () => {
  const db = makeDb();
  const svc = buildService(db);
  let err;
  try { svc.markKeyNode({ eventId: 'nope', kind: 'fact' }); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'KEY_NODE_EVENT_NOT_FOUND');
});

test('unmarkKeyNode：取消标记 + 事件', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  const svc = buildService(db);
  svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  const out = svc.unmarkKeyNode({ eventId: 'e1' });
  assert.strictEqual(out.isKeyNode, false);
  assert.strictEqual(svc.__repo.getKeyNode('e1'), null);
  assert.strictEqual(svc.__events[svc.__events.length - 1].type, 'keyNode:unmarked');
});

test('unmarkKeyNode 幂等：已非关键节点直接返回', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  const svc = buildService(db);
  const before = svc.__events.length;
  const out = svc.unmarkKeyNode({ eventId: 'e1' });
  assert.strictEqual(out.isKeyNode, false);
  assert.strictEqual(svc.__events.length, before, '不应产生事件');
});

test('listKeyNodes：按联系人列出，可按 fact/inference 过滤', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  seedEvent(db, 'e2', 'c1');
  seedEvent(db, 'e3', 'c1');
  const svc = buildService(db);
  svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  svc.markKeyNode({ eventId: 'e2', kind: 'inference' });
  svc.markKeyNode({ eventId: 'e3', kind: 'fact' });
  const all = svc.listKeyNodes('c1');
  assert.strictEqual(all.length, 3);
  const facts = svc.listKeyNodes('c1', { nodeKind: 'fact' });
  assert.strictEqual(facts.length, 2);
  assert.ok(facts.every((x) => x.nodeKind === 'fact'));
  const infs = svc.listKeyNodes('c1', { nodeKind: 'inference' });
  assert.strictEqual(infs.length, 1);
});

test('getKeyNode：关键节点返回，非关键节点返回 null', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1');
  const svc = buildService(db);
  svc.markKeyNode({ eventId: 'e1', kind: 'fact' });
  assert.ok(svc.getKeyNode('e1'));
  // e2 未标记
  seedEvent(db, 'e2', 'c1');
  assert.strictEqual(svc.getKeyNode('e2'), null);
});

test('失败恢复旧投影：写一半抛错后事务回滚，旧状态保留', () => {
  const db = makeDb();
  seedContact(db, 'c1');
  seedEvent(db, 'e1', 'c1', 'V1');
  const svc = buildService(db);
  // 注入失败：先真实写入再抛错，验证事务 ROLLBACK 恢复旧投影
  const orig = svc.__repo.markExistingEvent.bind(svc.__repo);
  svc.__repo.markExistingEvent = (eventId, opts) => { orig(eventId, opts); throw new Error('simulated write failure'); };
  let err;
  try { svc.markKeyNode({ eventId: 'e1', kind: 'fact' }); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'KEY_NODE_WRITE_FAILED');
  assert.ok(err.details && err.details.oldProjection, '应附旧投影');
  // 回滚后仍为非关键节点，旧版本未变
  const row = svc.__repo.getEvent('e1');
  assert.strictEqual(row.is_key_node, 0, '应回滚为未标记');
  assert.strictEqual(row.updated_at, 'V1', '版本应恢复为旧值');
});

console.log('');
console.log(`AC-004 通过 ${passed} / 失败 ${failed}`);
if (failures.length) {
  console.log('失败用例:');
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
}
process.exit(failed === 0 ? 0 : 1);
