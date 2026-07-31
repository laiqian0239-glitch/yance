'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'windows-network-isolation-smoke.ps1'), 'utf8');

test('Windows isolation smoke requires admin VM checkpoint and explicit destructive acknowledgement', () => {
  assert.match(source, /WindowsBuiltInRole\]::Administrator/);
  assert.match(source, /CheckpointConfirmed/);
  assert.match(source, /IUnderstandThisDisablesAllVisibleAdapters/);
  assert.match(source, /Microsoft Corporation/);
  assert.match(source, /Virtual Machine/);
});

test('Windows isolation smoke uses trusted Node 22.16.0 and first-party hash-bound CLI', () => {
  assert.match(source, /v22\.16\.0/);
  assert.match(source, /windows-network-isolation-control-cli\.js/);
  assert.match(source, /--session-sha256/);
  assert.match(source, /--attestation-sha256/);
  assert.match(source, /finally\s*\{/);
});

test('Windows isolation smoke verifies disable and exact restore postconditions', () => {
  assert.match(source, /adapters-after-disable\.json/);
  assert.match(source, /routes-after-disable\.json/);
  assert.match(source, /adapters-after-restore\.json/);
  assert.match(source, /routes-after-restore\.json/);
  assert.match(source, /\[int\] \$Route\.routeMetric/);
  assert.match(source, /\[string\] \$Route\.protocol/);
  assert.match(source, /formalReleaseEvidence = \$false/);
});
