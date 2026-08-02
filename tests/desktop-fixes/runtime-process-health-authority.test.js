'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadAuthority() {
  let authority;
  assert.doesNotThrow(() => {
    authority = require('../../electron/runtimeProcessHealthAuthority');
  }, 'runtime process health authority must exist');
  return authority;
}

test('network utility crash is recoverable and requests network-dependent state rehydration', () => {
  const authority = loadAuthority();
  const result = authority.classifyChildProcessGone({
    type: 'Utility',
    serviceName: 'network.mojom.NetworkService',
    reason: 'crashed',
    exitCode: 1
  });
  assert.equal(result.reasonCode, 'NETWORK_SERVICE_PROCESS_CRASHED');
  assert.equal(result.recoverable, true);
  assert.equal(result.fatal, false);
  assert.equal(result.scope, 'network-service');
  assert.equal(result.recoveryAction, 'rehydrate-network-dependent-state');
});

test('renderer process loss remains fatal and is not confused with a network utility restart', () => {
  const authority = loadAuthority();
  const result = authority.classifyChildProcessGone({
    type: 'Renderer',
    serviceName: '',
    reason: 'crashed',
    exitCode: 139
  });
  assert.equal(result.reasonCode, 'RENDERER_PROCESS_CRASHED');
  assert.equal(result.fatal, true);
  assert.equal(result.recoverable, false);
  assert.equal(result.scope, 'renderer');
});

test('unknown child process loss remains observable without claiming automatic recovery', () => {
  const authority = loadAuthority();
  const result = authority.classifyChildProcessGone({ type: 'Utility', serviceName: 'unknown.service', reason: 'abnormal-exit', exitCode: 9 });
  assert.equal(result.reasonCode, 'CHILD_PROCESS_GONE_UNKNOWN');
  assert.equal(result.recoverable, false);
  assert.equal(result.fatal, false);
  assert.equal(result.scope, 'child-process');
});
