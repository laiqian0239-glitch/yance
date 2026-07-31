'use strict';

/**
 * AC-002 — contactIdentityConfirmationService 契约测试
 * 仅依赖注入的 fake store/eventBus/auditLog，不触及生产调用方。
 */

const assert = require('assert');
const { createContactIdentityConfirmationService, CoreError } = require('../services/contactIdentityConfirmationService');

function makeFakeStore(seed) {
  const contacts = {};
  if (seed) {
    for (const k of Object.keys(seed)) {
      const [accountId, contactId] = k.split('::');
      contacts[k] = Object.assign({ identityConfirmed: false, confirmedAt: null, confirmedBy: null, note: null, version: 1 }, seed[k]);
      contacts[k]._accountId = accountId;
      contacts[k]._contactId = contactId;
    }
  }
  let casFailures = 0;
  return {
    getContact(accountId, contactId) {
      return contacts[accountId + '::' + contactId] || null;
    },
    updateContactIdentity(accountId, contactId, patch) {
      const key = accountId + '::' + contactId;
      const cur = contacts[key];
      if (!cur) throw CoreError('CONTACT_NOT_FOUND', 'no such contact');
      // 原子 CAS：patch.version 必须匹配当前 version，否则抛 STORE_VERSION_CONFLICT
      if (cur.version !== patch.version) {
        casFailures++;
        const e = CoreError('STORE_VERSION_CONFLICT', 'store CAS failed');
        e.storeCasFailures = casFailures;
        throw e;
      }
      cur.identityConfirmed = !!patch.identityConfirmed;
      cur.confirmedAt = patch.confirmedAt != null ? patch.confirmedAt : null;
      cur.confirmedBy = patch.confirmedBy != null ? patch.confirmedBy : null;
      cur.note = patch.note != null ? patch.note : null;
      cur.version = cur.version + 1;
      return cur;
    },
    _contacts: contacts,
    _casFailures: () => casFailures
  };
}

function makeFakeEventBus() {
  const events = [];
  return { emit(e, p) { events.push({ e, p }); }, events };
}
function makeFakeAudit() {
  const receipts = [];
  return { append(r) { receipts.push(r); }, receipts };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  [PASS] ' + name); }
  catch (e) { failed++; console.log('  [FAIL] ' + name + ' :: ' + e.message); }
}

console.log('AC-002 contactIdentityConfirmationService tests');

test('confirmIdentity 成功: 身份被标记 + receipt + 事件', () => {
  const store = makeFakeStore({ 'acc1::c1': { version: 1 } });
  const bus = makeFakeEventBus();
  const audit = makeFakeAudit();
  const svc = createContactIdentityConfirmationService({ store, eventBus: bus, auditLog: audit, now: () => 1000, uuid: () => 'r1' });
  const res = svc.confirmIdentity({ accountId: 'acc1', contactId: 'c1', expectedVersion: 1, confirmedBy: 'agent' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(store.getContact('acc1', 'c1').identityConfirmed, true);
  assert.strictEqual(store.getContact('acc1', 'c1').version, 2);
  assert.strictEqual(audit.receipts.length, 1);
  assert.strictEqual(audit.receipts[0].action, 'confirm');
  assert.strictEqual(bus.events.length, 1);
  assert.strictEqual(bus.events[0].e, 'contact:identity-confirmed');
  assert.strictEqual(bus.events[0].p.receiptId, 'r1');
});

test('乐观并发: expectedVersion 不匹配抛 VERSION_CONFLICT 且不写', () => {
  const store = makeFakeStore({ 'acc1::c1': { version: 3 } });
  const bus = makeFakeEventBus();
  const audit = makeFakeAudit();
  const svc = createContactIdentityConfirmationService({ store, eventBus: bus, auditLog: audit });
  let threw = null;
  try { svc.confirmIdentity({ accountId: 'acc1', contactId: 'c1', expectedVersion: 1 }); }
  catch (e) { threw = e; }
  assert.ok(threw, 'should throw');
  assert.strictEqual(threw.code, 'VERSION_CONFLICT');
  assert.strictEqual(store.getContact('acc1', 'c1').identityConfirmed, false, '权威身份未被改变');
  assert.strictEqual(store.getContact('acc1', 'c1').version, 3, '版本未变');
  assert.strictEqual(bus.events.length, 0, '无事件');
  assert.strictEqual(audit.receipts.length, 0, '无 receipt');
});

test('失败不改权威身份: store 写入抛错则不审计不 emit', () => {
  const store = makeFakeStore({ 'acc1::c1': { version: 1 } });
  // 注入 CAS 必然失败
  store.updateContactIdentity = () => { throw CoreError('STORE_VERSION_CONFLICT', 'forced'); };
  const bus = makeFakeEventBus();
  const audit = makeFakeAudit();
  const svc = createContactIdentityConfirmationService({ store, eventBus: bus, auditLog: audit });
  let threw = null;
  try { svc.confirmIdentity({ accountId: 'acc1', contactId: 'c1', expectedVersion: 1 }); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.strictEqual(threw.code, 'STORE_VERSION_CONFLICT');
  assert.strictEqual(store.getContact('acc1', 'c1').identityConfirmed, false);
  assert.strictEqual(bus.events.length, 0);
  assert.strictEqual(audit.receipts.length, 0);
});

test('revokeIdentity: 撤销确认状态', () => {
  const store = makeFakeStore({ 'acc1::c1': { version: 1, identityConfirmed: true, confirmedAt: 100, confirmedBy: 'agent' } });
  const bus = makeFakeEventBus();
  const audit = makeFakeAudit();
  const svc = createContactIdentityConfirmationService({ store, eventBus: bus, auditLog: audit, now: () => 2000, uuid: () => 'r2' });
  const res = svc.revokeIdentity({ accountId: 'acc1', contactId: 'c1', expectedVersion: 1, revokedBy: 'agent' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(store.getContact('acc1', 'c1').identityConfirmed, false);
  assert.strictEqual(store.getContact('acc1', 'c1').confirmedAt, null);
  assert.strictEqual(bus.events[0].e, 'contact:identity-revoked');
  assert.strictEqual(audit.receipts[0].action, 'revoke');
});

test('getConfirmationState: 未确认', () => {
  const store = makeFakeStore({ 'acc1::c1': { version: 1 } });
  const svc = createContactIdentityConfirmationService({ store });
  const st = svc.getConfirmationState({ accountId: 'acc1', contactId: 'c1' });
  assert.strictEqual(st.found, true);
  assert.strictEqual(st.identityConfirmed, false);
  assert.strictEqual(st.version, 1);
});

test('CONTACT_NOT_FOUND', () => {
  const store = makeFakeStore({});
  const svc = createContactIdentityConfirmationService({ store });
  let threw = null;
  try { svc.confirmIdentity({ accountId: 'x', contactId: 'y' }); } catch (e) { threw = e; }
  assert.ok(threw);
  assert.strictEqual(threw.code, 'CONTACT_NOT_FOUND');
});

test('缺依赖抛 MISSING_STORE', () => {
  let threw = null;
  try { createContactIdentityConfirmationService({}); } catch (e) { threw = e; }
  assert.ok(threw);
  assert.strictEqual(threw.code, 'MISSING_STORE');
});

console.log('\nAC-002 result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
