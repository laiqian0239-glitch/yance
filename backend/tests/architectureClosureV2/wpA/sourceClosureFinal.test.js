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

test('A8 closes every registered and unregistered WP-A primary SQLite authority violation', () => {
  const report = scanner.scanRegisteredSources({ wp: 'A' });

  assert.ok(report.scannedSourceFiles > 0, 'A8 must scan the real backend source tree');
  assert.equal(report.counts.REGISTRY_INVALID || 0, 0, 'registry and scanner configuration must remain valid');
  assert.deepEqual(report.violations, [], JSON.stringify(report.violations, null, 2));
  assert.equal(report.violationCount, 0);
  assert.deepEqual(report.counts, {});
  assert.equal(report.ok, true);
});

test('A8 closes each WP-A registry entry without weakening discovery or source markers', () => {
  const baseline = readJson(scanner.BASELINE_PATH);
  const registry = readJson(scanner.REGISTRY_PATH);
  const config = scanner.sourceClosureConfig(baseline);
  const wpAEntries = registry.entries.filter(entry => entry.blockingWorkPackage === 'WP-A');

  assert.deepEqual(config.discoveryRoots, ['backend']);
  assert.deepEqual(config.discoveryExcludes, ['backend/tests', 'backend/migrations']);
  assert.equal(config.registryInvalidAllowed, false);
  assert.equal(config.unregisteredPrimaryDbAccessAllowed, false);
  assert.ok(wpAEntries.length > 0);
  assert.equal(
    wpAEntries.every(entry => entry.closureState === 'CLOSED'),
    true,
    JSON.stringify(wpAEntries.filter(entry => entry.closureState !== 'CLOSED').map(entry => ({
      id: entry.id,
      path: entry.path,
      closureState: entry.closureState
    })), null, 2)
  );
  for (const entry of wpAEntries) {
    assert.ok(entry.requiredSourceMarkers.length > 0, `${entry.id} must retain executable source ownership markers`);
    assert.ok(entry.removalCondition, `${entry.id} must retain a removal condition`);
  }
});
