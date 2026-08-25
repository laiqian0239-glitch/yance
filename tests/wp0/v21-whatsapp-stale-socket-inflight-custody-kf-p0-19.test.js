'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  createSessionGenerationFence,
  createSocketGenerationGuard
} = require('../../backend/services/sessionGenerationFence');

const ROOT = path.resolve(__dirname, '../..');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('KF-P0-19 session generation fence drains guarded async work before replacement may proceed', async () => {
  const fence = createSessionGenerationFence(() => true, { prefix: 'whatsapp:kf-p0-19' });
  const guard = createSocketGenerationGuard(fence, () => true);
  const started = deferred();
  const release = deferred();
  let completed = false;

  const pending = guard.wrap(async () => {
    started.resolve();
    await release.promise;
    completed = true;
  })();
  await started.promise;
  fence.invalidate('WHATSAPP_STOP');

  try {
    assert.equal(typeof fence.drain, 'function', 'session generation fence must expose an in-flight drain boundary');
    let drained = false;
    const draining = Promise.resolve(fence.drain()).then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false, 'drain must not resolve while an old guarded async callback remains in flight');
    release.resolve();
    await pending;
    await draining;
    assert.equal(completed, true);
  } finally {
    release.resolve();
    await pending;
  }
});

test('KF-P0-19 WhatsApp stop invalidates then drains old socket handlers before replacement generation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend/services/whatsappAdapter.js'), 'utf8');
  const credsStart = source.indexOf("onSocket('creds.update'");
  assert.ok(credsStart >= 0, 'creds.update must remain registered through the guarded socket binder');
  const credsSlice = source.slice(credsStart, source.indexOf("onSocket('connection.update'", credsStart));
  assert.match(credsSlice, /await\s+saveCreds\(update\)/u, 'diagnostic must stay bound to the real asynchronous Baileys credential persistence seam');

  const stopStart = source.indexOf('  async stop(');
  const restartStart = source.indexOf('  async restart(', stopStart);
  assert.ok(stopStart >= 0 && restartStart > stopStart, 'WhatsApp stop/restart lifecycle boundary must exist');
  const stopSource = source.slice(stopStart, restartStart);
  const invalidateIndex = stopSource.indexOf('sessionFence?.invalidate');
  const drainIndex = stopSource.search(/await[\s\S]{0,100}sessionFence[\s\S]{0,80}drain/u);
  const deleteIndex = stopSource.indexOf('this.accounts.delete(accountId)');
  assert.ok(invalidateIndex >= 0, 'stop must invalidate the old session generation');
  assert.ok(drainIndex > invalidateIndex, 'stop must await old guarded in-flight work after invalidation');
  assert.ok(deleteIndex < 0 || drainIndex < deleteIndex, 'old generation must quiesce before its active row is retired and restart can replace it');
});

test('KF-P0-19 preserves existing batch39 entry-time stale callback quarantine contracts', () => {
  const contract = path.join(ROOT, 'backend/tests/batch39WhatsappSessionFence.test.js');
  const run = spawnSync(process.execPath, ['--test', contract], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });
  assert.equal(run.status, 0, `${run.stdout || ''}\n${run.stderr || ''}`);
});
