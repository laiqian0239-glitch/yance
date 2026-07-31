'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveYanceDataRootSync, inventory } = require('../../electron/dataRootMigration');

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-brand-data-')); }


test('missing appDataPath is rejected instead of silently using the source working directory', () => {
  assert.throws(() => resolveYanceDataRootSync({ appDataPath: '' }), /appDataPath is required/);
});

test('fresh install selects the new Yance data directory', () => {
  const root = fixture();
  try {
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'NEW_INSTALL');
    assert.equal(result.dataRoot, path.join(root, 'Yance'));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('legacy data is copied, verified, atomically promoted, and retained', () => {
  const root = fixture();
  try {
    const legacy = path.join(root, 'Yance29');
    fs.mkdirSync(path.join(legacy, 'store'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'secure'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'store', 'yance-r32.db'), 'sqlite-fixture');
    fs.writeFileSync(path.join(legacy, 'desktop-settings.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(legacy, 'secure', 'credentials.safe.json'), '{"ciphertext":"fixture"}');
    const before = inventory(legacy);
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'MIGRATED');
    assert.equal(result.dataRoot, path.join(root, 'Yance'));
    assert.equal(fs.existsSync(legacy), true, 'legacy source must be retained');
    assert.deepEqual(inventory(path.join(root, 'Yance')).critical, before.critical);
    const marker = JSON.parse(fs.readFileSync(result.markerPath, 'utf8'));
    assert.equal(marker.status, 'PASS');
    assert.equal(marker.sourceRetained, true);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('identical new and legacy directories select Yance without a split-brain warning', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'Yance'));
    fs.mkdirSync(path.join(root, 'Yance29'));
    fs.writeFileSync(path.join(root, 'Yance', 'same.txt'), 'same');
    fs.writeFileSync(path.join(root, 'Yance29', 'same.txt'), 'same');
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'TARGET_AND_LEGACY_IDENTICAL');
    assert.equal(result.dataRoot, path.join(root, 'Yance'));
    assert.equal(result.requiresMigrationReview, false);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('divergent new and legacy directories never overwrite either root and require explicit review', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'Yance'));
    fs.mkdirSync(path.join(root, 'Yance29'));
    fs.writeFileSync(path.join(root, 'Yance', 'authority.txt'), 'new');
    fs.writeFileSync(path.join(root, 'Yance29', 'authority.txt'), 'legacy');
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'TARGET_AND_LEGACY_DIVERGED');
    assert.equal(result.dataRoot, path.join(root, 'Yance'));
    assert.equal(result.requiresMigrationReview, true);
    assert.equal(result.reasonCode, 'YANCE_DATA_ROOT_CONFLICT_REVIEW_REQUIRED');
    assert.equal(fs.readFileSync(path.join(root, 'Yance', 'authority.txt'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(root, 'Yance29', 'authority.txt'), 'utf8'), 'legacy');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});


test('same-size but different file contents are treated as split-brain divergence', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'Yance'));
    fs.mkdirSync(path.join(root, 'Yance29'));
    fs.writeFileSync(path.join(root, 'Yance', 'authority.txt'), 'new-one');
    fs.writeFileSync(path.join(root, 'Yance29', 'authority.txt'), 'old-one');
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'TARGET_AND_LEGACY_DIVERGED');
    assert.equal(result.requiresMigrationReview, true);
    assert.notEqual(result.targetInventory.treeSha256, result.legacyInventory.treeSha256);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('a valid migration marker prevents false split-brain warnings after the new root evolves', () => {
  const root = fixture();
  try {
    const legacy = path.join(root, 'Yance29');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"version":1}');
    const migrated = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(migrated.status, 'MIGRATED');
    fs.writeFileSync(path.join(root, 'Yance', 'settings.json'), '{"version":2}');
    const restarted = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(restarted.status, 'MIGRATED_TARGET_PRESENT');
    assert.equal(restarted.requiresMigrationReview, false);
    assert.equal(restarted.migrationMarkerState, 'VALID');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('legacy data changed after a completed migration is preserved and flagged for explicit review', () => {
  const root = fixture();
  try {
    const legacy = path.join(root, 'Yance29');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"version":1}');
    const migrated = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(migrated.status, 'MIGRATED');
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"version":2}');
    const restarted = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(restarted.status, 'MIGRATED_TARGET_LEGACY_CHANGED');
    assert.equal(restarted.dataRoot, path.join(root, 'Yance'));
    assert.equal(restarted.requiresMigrationReview, true);
    assert.equal(restarted.reasonCode, 'YANCE_LEGACY_DATA_CHANGED_AFTER_MIGRATION');
    assert.equal(fs.readFileSync(path.join(root, 'Yance', 'settings.json'), 'utf8'), '{"version":1}');
    assert.equal(fs.readFileSync(path.join(legacy, 'settings.json'), 'utf8'), '{"version":2}');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('a concurrent first-start promotion loser adopts the verified Yance target instead of writing to legacy', () => {
  const root = fixture();
  try {
    const legacy = path.join(root, 'Yance29');
    const target = path.join(root, 'Yance');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"version":1}');
    const result = resolveYanceDataRootSync({
      appDataPath: root,
      newDirectoryName: 'Yance',
      legacyDirectoryNames: ['Yance29'],
      promoteDirectory(temp, destination) {
        fs.renameSync(temp, destination);
        const error = new Error('simulated concurrent promotion race');
        error.code = 'EEXIST';
        throw error;
      }
    });
    assert.equal(result.dataRoot, target);
    assert.equal(result.status, 'MIGRATED_TARGET_PRESENT');
    assert.equal(result.fallbackToLegacy, false);
    assert.equal(result.concurrentPromotionRecovered, true);
    assert.equal(result.requiresMigrationReview, false);
    assert.equal(fs.readFileSync(path.join(target, 'settings.json'), 'utf8'), '{"version":1}');
    assert.equal(fs.readFileSync(path.join(legacy, 'settings.json'), 'utf8'), '{"version":1}');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('an invalid migration marker is fail-visible without falling back or overwriting data', () => {
  const root = fixture();
  try {
    const target = path.join(root, 'Yance');
    fs.mkdirSync(path.join(target, 'migration'), { recursive: true });
    fs.writeFileSync(path.join(target, 'migration', 'brand-data-location-v1.json'), '{broken');
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'TARGET_PRESENT');
    assert.equal(result.requiresMigrationReview, true);
    assert.equal(result.reasonCode, 'YANCE_DATA_MIGRATION_MARKER_INVALID');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('copy failure falls back to legacy without deleting source data', () => {
  const root = fixture();
  try {
    const legacy = path.join(root, 'Yance29');
    fs.mkdirSync(legacy);
    fs.symlinkSync(path.join(root, 'missing-target'), path.join(legacy, 'unsupported-link'));
    const result = resolveYanceDataRootSync({ appDataPath: root, newDirectoryName: 'Yance', legacyDirectoryNames: ['Yance29'] });
    assert.equal(result.status, 'MIGRATION_FAILED_LEGACY_FALLBACK');
    assert.equal(result.dataRoot, legacy);
    assert.equal(fs.existsSync(legacy), true);
    assert.equal(fs.existsSync(path.join(root, 'Yance')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
