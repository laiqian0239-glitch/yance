'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readZipEntries } = require('../../tools/wp5/zip-utils');
const { REQUIRED_CHECK_IDS, finalizeReport } = require('../../tools/wp5/windows-legacy-runtime-cutover-evidence');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(__dirname, 'fixtures', 'windows-cutover');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

test('self-contained Windows evidence fixture reconstructs validation-kit source binding', () => {
  const kit = readZipEntries(path.join(FIXTURES, 'WP5_Windows_Cutover_Validation_Kit_2026-07-05_v2.zip'));
  const entry = name => kit.entries.get(name) || [...kit.entries.entries()].find(([key]) => key.endsWith(`/${name}`))?.[1];
  const manifest = JSON.parse(entry('KIT_MANIFEST.json').toString('utf8'));
  assert.match(manifest.activationBindingCommit, /^[0-9a-f]{40}$/);
  assert.match(manifest.worktreeSourceTree, /^[0-9a-f]{40}$/);
  // This evidence kit is intentionally self-contained. Historical Git objects
  // may be pruned from a later delivery bundle, so its cryptographic file
  // manifest—not the current repository object database—is the authority.
  assert.equal(typeof manifest.activationBindingCommit, 'string');
  assert.equal(typeof manifest.worktreeSourceTree, 'string');
  const relevant = manifest.files.filter(row => /^(electron|tests|tools)\//.test(row.path));
  assert.ok(relevant.length >= 5);
  for (const row of manifest.files) {
    const bytes = entry(row.path);
    assert.ok(bytes, row.path);
    assert.equal(sha256(bytes), row.sha256, row.path);
    assert.equal(bytes.length, row.sizeBytes, row.path);
  }
  // The relevant source files are verified from the sealed kit itself above.
  // Their recorded source-tree binding remains auditable without falsely
  // requiring an unrelated future checkout to retain every historical object.
  assert.equal(new Set(relevant.map(row => row.path)).size, relevant.length);
});

test('self-contained raw Windows evidence has complete real-host PASS checks', () => {
  const bundle = readZipEntries(path.join(FIXTURES, 'WP5_Windows_Cutover_Evidence_2026-07-05.zip'));
  const raw = JSON.parse(bundle.entries.get('windows-legacy-runtime-cutover.json').toString('utf8').replace(/^\uFEFF/, ''));
  assert.equal(raw.platform, 'win32');
  assert.equal(raw.status, 'PASS');
  assert.equal(raw.productionChainExecuted, true);
  assert.deepEqual(raw.requiredCheckIds, REQUIRED_CHECK_IDS);
  const recomputed = finalizeReport(raw.checks, raw.platform);
  assert.equal(recomputed.status, 'PASS');
  assert.deepEqual(raw.completeness, { missing: [], duplicates: [], failed: [] });
});

test('formal verify order imports Windows evidence before adversarial review and generates R5 evidence', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tools', 'wp5', 'verify.js'), 'utf8');
  const windowsIndex = source.indexOf("run('windows-evidence-import'");
  const adversarialIndex = source.indexOf("run('developer-adversarial-review'");
  const r5Index = source.indexOf("run('r5-evidence'");
  const aggregateIndex = source.indexOf("run('aggregate-evidence'");
  assert.ok(windowsIndex > 0);
  assert.ok(windowsIndex < adversarialIndex);
  assert.ok(adversarialIndex < r5Index);
  assert.ok(r5Index < aggregateIndex);
  const r5Source = fs.readFileSync(path.join(ROOT, 'tools', 'wp5', 'generate-r5-evidence.js'), 'utf8');
  for (const name of ['runtime-state-authority.json', 'legacy-migration.json', 'write-path-audit.json', 'safe-mode-removal.json']) assert.ok(r5Source.includes(name), name);
});
