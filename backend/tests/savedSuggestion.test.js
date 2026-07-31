'use strict';

/**
 * AC-005 — 保存建议（V1 本地书签）集成测试
 * 使用注入的内存 storage，无需 DOM / 网络。验证：幂等、仅本设备、稳定 schemaVersion、
 * 不产生任务/提醒/全局行动事件、不触发后端 connect/sync。
 */

const assert = require('assert');
const { createSavedSuggestionRepository, memoryStorage } = require('../store/savedSuggestionRepository');
const { createSavedSuggestionService } = require('../services/savedSuggestionService');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (err) { failed += 1; failures.push({ name, message: err.message }); console.log('  ✗ ' + name + ' -> ' + err.message); }
}

function build(overrides) {
  const repo = new createSavedSuggestionRepository({ storage: memoryStorage(), schemaVersion: '1.0' });
  const eventCalls = [];
  const backendCalls = [];
  const base = {
    store: repo,
    eventBus: { emit: (type) => eventCalls.push(type) },
    backend: { connect: () => backendCalls.push('connect'), sync: () => backendCalls.push('sync') },
    now: () => 1700000000000,
    uuid: (() => { let n = 0; return () => 'sug-' + (++n); })(),
  };
  const svc = createSavedSuggestionService(Object.assign(base, overrides || {}));
  svc.__eventCalls = eventCalls;
  svc.__backendCalls = backendCalls;
  return svc;
}

console.log('AC-005 savedSuggestion — 集成测试（V1 本地书签）');

test('saveSuggestion 创建记录：deviceLocal:true + 稳定 schemaVersion + savedAt', () => {
  const svc = build();
  const r = svc.saveSuggestion({ contactId: 'c1', label: '客户倾向方案 B', note: '基于报价对话' });
  assert.ok(r.suggestionId);
  assert.strictEqual(r.deviceLocal, true, '必须明确仅本设备');
  assert.strictEqual(r.schemaVersion, '1.0', '稳定 schemaVersion');
  assert.ok(r.savedAt);
  assert.strictEqual(r.contactId, 'c1');
});

test('saveSuggestion 幂等：重复保存（同 suggestionId）不产生第二条、返回 idempotent', () => {
  const svc = build();
  const a = svc.saveSuggestion({ contactId: 'c1', label: 'X' });
  const b = svc.saveSuggestion({ contactId: 'c1', label: 'X', suggestionId: a.suggestionId });
  assert.strictEqual(b.idempotent, true);
  assert.strictEqual(b.suggestionId, a.suggestionId);
  assert.strictEqual(svc.listSaved('c1').length, 1);
});

test('unsaveSuggestion 删除记录；幂等：重复取消不抛错', () => {
  const svc = build();
  const r = svc.saveSuggestion({ contactId: 'c1' });
  const out = svc.unsaveSuggestion({ suggestionId: r.suggestionId });
  assert.strictEqual(out.removed, true);
  assert.strictEqual(svc.isSaved(r.suggestionId), false);
  const out2 = svc.unsaveSuggestion({ suggestionId: r.suggestionId });
  assert.strictEqual(out2.removed, false, '已不存在应幂等返回 removed:false');
});

test('listSaved 按联系人过滤', () => {
  const svc = build();
  svc.saveSuggestion({ contactId: 'c1', label: 'A' });
  svc.saveSuggestion({ contactId: 'c1', label: 'B' });
  svc.saveSuggestion({ contactId: 'c2', label: 'C' });
  assert.strictEqual(svc.listSaved('c1').length, 2);
  assert.strictEqual(svc.listSaved('c2').length, 1);
  assert.strictEqual(svc.listSaved().length, 3);
});

test('isSaved 状态正确', () => {
  const svc = build();
  const r = svc.saveSuggestion({ contactId: 'c1' });
  assert.strictEqual(svc.isSaved(r.suggestionId), true);
  assert.strictEqual(svc.isSaved('nope'), false);
});

test('不产生任务/提醒/全局行动事件（eventBus 无任何 emit）', () => {
  const svc = build();
  svc.saveSuggestion({ contactId: 'c1', label: 'X' });
  svc.saveSuggestion({ contactId: 'c1', label: 'X' });
  svc.unsaveSuggestion({ suggestionId: 'whatever' });
  assert.strictEqual(svc.__eventCalls.length, 0, '契约层禁止 emit 任何事件');
});

test('不触发后端 connect/sync（不再作为 CONNECT 阻断）', () => {
  const svc = build();
  svc.saveSuggestion({ contactId: 'c1' });
  svc.unsaveSuggestion({ suggestionId: 'x' });
  assert.strictEqual(svc.__backendCalls.length, 0, '保存建议不得触发后端 connect/sync');
});

test('缺失 contactId → INVALID_INPUT', () => {
  const svc = build();
  let err;
  try { svc.saveSuggestion({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'INVALID_INPUT');
});

test('缺失 suggestionId 取消 → INVALID_INPUT', () => {
  const svc = build();
  let err;
  try { svc.unsaveSuggestion({}); } catch (e) { err = e; }
  assert.ok(err);
  assert.strictEqual(err.code, 'INVALID_INPUT');
});

test('显式 suggestionId 被采用', () => {
  const svc = build();
  const r = svc.saveSuggestion({ suggestionId: 'sug-fixed-1', contactId: 'c1' });
  assert.strictEqual(r.suggestionId, 'sug-fixed-1');
  assert.strictEqual(svc.isSaved('sug-fixed-1'), true);
});

test('label/note 正确持久化', () => {
  const svc = build();
  const r = svc.saveSuggestion({ contactId: 'c1', label: '保存建议', note: '仅本设备留存' });
  assert.strictEqual(r.label, '保存建议');
  assert.strictEqual(r.note, '仅本设备留存');
});

test('schemaVersion 稳定且可随迁移演进', () => {
  const storage = memoryStorage();
  const repoA = new createSavedSuggestionRepository({ storage, schemaVersion: '1.0' });
  const svcA = createSavedSuggestionService({ store: repoA });
  svcA.saveSuggestion({ contactId: 'c1' });
  // 模拟未来迁移：新版本读旧记录时仍能识别原 schemaVersion
  const repoB = new createSavedSuggestionRepository({ storage, schemaVersion: '2.0' });
  const svcB = createSavedSuggestionService({ store: repoB });
  const migrated = svcB.listSaved('c1');
  assert.strictEqual(migrated.length, 1);
  assert.strictEqual(migrated[0].schemaVersion, '1.0', '旧记录保留原 schemaVersion 供迁移识别');
});

test('跨实例持久化（同 storage 共享状态）', () => {
  const storage = memoryStorage();
  const repoA = new createSavedSuggestionRepository({ storage });
  const svcA = createSavedSuggestionService({ store: repoA });
  const r = svcA.saveSuggestion({ contactId: 'c1' });
  const repoB = new createSavedSuggestionRepository({ storage });
  const svcB = createSavedSuggestionService({ store: repoB });
  assert.strictEqual(svcB.isSaved(r.suggestionId), true, '同 storage 应可见');
});

console.log('');
console.log(`AC-005 通过 ${passed} / 失败 ${failed}`);
if (failures.length) {
  console.log('失败用例:');
  for (const f of failures) console.log('  - ' + f.name + ': ' + f.message);
}
process.exit(failed === 0 ? 0 : 1);
