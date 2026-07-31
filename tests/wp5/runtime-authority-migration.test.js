'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAuthorityHarness, tempRoot, removeRoot } = require('./helpers');
const { discoverLegacyDataRoots } = require('../../backend/services/legacyRootDiscovery');

function digestTree(root) {
  const rows = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else rows.push([path.relative(root, file), fs.readFileSync(file).toString('hex')]);
    }
  }
  walk(root);
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function createLegacyDb(root, mode = 'safeMode') {
  const store = path.join(root, 'store');
  fs.mkdirSync(store, { recursive: true });
  const db = new DatabaseSync(path.join(store, 'yance-r32.db'));
  try {
    db.exec(`CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,state_version INTEGER NOT NULL,operating_mode TEXT NOT NULL) STRICT;`);
    db.prepare('INSERT INTO runtime_state(id,state_version,operating_mode) VALUES(1,7,?)').run(mode);
  } finally { db.close(); }
}

test('fresh initialization persists normal authority and a committed migration receipt', async () => {
  const h = await createAuthorityHarness({ initialize: false });
  try {
    const result = h.migration.ensureAuthority();
    assert.equal(result.mode, 'fresh');
    assert.equal(result.operatingMode, 'normal');
    assert.equal(h.store.snapshot().runtime.operatingMode, 'normal');
    assert.equal(result.receipt.status, 'COMMITTED');
    assert.equal(result.receipt.verification.sourceReadOnly, true);
    assert.equal(result.receipt.verification.sourceMutationCount, 0);
  } finally { await h.close(); }
});

test('Yance27 runtime authority is read-only and becomes the one-time Yance authority', async () => {
  const parent = tempRoot();
  const currentRoot = path.join(parent, '.yance');
  const legacyRoot = path.join(parent, '.yance27');
  createLegacyDb(legacyRoot, 'safeMode');
  const before = digestTree(legacyRoot);
  const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
  try {
    const first = h.migration.ensureAuthority();
    assert.equal(first.mode, 'migrated');
    assert.equal(first.operatingMode, 'safeMode');
    assert.equal(digestTree(legacyRoot), before);
    fs.writeFileSync(path.join(legacyRoot, 'safe-mode-state.json'), JSON.stringify({ active: false }));
    const second = h.migration.ensureAuthority();
    assert.equal(second.mode, 'existing');
    assert.equal(second.legacyRead, false);
    assert.equal(second.operatingMode, 'safeMode');
  } finally { await h.close(); }
});

test('conflicting Yance27 candidates fail closed without creating Yance runtime_state', async () => {
  const parent = tempRoot();
  const currentRoot = path.join(parent, '.yance');
  const legacyRoot = path.join(parent, '.yance27');
  createLegacyDb(legacyRoot, 'normal');
  fs.writeFileSync(path.join(legacyRoot, 'safe-mode-state.json'), JSON.stringify({ active: true }));
  const h = await createAuthorityHarness({ parent, currentRoot, legacyRoot, initialize: false });
  try {
    assert.throws(() => h.migration.ensureAuthority(), error => error.code === 'LEGACY_RUNTIME_CANDIDATE_CONFLICT');
    assert.equal(h.store.hasRuntimeState(), false);
    assert.equal(h.store.getMigrationReceipt(), null);
  } finally { await h.close(); }
});

test('legacy root discovery accepts only the exact Yance27 sibling by default', () => {
  const parent = tempRoot();
  try {
    const current = path.join(parent, '.yance');
    const y27 = path.join(parent, '.yance27');
    const unrelated = path.join(parent, 'Yance32');
    fs.mkdirSync(current, { recursive: true });
    fs.mkdirSync(y27, { recursive: true });
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(y27, 'accounts.json'), '{}');
    fs.writeFileSync(path.join(unrelated, 'accounts.json'), '{}');
    const old = process.env.YANCE_LEGACY_DATA_DIRS;
    process.env.YANCE_LEGACY_DATA_DIRS = unrelated;
    try {
      const result = discoverLegacyDataRoots({ currentRoot: current });
      assert.deepEqual(result.legacyRoots, [path.resolve(y27)]);
      assert.equal(result.discoveryPolicy, 'EXACT_YANCE27_ONLY');
      assert.equal(result.environmentRootsAccepted, false);
      assert.equal(result.siblingScanUsed, false);
    } finally {
      if (old === undefined) delete process.env.YANCE_LEGACY_DATA_DIRS;
      else process.env.YANCE_LEGACY_DATA_DIRS = old;
    }
  } finally { removeRoot(parent); }
});
