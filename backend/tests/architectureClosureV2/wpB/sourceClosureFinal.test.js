'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  scanRegisteredSources
} = require('../../../../tools/architecture-closure-v2/source-closure-scan');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const baselinePath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-source-closure-baseline.json'
);
const inventoryPath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-operation-inventory.json'
);
const EXPECTED_AUTHORIZATION_HEAD = '9977e081abcaf3dfe1a7b5a309b872b0a4660114';
const EXPECTED_M2_EVIDENCE_HEAD = '9f82377119e16f8e02d3b83f0795b452e36f769e';
const COUNTERS = Object.freeze([
  ['M3-SC-003', 'violationCount'],
  ['M3-SC-004', 'legacyCallablePathCount'],
  ['M3-SC-005', 'directExternalCallOutsideAdapterCount'],
  ['M3-SC-006', 'blindRetryPathCount'],
  ['M3-SC-007', 'legacyWriterPathCount'],
  ['M3-SC-008', 'legacyRecoveryPathCount'],
  ['M3-SC-009', 'timerOrReconnectAuthorityPathCount'],
  ['M3-SC-010', 'unregisteredSourcePathCount']
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCombinedInventory() {
  const baseline = readJson(baselinePath);
  const base = readJson(inventoryPath);
  const entries = [...(base.entries || [])];
  for (const relativePath of baseline.operationInventoryExtensionPaths || []) {
    entries.push(...(readJson(path.join(repoRoot, relativePath)).entries || []));
  }
  return { ...base, entries };
}

function scan() {
  return scanRegisteredSources({ wp: 'B' });
}

test('M3-SC-001 WP-B source-closure baseline is exact and keeps downstream authority closed', () => {
  const baseline = readJson(baselinePath);
  assert.equal(baseline.schemaVersion, 1, 'M3-SC-001');
  assert.equal(baseline.documentType, 'YANCE_ACV2_WP_B_SOURCE_CLOSURE_BASELINE', 'M3-SC-001');
  assert.equal(baseline.repository, 'laiqian0239-glitch/yance', 'M3-SC-001');
  assert.equal(baseline.workPackage, 'WP-B', 'M3-SC-001');
  assert.equal(baseline.status, 'FROZEN_FOR_CREDIBLE_RED', 'M3-SC-001');
  assert.equal(baseline.authorizationHead, EXPECTED_AUTHORIZATION_HEAD, 'M3-SC-001');
  assert.equal(baseline.parentMilestone2EvidenceHead, EXPECTED_M2_EVIDENCE_HEAD, 'M3-SC-001');
  assert.deepEqual(baseline.discovery.roots, ['backend', 'electron', 'services', 'shared/release'], 'M3-SC-001');
  assert.deepEqual(
    baseline.operationInventoryExtensionPaths,
    ['governance/architecture-closure-v2/wp-b-operation-inventory-m3-extension.json'],
    'M3-SC-001'
  );
  assert.equal(baseline.governance.exactPathsOnly, true, 'M3-SC-001');
  assert.equal(baseline.governance.wildcardPathsAllowed, false, 'M3-SC-001');
  for (const field of [
    'temporaryBypassAllowed',
    'warningOnlyClosureAllowed',
    'readyForPromotion',
    'mergeAuthorized',
    'productionUseAuthorized',
    'wpCAuthorized',
    'formalRelease',
    'publish'
  ]) assert.equal(baseline.governance[field], false, `M3-SC-001:${field}`);
});

test('M3-SC-002 scanner selects the dedicated durable-operation WP-B mode', () => {
  const report = scan();
  assert.equal(report.workPackage, 'WP-B', 'M3-SC-002');
  assert.equal(report.mode, 'DURABLE_OPERATION_SOURCE_CLOSURE', 'M3-SC-002');
  assert.equal(report.baselinePath, 'governance/architecture-closure-v2/wp-b-source-closure-baseline.json', 'M3-SC-002');
  assert.equal(report.registryPath, 'governance/architecture-closure-v2/wp-b-operation-inventory.json', 'M3-SC-002');
  assert.deepEqual(
    report.inventoryExtensionPaths,
    ['governance/architecture-closure-v2/wp-b-operation-inventory-m3-extension.json'],
    'M3-SC-002'
  );
  assert.equal(report.registryExtensionEntries, 1, 'M3-SC-002');
});

for (const [id, field] of COUNTERS) {
  test(`${id} final WP-B source-closure counter ${field} is zero`, () => {
    const report = scan();
    assert.equal(Number.isSafeInteger(report[field]), true, `${id}:${field}:INTEGER_REQUIRED`);
    assert.equal(report[field], 0, `${id}:${field}`);
  });
}

test('M3-SC-011 every production inventory row has one valid terminal closure state', () => {
  const baseline = readJson(baselinePath);
  const inventory = readCombinedInventory();
  const allowed = new Set(baseline.productionTerminalStates);
  const open = inventory.entries
    .filter(entry => entry.classification !== 'NON_PRODUCTION_HARNESS')
    .filter(entry => !allowed.has(entry.closureState))
    .map(entry => `${entry.id}:${entry.path}:${entry.closureState}`)
    .sort();
  assert.deepEqual(open, [], `M3-SC-011:${open.join(',')}`);
});

test('M3-SC-012 inventory and scanner both declare discovery complete', () => {
  const inventory = readJson(inventoryPath);
  const report = scan();
  assert.equal(inventory.closure?.discoveryComplete, true, 'M3-SC-012:INVENTORY');
  assert.equal(report.discoveryComplete, true, 'M3-SC-012:REPORT');
});
