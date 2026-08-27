'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const gov = require('../../electron/m2/nativeBinaryGovernance');

const NODE22 = Object.freeze({
  version: 'v22.16.0',
  moduleVersion: 127,
  platform: 'win32',
  arch: 'x64'
});

function isThenable(value) {
  return Boolean(value && typeof value.then === 'function');
}

test('V21 P0 runtime-node governance probe is asynchronous and leaves the event loop live', async () => {
  let releaseProbe;
  let observedOptions = null;
  const pendingProbe = new Promise(resolve => {
    releaseProbe = resolve;
  });

  const probe = gov.probeRuntimeNode({
    nodeExePath: 'C:/Yance/resources/runtime/node22/node.exe',
    timeout: 50,
    runNode: (_nodeExePath, options) => {
      observedOptions = options;
      return pendingProbe;
    }
  });

  assert.equal(isThenable(probe), true, 'a pending runtime-node probe must return a Promise instead of synchronously consuming the result');
  assert.equal(observedOptions?.timeout, 50, 'the injectable runtime-node probe must receive the bounded timeout contract');

  let heartbeat = false;
  await new Promise(resolve => setImmediate(() => {
    heartbeat = true;
    resolve();
  }));
  assert.equal(heartbeat, true, 'Electron-equivalent event-loop work must run while the governance probe is pending');

  releaseProbe(NODE22);
  const result = await probe;
  assert.equal(result.ok, true);
  assert.equal(result.nodeVersion, '22.16.0');
  assert.equal(result.moduleVersion, 127);
});

test('V21 P0 boot-reachable native governance contains no synchronous child wait and main consumes it asynchronously', () => {
  const nativeSource = fs.readFileSync(path.join(ROOT, 'electron', 'm2', 'nativeBinaryGovernance.js'), 'utf8');
  assert.doesNotMatch(
    nativeSource,
    /\b(?:spawnSync|execSync|execFileSync)\b|\bAtomics\.wait\b/u,
    'boot-reachable native governance must not contain a synchronous child-process or Atomics wait primitive'
  );
  assert.match(nativeSource, /\b(?:spawn|execFile)\b/u, 'native governance must use a nonblocking Node child-process API');
  assert.match(nativeSource, /\btimeout\b/u, 'native governance child execution must remain bounded by a timeout');

  const mainSource = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const marker = 'governRuntimeNativeBinariesBootCheck()';
  const markerIndex = mainSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'main boot governance function must remain present');
  const functionStart = mainSource.lastIndexOf('\n', markerIndex) + 1;
  const functionEnd = mainSource.indexOf('\n}\n\nconst YANCE_BACKEND_URL', markerIndex);
  assert.notEqual(functionEnd, -1, 'main boot governance function boundary must remain discoverable');
  const bootSource = mainSource.slice(functionStart, functionEnd + 2);
  assert.match(bootSource, /async\s+function\s+governRuntimeNativeBinariesBootCheck\s*\(\)/u, 'boot governance wrapper must be asynchronous');
  assert.match(bootSource, /await\s+govern\.governRuntimeNodeNativeBinaries\s*\(/u, 'main must asynchronously consume the runtime-node governance result');
});
