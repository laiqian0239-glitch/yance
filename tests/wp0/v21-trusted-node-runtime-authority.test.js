'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const nodeIdentity = read('tools/wp7/node-runtime-identity.js');
const builderPs = read('tools/wp7/RUN_WINDOWS_FINAL_BUILDER.ps1');
const builderJs = read('tools/wp7/run-windows-final-builder.js');
const wp7Lib = read('tools/wp7/lib.js');
const networkSmoke = read('tools/wp7/windows-network-isolation-smoke.ps1');
const electronMain = read('electron/main.js');

function numericVersion(value) {
  return String(value || '').replace(/^v/u, '').split('.').map(part => Number.parseInt(part, 10));
}

function versionAtLeast(actual, minimum) {
  const left = numericVersion(actual);
  const right = numericVersion(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a !== b) return a > b;
  }
  return true;
}

test('packaged trusted Node authority is exactly 22.23.1 and satisfies repository floor', () => {
  assert.equal(packageJson.engines?.node, '>=22.19.0');
  assert.equal(versionAtLeast('22.23.1', '22.19.0'), true);
  assert.match(nodeIdentity, /const REQUIRED_NODE_VERSION = '22\.23\.1';/u);
  assert.doesNotMatch(nodeIdentity, /REQUIRED_NODE_VERSION = '22\.16\.0'/u);
});

test('Windows Final Builder separates build-host Node npm custody from embedded trusted runtime', () => {
  assert.match(builderPs, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$TrustedNodeExecutable/u);
  assert.match(builderPs, /--trusted-node-executable/u);
  assert.match(builderPs, /\$TrustedNodeExecutable/u);
  assert.match(builderJs, /'trusted-node-executable'/u);
  assert.match(builderJs, /trustedNodeExecutable:\s*args\['trusted-node-executable'\]/u);
  assert.match(builderJs, /trustedNodeExecutable:\s*path\.resolve\(options\.trustedNodeExecutable\)/u);
  assert.doesNotMatch(builderJs, /trustedNodeExecutable:\s*process\.execPath/u);
});

test('packaged runtime evidence and Windows isolation converge on Node 22.23.1', () => {
  assert.match(wp7Lib, /nodeRuntimeVersion[\s\S]{0,300}22\.23\.1/u);
  assert.match(networkSmoke, /version -ne 'v22\.23\.1'/u);
  assert.doesNotMatch(networkSmoke, /version -ne 'v22\.16\.0'/u);
});

test('packaged Electron retains one resources runtime node22 resolver and no Product-specific Node path', () => {
  assert.match(electronMain, /function resolveTrustedNodeRuntime\(\)/u);
  assert.match(electronMain, /resources[^\n]{0,160}runtime[^\n]{0,80}node22/u);
  assert.match(electronMain, /nodeExecutablePath:\s*resolveTrustedNodeRuntime\(\)/u);
  assert.doesNotMatch(electronMain, /product[-_ ]experience[^\n]{0,120}node(?:\.exe)?/iu);
});
