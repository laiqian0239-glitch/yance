'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeArtifactRegistryService, defaultDocument } = require('../services/runtimeArtifactRegistryService');

class MemoryStore {
  constructor() { this.value = defaultDocument(); }
  read() { return structuredClone(this.value); }
  async updateAsync(updater) { this.value = await updater(structuredClone(this.value)); return this.read(); }
}
function makeArtifact(root, name, content) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ name, content }));
  fs.writeFileSync(path.join(directory, 'bundle.js'), content);
  return directory;
}

test('artifact candidate requires verified health before promotion and preserves last-known-good for rollback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-artifact-'));
  const pointerPath = path.join(root, 'selection.json');
  const service = new RuntimeArtifactRegistryService({ store: new MemoryStore(), pointerPath, clock: () => '2026-07-25T00:00:00.000Z' });
  try {
    const v1 = await service.registerCandidate({ type: 'frontend-static', rootPath: makeArtifact(root, 'v1', 'version-one'), version: '1' });
    await assert.rejects(service.promoteCandidate(v1.artifactId, { pass: false, checks: [{ id: 'render', critical: true, pass: false }] }), error => error.code === 'ARTIFACT_HEALTH_GATE_FAILED');
    await service.promoteCandidate(v1.artifactId, { pass: true, checks: [{ id: 'render', critical: true, pass: true }] });

    const v2 = await service.registerCandidate({ type: 'frontend-static', rootPath: makeArtifact(root, 'v2', 'version-two'), version: '2' });
    await service.promoteCandidate(v2.artifactId, { pass: true, checks: [{ id: 'themes-29', critical: true, pass: true }, { id: 'conversation', critical: true, pass: true }] });
    const beforeRollback = service.snapshot();
    assert.equal(beforeRollback.current['frontend-static'].artifactId, v2.artifactId);
    assert.equal(beforeRollback.lastKnownGood['frontend-static'].artifactId, v1.artifactId);

    const rollback = await service.rollback('frontend-static', { reason: 'theme-regression' });
    assert.equal(rollback.current.artifactId, v1.artifactId);
    assert.equal(rollback.pendingApply.action, 'rollback');
    assert.equal(JSON.parse(fs.readFileSync(pointerPath, 'utf8')).current['frontend-static'].artifactId, v1.artifactId);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('artifact hash changes after registration are blocked before promotion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-artifact-hash-'));
  const store = new MemoryStore();
  const service = new RuntimeArtifactRegistryService({ store, pointerPath: path.join(root, 'selection.json') });
  try {
    const directory = makeArtifact(root, 'candidate', 'stable');
    const row = await service.registerCandidate({ type: 'ai-routing', rootPath: directory, version: '1' });
    fs.writeFileSync(path.join(directory, 'bundle.js'), 'modified-after-registration');
    await assert.rejects(service.promoteCandidate(row.artifactId, { pass: true, checks: [] }), error => error.code === 'ARTIFACT_CHANGED_AFTER_REGISTRATION');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('runtime current registration is idempotent and preserves the prior observed artifact as last-known-good', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-artifact-current-'));
  const service = new RuntimeArtifactRegistryService({ store: new MemoryStore(), pointerPath: path.join(root, 'selection.json'), clock: () => '2026-07-25T01:00:00.000Z' });
  try {
    const firstPath = makeArtifact(root, 'runtime-v1', 'runtime-one');
    const first = await service.registerCurrent({ type: 'application', rootPath: firstPath, version: '1', releaseId: 'build-1' });
    assert.equal(first.changed, true);
    assert.equal(service.snapshot().current.application.version, '1');
    assert.equal(service.snapshot().lastKnownGood.application, undefined);

    const same = await service.registerCurrent({ type: 'application', rootPath: firstPath, version: '1', releaseId: 'build-1' });
    assert.equal(same.changed, false);
    assert.equal(service.snapshot().history.filter(row => row.action === 'runtime-current-registered').length, 1);

    const secondPath = makeArtifact(root, 'runtime-v2', 'runtime-two');
    const second = await service.registerCurrent({ type: 'application', rootPath: secondPath, version: '2', releaseId: 'build-2' });
    assert.equal(second.changed, true);
    assert.equal(service.snapshot().current.application.version, '2');
    assert.equal(service.snapshot().lastKnownGood.application.version, '1');
    assert.equal(service.snapshot().pendingApply.application, undefined, 'observing the already-running artifact must not create an apply request');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
