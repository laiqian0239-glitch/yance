'use strict';

/**
 * AC-003 契约测试（独立脚本，风格同 contactIdentityConfirmation.test.js）
 * 运行: node backend/tests/contactMerge.test.js
 *
 * 使用真实 node:sqlite 数据库（R32SqliteStore 临时文件）验证 8 步事务与持久撤销，
 * 通过依赖注入缝注入 eventBus / auditLog / now / uuid。
 */

const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ContactMergeRepository } = require('../store/contactMergeRepository');
const { createContactMergeService, CoreError } = require('../services/contactMergeService');

// ---------- 极简测试框架 ----------
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    fail++;
    failures.push({ name, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg || 'expectation failed'); }
function eq(a, b, msg) { expect(a === b, msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ---------- 测试装置 ----------
function makeFixture() {
  const dbPath = path.join(os.tmpdir(), `ac003_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);
  const store = new R32SqliteStore({ dbPath });
  const repo = new ContactMergeRepository({ db: store.db });
  const events = [];
  const audits = [];
  const svc = createContactMergeService({
    store: repo,
    eventBus: { emit: (t, p) => events.push({ type: t, payload: p }) },
    auditLog: { append: (r) => audits.push(r) },
    now: () => 1710000000000,
    uuid: (() => { let n = 0; return () => `journal_${++n}`; })(),
  });
  return { store, repo, events, audits, svc, dbPath };
}

function contactRow(store, id) {
  return store.db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
}
function convContactId(store, sessionKey) {
  const r = store.db.prepare('SELECT contact_id FROM r32_conversations WHERE session_key=?').get(sessionKey);
  return r ? r.contact_id : null;
}
function profileExists(store, id) {
  return !!store.db.prepare('SELECT 1 FROM customer_profiles WHERE contact_id=?').get(id);
}

console.log('AC-003 contactMerge 契约测试');
console.log('========================================');

// 1. 成功合并：标记 + 引用重定向 + 日志 + 事件 + 审计
test('mergeContacts 成功：tombstone + 引用重定向 + 日志 + 事件 + 审计', () => {
  const { store, repo, events, audits, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'Alice' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'Alice Dup' });
  store.upsertConversation({ sessionKey: 'sess_merged', contactId: merged, accountId: 'a1', platform: 'wa', title: 'Alice Dup' });

  const res = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 'tester' });
  eq(res.ok, true, 'should return ok');
  eq(res.journalId, 'journal_1', 'journal id from injected uuid');

  const m = contactRow(store, merged);
  eq(m.merged_into_id, survivor, 'merged.merged_into_id -> survivor');
  expect(m.tombstoned_at !== '' && m.tombstoned_at != null, 'merged.tombstoned_at set');
  eq(convContactId(store, 'sess_merged'), survivor, 'conversation re-pointed to survivor');

  const j = repo.getUndoJournal('journal_1');
  eq(j.status, 'applied', 'journal applied');
  expect(Array.isArray(j.changes) && j.changes.length >= 1, 'journal records changes');
  eq(events.length, 1, 'one event emitted');
  eq(events[0].type, 'contact:merged', 'event type contact:merged');
  eq(audits.length, 1, 'one audit entry');
  eq(audits[0].action, 'merge', 'audit action merge');
});

// 2. 缺参
test('mergeContacts 缺 survivorId → INVALID_INPUT', () => {
  const { svc } = makeFixture();
  let threw = null;
  try { svc.mergeContacts({ mergedId: 'x' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'INVALID_INPUT', 'expected INVALID_INPUT');
});

// 3. 自合并
test('mergeContacts survivorId === mergedId → INVALID_INPUT', () => {
  const { svc } = makeFixture();
  let threw = null;
  try { svc.mergeContacts({ survivorId: 'x', mergedId: 'x' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'INVALID_INPUT', 'expected INVALID_INPUT');
});

// 4. survivor 不存在
test('mergeContacts survivor 不存在 → SURVIVOR_NOT_FOUND', () => {
  const { store, svc } = makeFixture();
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'B' });
  let threw = null;
  try { svc.mergeContacts({ survivorId: 'nope', mergedId: merged }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'SURVIVOR_NOT_FOUND', 'expected SURVIVOR_NOT_FOUND');
});

// 5. 已合并的联系人不能再合并
test('mergeContacts 合并已 tombstone 的联系人 → ALREADY_MERGED', () => {
  const { store, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  let threw = null;
  try { svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'ALREADY_MERGED', 'expected ALREADY_MERGED');
});

// 6. 乐观并发冲突 → 整体回滚（无部分写入、无日志、无事件）
test('乐观并发冲突 → VERSION_CONFLICT 且整体回滚', () => {
  const fx = makeFixture();
  const { store, svc } = fx;
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });

  // 用包装器在事务内第一次读取 survivor 时篡改其版本，模拟并发修改
  const repo = fx.repo;
  let inTx = false;
  let mutated = false;
  const wrapper = Object.assign(Object.create(repo), repo, {
    getContactPlain(id) {
      const c = repo.getContactPlain(id);
      if (inTx && id === survivor && !mutated) {
        mutated = true;
        return Object.assign({}, c, { updated_at: 'CONFLICT_MARKER' });
      }
      return c;
    },
    transaction(fn) {
      inTx = true;
      try { return repo.transaction((tx) => fn(wrapper)); } finally { inTx = false; }
    },
  });
  const svc2 = require('../services/contactMergeService')
    .createContactMergeService({ store: wrapper, eventBus: { emit() {} }, auditLog: { append() {} }, now: () => 1710000000000, uuid: () => 'journal_x' });

  let threw = null;
  try { svc2.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'VERSION_CONFLICT', 'expected VERSION_CONFLICT');
  // 回滚断言
  const m = contactRow(store, merged);
  eq(m.merged_into_id, '', 'merged 未被 tombstone（已回滚）');
  eq(m.tombstoned_at, '', 'tombstoned_at 空（已回滚）');
  eq(repo.getUndoJournal('journal_x'), null, '无撤销日志（已回滚）');
});

// 7. 撤销：恢复 + 引用回退 + 日志 undone + 事件
test('undoMerge 成功恢复被合并联系人并回退引用', () => {
  const { store, repo, events, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  store.upsertConversation({ sessionKey: 'sess_merged', contactId: merged, accountId: 'a1', platform: 'wa', title: 'A2' });

  const r = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  const u = svc.undoMerge({ journalId: r.journalId, by: 't2' });
  eq(u.ok, true, 'undo ok');

  const m = contactRow(store, merged);
  eq(m.merged_into_id, '', 'merged.merged_into_id 清空');
  eq(m.tombstoned_at, '', 'merged.tombstoned_at 清空（已恢复）');
  eq(convContactId(store, 'sess_merged'), merged, 'conversation 回退到 merged');
  eq(repo.getUndoJournal(r.journalId).status, 'undone', 'journal undone');
  const unmergedEvt = events.find((e) => e.type === 'contact:unmerged');
  expect(unmergedEvt, 'contact:unmerged 事件');
});

// 8. 撤销幂等：已 undone 再撤销 → NOT_APPLIED
test('undoMerge 重复撤销 → NOT_APPLIED', () => {
  const { store, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  const r = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  svc.undoMerge({ journalId: r.journalId, by: 't' });
  let threw = null;
  try { svc.undoMerge({ journalId: r.journalId, by: 't' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'NOT_APPLIED', 'expected NOT_APPLIED');
});

// 9. 撤销未知日志 → JOURNAL_NOT_FOUND
test('undoMerge 未知 journalId → JOURNAL_NOT_FOUND', () => {
  const { svc } = makeFixture();
  let threw = null;
  try { svc.undoMerge({ journalId: 'ghost' }); } catch (e) { threw = e; }
  expect(threw && threw.code === 'JOURNAL_NOT_FOUND', 'expected JOURNAL_NOT_FOUND');
});

// 10. PK_TABLES(reinsert) 路径：survivor 与 merged 各有一份 customer_profiles
test('合并删被合并画像(survivor 已有)→撤销精确回插', () => {
  const { store, repo, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  store.db.prepare('INSERT INTO customer_profiles(contact_id, created_at, updated_at) VALUES (?,?,?)').run(survivor, '2024', '2024');
  store.db.prepare('INSERT INTO customer_profiles(contact_id, lifecycle_stage, created_at, updated_at) VALUES (?,?,?,?)').run(merged, 'lead', '2024', '2024');

  const r = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  eq(profileExists(store, merged), false, '合并后被合并画像被吸收删除');
  eq(profileExists(store, survivor), true, 'survivor 画像保留');
  svc.undoMerge({ journalId: r.journalId, by: 't' });
  eq(profileExists(store, merged), true, '撤销后被合并画像回插');
  const p = store.db.prepare('SELECT lifecycle_stage FROM customer_profiles WHERE contact_id=?').get(merged);
  eq(p.lifecycle_stage, 'lead', '回插画像数据完整');
  eq(repo.getUndoJournal(r.journalId).status, 'undone', 'journal undone');
});

// 11. 多表引用重定向 + 撤销精确回退
test('多表引用(对话/AI任务)重定向与撤销回退', () => {
  const { store, repo, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  store.upsertConversation({ sessionKey: 'sess_merged', contactId: merged, accountId: 'a1', platform: 'wa', title: 'A2' });
  store.db.prepare('INSERT INTO ai_reply_tasks(task_id, contact_id, conversation_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('task_1', merged, 'sess_merged', 'queued', '2024', '2024');

  const r = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  eq(convContactId(store, 'sess_merged'), survivor, '对话 → survivor');
  const task1 = store.db.prepare('SELECT contact_id FROM ai_reply_tasks WHERE task_id=?').get('task_1');
  eq(task1.contact_id, survivor, 'AI 任务 → survivor');

  svc.undoMerge({ journalId: r.journalId, by: 't' });
  eq(convContactId(store, 'sess_merged'), merged, '对话回退 → merged');
  const task2 = store.db.prepare('SELECT contact_id FROM ai_reply_tasks WHERE task_id=?').get('task_1');
  eq(task2.contact_id, merged, 'AI 任务回退 → merged');
  eq(repo.getUndoJournal(r.journalId).status, 'undone', 'journal undone');
});

// 12. AI回复反馈学习记录随联系人合并，并可精确撤销
test('AI回复反馈事件与联系人级学习画像随合并迁移并可撤销', () => {
  const { store, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  store.db.prepare(`INSERT INTO ai_reply_feedback_events(
    id,event_type,candidate_id,outbox_id,contact_id,conversation_id,persona_profile_id,
    original_text,final_text,rejection_reason,signals_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'feedback_1','sent','candidate_1','outbox_1',merged,'conv_1','owner',
    '很长的回复','短回复','',JSON.stringify([{ key:'replyLength', value:'short' }]),'2024-01-01'
  );
  const survivorProfile = { version: 2, counts: { replyLength: { short: { count: 2, weight: 1.8 } } }, effective: {}, evidence: [{ id:'s1', contactId:survivor, signals:[{key:'replyLength',value:'short'}], createdAt:'2024-01-01' }] };
  const mergedProfile = { version: 2, counts: { replyLength: { short: { count: 1, weight: 1 } } }, effective: {}, evidence: [{ id:'m1', contactId:merged, signals:[{key:'replyLength',value:'short'}], createdAt:'2024-01-02' }] };
  store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,?,?)")
    .run(survivor, JSON.stringify(survivorProfile), 2, '2024-01-01');
  store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,?,?)")
    .run(merged, JSON.stringify(mergedProfile), 2, '2024-01-02');

  const result = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  eq(store.db.prepare('SELECT contact_id FROM ai_reply_feedback_events WHERE id=?').get('feedback_1').contact_id, survivor, '反馈事件重定向到 survivor');
  const mergedGone = store.db.prepare("SELECT 1 FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(merged);
  eq(Boolean(mergedGone), false, '被合并联系人的学习画像已吸收');
  const combinedRow = store.db.prepare("SELECT profile_json FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(survivor);
  const combined = JSON.parse(combinedRow.profile_json);
  eq(combined.counts.replyLength.short.count, 3, '重复反馈证据正确合并');
  eq(combined.effective.replyLength.value, 'short', '达到阈值后偏好生效');
  expect(combined.evidence.every(row => row.contactId === survivor), '证据联系人身份统一到 survivor');

  svc.undoMerge({ journalId: result.journalId, by: 't' });
  eq(store.db.prepare('SELECT contact_id FROM ai_reply_feedback_events WHERE id=?').get('feedback_1').contact_id, merged, '反馈事件撤销回 merged');
  const restoredSurvivor = JSON.parse(store.db.prepare("SELECT profile_json FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(survivor).profile_json);
  const restoredMerged = JSON.parse(store.db.prepare("SELECT profile_json FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(merged).profile_json);
  eq(restoredSurvivor.counts.replyLength.short.count, 2, 'survivor 学习画像精确恢复');
  eq(restoredMerged.counts.replyLength.short.count, 1, 'merged 学习画像精确恢复');
});

// 13. getMergeState
test('getMergeState 读取日志状态', () => {
  const { store, svc } = makeFixture();
  const survivor = store.upsertContact({ platform: 'wa', externalId: '+111', displayName: 'A' });
  const merged = store.upsertContact({ platform: 'wa', externalId: '+222', displayName: 'A2' });
  const r = svc.mergeContacts({ survivorId: survivor, mergedId: merged, by: 't' });
  const st = svc.getMergeState({ journalId: r.journalId });
  eq(st.found, true, 'found');
  eq(st.status, 'applied', 'status applied');
  eq(st.survivorId, survivor, 'survivorId');
  eq(svc.getMergeState({ journalId: 'ghost' }).found, false, 'unknown not found');
});

console.log('========================================');
console.log(`总计: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.log('失败详情:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.stack}`);
  process.exit(1);
} else {
  console.log('全部通过 ✅');
  process.exit(0);
}
