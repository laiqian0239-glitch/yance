'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJsonBuffer, detachedHashText, sha256File, verifyDetachedManifest } = require('../../tools/wp1/lib');
const { tempDir, validManifest, write } = require('./helpers');

test('release manifest detached SHA256 validates and tampering fails closed', () => {
  const root = tempDir('yance-wp1-manifest-');
  const manifestPath = path.join(root, 'release-manifest.json');
  const hashPath = path.join(root, 'release-manifest.sha256');
  write(manifestPath, canonicalJsonBuffer(validManifest()));
  write(hashPath, detachedHashText(sha256File(manifestPath)));
  assert.equal(verifyDetachedManifest(manifestPath, hashPath).manifest.productVersion, '29.2.5');
  fs.appendFileSync(manifestPath, ' ');
  assert.throws(() => verifyDetachedManifest(manifestPath, hashPath), error => error.reasonCode === 'BOOT_MANIFEST_HASH_MISMATCH');
});
