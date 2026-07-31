'use strict';

// P0-A AC-031/032 — ContactContextAuthority boundary test (injected deps).

const assert = require('assert');
const auth = require('../services/contactContextAuthority');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

(async () => {
  let ingested = null;
  auth.setSelector({
    selectCustomerSocialContext: (contactId, opts) => ({ contactId, opts, warmth: 0.5 }),
  });
  auth.setIngest(async (contactId, signal) => { ingested = { contactId, signal }; return { stored: true }; });

  await test('getSocialContext delegates to selector', () => {
    const r = auth.getSocialContext('c1', { timelineLimit: 10 });
    assert.strictEqual(r.contactId, 'c1');
    assert.strictEqual(r.opts.timelineLimit, 10);
    assert.strictEqual(r.warmth, 0.5);
  });

  await test('getSocialContext evaluates production selector factories against StoreManager state', () => {
    auth.setSelector({
      selectCustomerSocialContext: contactId => state => ({
        found: Boolean(state.customers?.byId?.[contactId]),
        ready: true,
        contactId
      })
    });
    const fakeStoreManager = {
      select: selector => selector({ customers: { byId: { c2: { id: 'c2' } } } })
    };
    const r = auth.getSocialContext('c2', { storeManager: fakeStoreManager });
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.contactId, 'c2');
    auth.setSelector({
      selectCustomerSocialContext: (contactId, opts) => ({ contactId, opts, warmth: 0.5 }),
    });
  });

  await test('recordSocialSignal routes to local-authority ingest', async () => {
    const sig = { kind: 'message', tone: 'warm' };
    const r = await auth.recordSocialSignal('c1', sig);
    assert.strictEqual(r.stored, true);
    assert.strictEqual(ingested.contactId, 'c1');
    assert.strictEqual(ingested.signal, sig);
  });

  await test('recordSocialSignal throws when writer not wired', async () => {
    auth.setIngest(null);
    let threw = false;
    try { await auth.recordSocialSignal('c1', { kind: 'x' }); } catch (e) { threw = true; assert.strictEqual(e.code, 'CONTACT_CONTEXT_WRITER_UNWIRED'); }
    assert.strictEqual(threw, true);
    // restore for cleanliness
    auth.setIngest(async () => ({ stored: true }));
  });

  await test('boundary invariant: local authority, backend projection only', () => {
    const b = auth.assertLocalAuthority();
    assert.strictEqual(b.localAuthority, true);
    assert.strictEqual(b.backendProjection, true);
    assert.strictEqual(b.directBackendWrite, false);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
