'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scanner = require('../../../../tools/architecture-closure-v2/source-closure-scan');
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('A0 evidence remains immutable while current task authorization advances independently', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  const config = scanner.sourceClosureConfig(baseline);
  assert.equal(baseline.parentGovernanceHead, 'd81599d8a3f3de891da369b6f1ddbd01e264c78d');
  assert.equal(baseline.authorizedBranch, 'acv2/wp-a-identity-ledger-write-host');
  assert.equal(baseline.a0.status, 'CLOSED');
  assert.equal(baseline.currentAuthorizedTask, 'A2_VERSIONED_CANONICAL_SERIALIZATION_AND_DATA_CLASSIFICATION');
  assert.equal(baseline.a2TestCodeAllowed, true);
  assert.equal(baseline.a2ProductionCodeAllowed, false);
  assert.deepEqual(config.discoveryRoots, ['backend']);
  assert.deepEqual(config.discoveryExcludes, ['backend/tests', 'backend/migrations']);

  const evidence = readJson(config.a0EvidenceDocument);
  assert.equal(evidence.status, 'VALID_RED_RECORDED');
  assert.equal(evidence.redHead, baseline.a0.redEvidence.head);
  assert.equal(evidence.workflow.runId, baseline.a0.redEvidence.workflowRunId);
  assert.equal(evidence.workflow.wp0JobId, baseline.a0.redEvidence.workflowJobId);
  assert.equal(evidence.productionBusinessCodeChanged, false);
  assert.deepEqual(evidence.requiredViolationClassesSatisfied, config.initialViolationClasses);
});

test('authority registry is complete, single-classified, and bound to real source paths', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  const registry = readJson(scanner.REGISTRY_PATH);
  const errors = scanner.validateRegistry(registry, baseline);
  assert.deepEqual(errors, []);

  const pathOwners = new Map();
  for (const entry of registry.entries) {
    assert.ok(entry.authorityOwner);
    assert.ok(entry.commandEntrypoint);
    assert.ok(entry.aggregate);
    assert.ok(entry.versionStrategy);
    assert.ok(entry.idempotencyKey);
    assert.ok(entry.receiptIssuer);
    assert.ok(entry.projection);
    assert.ok(entry.removalCondition);
    assert.ok(fs.existsSync(path.join(repoRoot, entry.path)), entry.path);
    assert.equal(pathOwners.has(entry.path), false, `${entry.path} cannot be both an authority writer and a compatibility projector`);
    pathOwners.set(entry.path, entry.classification);
  }
});

test('scanner rejects an unregistered writable primary-store acquisition', () => {
  const registry = readJson(scanner.REGISTRY_PATH);
  const violations = scanner.findUnregisteredSourceCapabilities([
    {
      path: 'backend/services/unregisteredWriter.js',
      source: "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(primaryPath);"
    }
  ], registry);
  assert.deepEqual(violations, [
    {
      violationClass: 'UNREGISTERED_PRIMARY_DB_ACCESS',
      code: 'UNREGISTERED_PRIMARY_DB_ACCESS',
      path: 'backend/services/unregisteredWriter.js',
      capabilities: ['PRIMARY_DB_CONSTRUCTOR']
    }
  ]);
});

test('WP-A source closure remains a single RED until all registered and unregistered paths close', () => {
  const report = scanner.scanRegisteredSources({ wp: 'A' });
  assert.ok(report.scannedSourceFiles > 0, 'source closure must scan real backend source files');
  assert.ok(report.violationCount > 0, 'WP-A is not yet globally closed');
  assert.equal(report.counts.REGISTRY_INVALID || 0, 0, 'governance registry/configuration must remain valid');
  assert.equal(
    report.ok,
    true,
    `WP-A source closure expected RED until A8. ${JSON.stringify({ counts: report.counts, violations: report.violations.slice(0, 20) }, null, 2)}`
  );
});
