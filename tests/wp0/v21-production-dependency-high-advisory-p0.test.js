'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8'));
}

function versionAtLeast(version, floor) {
  if (typeof version !== 'string') return false;
  const actual = version.split('.').map(Number);
  const required = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((actual[i] || 0) > (required[i] || 0)) return true;
    if ((actual[i] || 0) < (required[i] || 0)) return false;
  }
  return true;
}

test('Letta keeps its reviewed parents while sharp crosses the High advisory boundary', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.equal(pkg.dependencies['@letta-ai/letta-agent-sdk'], '0.6.2');
  assert.equal(pkg.dependencies['@letta-ai/letta-code'], '0.30.5');
  assert.equal(lock.packages['node_modules/@letta-ai/letta-agent-sdk'].version, '0.6.2');
  assert.equal(lock.packages['node_modules/@letta-ai/letta-code'].version, '0.30.5');

  const scopedOverride = pkg.overrides?.['@letta-ai/letta-code']?.sharp ?? null;
  const nestedSharp = lock.packages['node_modules/@letta-ai/letta-code/node_modules/sharp']?.version ?? null;
  const rootSharp = lock.packages['node_modules/sharp']?.version ?? null;

  assert.deepEqual(
    {
      scopedOverride,
      rootSharp,
      nestedSharpSafe: nestedSharp === null || versionAtLeast(nestedSharp, '0.35.0')
    },
    {
      scopedOverride: '0.35.3',
      rootSharp: '0.35.3',
      nestedSharpSafe: true
    },
    'GHSA-f88m-g3jw-g9cj requires the Letta Code runtime graph to contain no sharp <0.35.0 while preserving the reviewed Letta parents'
  );
});

test('Letta MCP graph resolves ip-address beyond the High advisory boundary without parent churn', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.equal(pkg.dependencies['@letta-ai/letta-code'], '0.30.5');
  assert.equal(lock.packages['node_modules/@letta-ai/letta-code'].version, '0.30.5');
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.30.0');
  assert.equal(
    lock.packages['node_modules/ip-address'].version,
    '10.3.1',
    'GHSA-mwp4-54f8-5fhr affects ip-address <=10.3.0; the existing compatible graph must resolve exact 10.3.1'
  );
});

test('electron-updater keeps its reviewed parent while js-yaml crosses the High advisory boundary', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.equal(lock.packages['node_modules/electron-updater'].version, '6.8.9');
  assert.equal(
    lock.packages['node_modules/js-yaml'].version,
    '4.3.1',
    'GHSA-5p4m-2wfm-xmqj affects js-yaml >=4.0.0 <4.3.1; the existing compatible graph must resolve exact 4.3.1'
  );
});