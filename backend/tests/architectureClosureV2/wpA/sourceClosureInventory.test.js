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

test('A0 baseline pins the approved governance head and recorded RED scope', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  assert.equal(baseline.parentGovernanceHead, 'd81599d8a3f3de891da369b6f1ddbd01e264c78d');
  assert.equal(baseline.authorizedBranch, 'acv2/wp-a-identity-ledger-write-host');
  assert.equal(baseline.a0ProductionBusinessCodeChanged, false);
  assert.equal(baseline.governanceInfrastructureChangeAllowed, true);
  assert.equal(baseline.redEvidenceRequiredBeforeProductionCode, true);
  assert.equal(baseline.redEvidenceSatisfied, true);
  assert.equal(baseline.currentAuthorizedTask, 'A1_INTRODUCE_SCHEMA_21_AND_PERSISTENT_AUTHORITY_WRITE_HOST_LEASE');
  assert.deepEqual(baseline.a0ChangedFileAllowlist, [
    'governance/architecture-closure-v2/wp-a-baseline.json',
    'governance/architecture-closure-v2/wp-a-branch-policy-amendment.json',
    'governance/architecture-closure-v2/wp-a-a0-red-evidence.json',
    'governance/architecture-closure-v2/authority-registry.json',
    'tools/architecture-closure-v2/source-closure-scan.js',
    'backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js',
    'shared/release/implementationBranchPolicy.js',
    'tools/wp0/lib.js',
    'tests/wp0/implementation-branch-policy.test.js',
    'package.json'
  ]);

  const evidence = readJson(baseline.validRedEvidence.document);
  assert.equal(evidence.status, 'VALID_RED_RECORDED');
  assert.equal(evidence.redHead, baseline.validRedEvidence.head);
  assert.equal(evidence.workflow.runId, baseline.validRedEvidence.workflowRunId);
  assert.equal(evidence.workflow.wp0JobId, baseline.validRedEvidence.workflowJobId);
  assert.equal(evidence.productionBusinessCodeChanged, false);
  assert.deepEqual(evidence.requiredViolationClassesSatisfied, baseline.requiredRedViolationClasses);
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

test('WP-A source closure remains blocked until the recorded root violations are removed', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  const report = scanner.scanRegisteredSources({ wp: 'A' });
  for (const violationClass of baseline.requiredRedViolationClasses) {
    assert.ok(report.counts[violationClass] > 0, `RED baseline must capture ${violationClass}`);
  }
  assert.equal(
    report.ok,
    true,
    `WP-A A0 expected RED before production code. ${JSON.stringify({ counts: report.counts, violations: report.violations.slice(0, 20) }, null, 2)}`
  );
});
