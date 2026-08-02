'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { RuntimeAuthorityCommandGateway } = require('../../../runtime/AppRuntimeComposition');

function commandHandlers() {
  return Object.freeze(Object.assign(Object.create(null), {
    'startup.noop': () => ({ ok: true })
  }));
}

function withAuthorityStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a6-gateway-surface-'));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a6-gateway-surface-host' });
  const broker = new SqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: host.capability
  });
  const authorityStore = broker.open();
  try {
    return callback({ host, authorityStore });
  } finally {
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('startup gateway surface cannot be shadowed to forge readiness evidence', () => {
  withAuthorityStore(({ host, authorityStore }) => {
    const gateway = new RuntimeAuthorityCommandGateway({
      runtime: { snapshot: () => ({ stateVersion: 1 }) },
      authorityWriteHostCapability: host.capability,
      authorityStore,
      commandHandlers: commandHandlers()
    });

    assert.equal(Object.isFrozen(gateway), true, 'gateway instance must reject own-property method shadowing');
    assert.equal(Object.isFrozen(Object.getPrototypeOf(gateway)), true, 'gateway prototype must reject process-wide method replacement');
    assert.throws(
      () => Object.defineProperty(gateway, 'snapshot', { value: () => ({ state: 'sealed' }) }),
      TypeError
    );
    assert.throws(
      () => Object.defineProperty(gateway, 'assertCanonicalBinding', { value: () => ({ bound: true }) }),
      TypeError
    );

    assert.equal(gateway.snapshot().state, 'open');
    gateway.seal();
    assert.equal(gateway.snapshot().state, 'sealed');
  });
});
