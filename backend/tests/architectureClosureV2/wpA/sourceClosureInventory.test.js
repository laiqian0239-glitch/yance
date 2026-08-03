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

function taskNumber(value) {
  const match = /^A([0-8])_/.exec(String(value || ''));
  return match ? Number(match[1]) : -1;
}

test('A0 evidence remains immutable while current task authorization advances monotonically', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  const config = scanner.sourceClosureConfig(baseline);
  assert.equal(baseline.parentGovernanceHead, 'd81599d8a3f3de891da369b6f1ddbd01e264c78d');
  assert.equal(baseline.authorizedBranch, 'acv2/wp-a-identity-ledger-write-host');
  assert.equal(baseline.a0.status, 'CLOSED');

  const currentIndex = taskNumber(baseline.currentAuthorizedTask);
  assert.ok(currentIndex >= 1, `unknown current task ${baseline.currentAuthorizedTask}`);
  for (const completed of baseline.completedTasks || []) {
    const completedIndex = taskNumber(completed);
    assert.ok(
      completedIndex >= 0 && completedIndex <= currentIndex,
      `completed task is after current authorization: ${completed}`
    );
  }
  for (const reopened of baseline.reopenedTasks || []) {
    const reopenedIndex = taskNumber(reopened);
    assert.ok(
      reopenedIndex >= 1 && reopenedIndex <= currentIndex,
      `reopened task is outside current authorization: ${reopened}`
    );
  }

  if (currentIndex === 3) {
    assert.equal(baseline.a3?.status, 'REOPENED_BY_INDEPENDENT_REVIEW_RED');
    assert.equal(baseline.a3?.rootRepairAuthorized, true);
    assert.equal(baseline.a3?.reviewRedEvidence?.implementationStartConditionSatisfied, true);
    assert.equal(baseline.a3?.greenEvidenceRequired, true);
    assert.equal(baseline.a3?.independentSourceReviewRequired, true);
    assert.equal(
      baseline.productionCodeScope,
      'WP_A_A1_SCHEMA_FOUNDATION_AND_A3_COORDINATOR_ONLY'
    );
    assert.ok(
      baseline.reviewRepairAllowedFiles.includes('backend/services/authorityTransactionCoordinator.js')
    );
    assert.ok(baseline.lockedTasks.includes('A4'));
  }

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
    assert.equal(
      pathOwners.has(entry.path),
      false,
      `${entry.path} cannot be both an authority writer and a compatibility projector`
    );
    pathOwners.set(entry.path, entry.classification);
  }
});

test('WP-B extends the frozen registry with one exact AuthorityWriteHost Engine source', () => {
  assert.deepEqual(scanner.REGISTRY_EXTENSION_PATHS, [
    'governance/architecture-closure-v2/wp-b-authority-registry-extension.json'
  ]);
  const extensions = scanner.loadRegistryExtensions();
  assert.equal(extensions.length, 1);
  assert.deepEqual(scanner.validateRegistryExtension(extensions[0].document, extensions[0].path), []);
  const extension = extensions[0].document;
  assert.equal(extension.workPackage, 'WP-B');
  assert.equal(extension.status, 'ACTIVE_IMPLEMENTATION');
  assert.deepEqual(extension.entries, [
    {
      registryId: 'WP-B-A0-R32-STORE-ENGINE',
      sourcePath: 'backend/lib/r32SqliteStoreEngine.js',
      authoritativeOwner: 'AuthorityWriteHost',
      classification: 'REGISTERED_INTERNAL_AUTHORITY_SOURCE',
      allowedCapabilities: ['PRIMARY_DB_CONSTRUCTOR'],
      publicEntryPoint: 'backend/lib/r32SqliteStore.js',
      temporaryBypassAllowed: false
    }
  ]);
  assert.equal(extension.governance.exactPathsOnly, true);
  assert.equal(extension.governance.wildcardPathsAllowed, false);
  assert.equal(extension.governance.temporaryBypassAllowed, false);
  assert.equal(extension.governance.warningOnlyAllowed, false);
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

test('WP-A source closure report is globally closed across frozen and active registry layers', () => {
  const report = scanner.scanRegisteredSources({ wp: 'A' });
  assert.equal(report.schemaVersion, 3);
  assert.ok(report.scannedSourceFiles > 0, 'source closure must scan real backend source files');
  assert.equal(report.registryEntries, 11);
  assert.equal(report.registryExtensionEntries, 1);
  assert.equal(report.totalRegisteredSourcePaths, 12);
  assert.equal(report.counts.REGISTRY_INVALID || 0, 0, 'governance registry/configuration must remain valid');
  assert.deepEqual(report.violations, []);
  assert.equal(report.violationCount, 0);
  assert.deepEqual(report.counts, {});
  assert.equal(report.ok, true);
});
