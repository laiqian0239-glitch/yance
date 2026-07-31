'use strict';

// P0-A / AC-017 Phase 2 验证：持久化权威来源契约。
// 印证 frontend/js/r32-ui-runtime.js 中 persistState() 读取
// activeContactStore.getSnapshot().contactId、restoreState() 通过
// activeContactStore.setActiveContact(activeId,{source:'r32-ui-runtime:persistence',force:true})
// 将 Store 重新种为权威的行为是正确的。
// 注意：localStorage + DOM 装配在 Node 不可执行，此测试覆盖 Store 这一半的契约
// （UI 装配由 node --check + 现有 12/12 测试 + 静态推演覆盖）。

const test = require('node:test');
const assert = require('node:assert');
const { createActiveContactStore } = require('../../frontend/js/r32-active-contact-store.js');

function makeStore() {
  const store = createActiveContactStore({ eventTarget: globalThis });
  store.setAvailableContacts([
    { id: 'c1', archived: false },
    { id: 'c2', archived: false },
    { id: 'c3', archived: true }
  ]);
  return store;
}

test('getSnapshot().contactId is the canonical authority persisted by persistState', () => {
  const store = makeStore();
  store.setActiveContact('c1', { source: 'test', reason: 'phase2' });
  assert.strictEqual(store.getSnapshot().contactId, 'c1');
  store.setActiveContact('c2', { source: 'test', reason: 'switch' });
  assert.strictEqual(store.getSnapshot().contactId, 'c2');
});

test('restoreState re-seeds the store as authority via setActiveContact with force', () => {
  const store = makeStore();
  // 模拟 restoreState 末尾追加的调用形态
  store.setActiveContact('c2', {
    source: 'r32-ui-runtime:persistence',
    reason: 'restore',
    view: 'contacts',
    force: true,
    contact: { id: 'c2' }
  });
  const snap = store.getSnapshot();
  assert.strictEqual(snap.contactId, 'c2');
  assert.strictEqual(snap.view, 'contacts');
  assert.strictEqual(snap.source, 'r32-ui-runtime:persistence');
});

test('force:true re-seeds even when same id (restore must overwrite canonical state)', () => {
  const store = makeStore();
  store.setActiveContact('c1', { source: 'bootstrap', reason: 'initial' });
  const before = store.getSnapshot();
  // 再次以相同 id 但 force:true 调用（restoreState 的语义）
  const res = store.setActiveContact('c1', { source: 'r32-ui-runtime:persistence', reason: 'restore', force: true });
  assert.strictEqual(res.changed, true, 'force must re-apply even for unchanged id');
  assert.strictEqual(store.getSnapshot().contactId, 'c1');
  assert.strictEqual(store.getSnapshot().revision > before.revision, true, 'revision must advance on forced restore');
});

test('canonical event carries contactId so UI handler can ignore r32-ui-runtime sources', () => {
  const store = makeStore();
  let captured = null;
  store.subscribe((_snapshot, detail) => { captured = detail; }, { fireImmediately: false });
  store.setActiveContact('c1', { source: 'r32-ui-runtime:persistence', reason: 'restore', force: true });
  assert.ok(captured, 'canonical event fired');
  assert.strictEqual(captured.current.contactId, 'c1');
  assert.strictEqual(captured.canonical, true);
});
