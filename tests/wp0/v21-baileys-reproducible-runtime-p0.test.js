'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const BAILEYS = '@whiskeysockets/baileys';
const TARGET_VERSION = '7.0.0-rc14';
const TARGET_ARCHIVE = 'vendor/npm/_at_whiskeysockets__baileys-7.0.0-rc14.tgz';
const PATCH_SCRIPT = 'scripts/dependencies/apply-baileys-profile-picture-token-fix.js';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');
}

test('root package authority pins exact Baileys rc14 and has no postinstall mutation hook', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const lockEntry = lock.packages?.[`node_modules/${BAILEYS}`];

  assert.equal(pkg.dependencies?.[BAILEYS], TARGET_VERSION);
  assert.equal(lock.packages?.['']?.dependencies?.[BAILEYS], TARGET_VERSION);
  assert.equal(lockEntry?.version, TARGET_VERSION);
  assert.match(lockEntry?.resolved || '', /baileys-7\.0\.0-rc14\.tgz$/u);
  assert.doesNotMatch(pkg.scripts?.postinstall || '', /apply-baileys-profile-picture-token-fix/u);
});

test('trusted dependency seed authority binds the official Baileys rc14 archive exactly once', () => {
  const lock = readJson('package-lock.json');
  const policy = readJson('governance/dependency-install-policy.json');
  const manifest = readJson('governance/dependency-install-batch-manifest.json');
  const policyEntries = (policy.trustedCacheSeeds || []).filter(entry => entry.packageName === BAILEYS);
  const manifestEntries = (manifest.entries || []).filter(entry => entry.packageName === BAILEYS);

  assert.equal(policyEntries.length, 1);
  assert.equal(policyEntries[0]?.version, TARGET_VERSION);
  assert.equal(manifestEntries.length, 1);
  assert.equal(manifestEntries[0]?.version, TARGET_VERSION);
  assert.equal(policyEntries[0]?.archivePath, TARGET_ARCHIVE);
  assert.equal(manifestEntries[0]?.archivePath, TARGET_ARCHIVE);
  assert.equal(policyEntries[0]?.resolved, lock.packages?.[`node_modules/${BAILEYS}`]?.resolved);
  assert.equal(policyEntries[0]?.integrity, lock.packages?.[`node_modules/${BAILEYS}`]?.integrity);
  assert.equal(manifestEntries[0]?.resolved, policyEntries[0]?.resolved);
  assert.equal(manifestEntries[0]?.integrity, policyEntries[0]?.integrity);
  assert.equal(manifestEntries[0]?.archiveSha256, policyEntries[0]?.archiveSha256);
  assert.match(policyEntries[0]?.archiveSha256 || '', /^[0-9a-f]{64}$/u);
  assert.equal(fs.existsSync(path.join(ROOT, TARGET_ARCHIVE)), true);
  assert.equal(sha256(TARGET_ARCHIVE), policyEntries[0]?.archiveSha256);
});

test('runtime consumes upstream-fixed rc14 semantics without the retired Yance patch path', () => {
  assert.equal(fs.existsSync(path.join(ROOT, PATCH_SCRIPT)), false);

  const legacyRegression = readText('backend/tests/baileysProfilePictureTokenPatch.test.js');
  assert.doesNotMatch(legacyRegression, /apply-baileys-profile-picture-token-fix/u);

  const installedPackage = readJson('node_modules/@whiskeysockets/baileys/package.json');
  const chats = readText('node_modules/@whiskeysockets/baileys/lib/Socket/chats.js');
  const tokenUtils = readText('node_modules/@whiskeysockets/baileys/lib/Utils/tc-token-utils.js');

  assert.equal(installedPackage.version, TARGET_VERSION);
  assert.match(chats, /const picture = \{ tag: 'picture', attrs: \{ type, query: 'url' \} \};/u);
  assert.match(chats, /picture\.content = tcTokenContent/u);
  assert.match(chats, /return \[picture\]/u);
  assert.match(tokenUtils, /const timestamp = entry\?\.timestamp/u);
  assert.match(tokenUtils, /timestamp === undefined/u);
  assert.match(tokenUtils, /attrs: \{ t: String\(timestamp\) \}/u);
});
