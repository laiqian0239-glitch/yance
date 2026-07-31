'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReleaseManifest } = require('../../shared/release/releaseManifestSchema');
const { validManifest } = require('./helpers');

function rejects(mutator) {
  const manifest = validManifest();
  mutator(manifest);
  assert.throws(() => validateReleaseManifest(manifest), error => error.reasonCode === 'BOOT_MANIFEST_SCHEMA_INVALID');
}

test('canonical manifest schema accepts complete valid manifest', () => {
  assert.equal(validateReleaseManifest(validManifest()).gitCommit, 'a'.repeat(40));
});

test('manifest schema rejects missing fields, wrong types, hashes, commits, timestamps, and buildId mismatch', () => {
  rejects(m => { delete m.phase; });
  rejects(m => { m.apiContractVersion = '2'; });
  rejects(m => { m.applicationPayloadSha256 = 'bad'; });
  rejects(m => { m.gitCommit = 'xyz'; });
  rejects(m => { m.buildTimestampUtc = '2026-07-03'; });
  rejects(m => { m.sourceCommit = 'b'.repeat(40); });
  rejects(m => { m.buildId = 'YANCE-WRONG'; });
  rejects(m => { m.executableName = 'Legacy.exe'; });
  rejects(m => { m.onlineUpdatesEnabled = true; });
  rejects(m => { m.formalPublicReleaseAuthorized = true; });
  rejects(m => { m.legacyCompatibility.userVisible = true; });
  rejects(m => { m.legacyCompatibility.sunsetAfterBrandingEpoch = 2; });
});


test('platform auth manifest state is release-managed and hash-bound', () => {
  const enabled = validManifest();
  enabled.platformAuthConfigured = true;
  enabled.platformAuthReleaseManaged = true;
  enabled.platformAuthConfigSha256 = 'b'.repeat(64);
  assert.equal(validateReleaseManifest(enabled).platformAuthConfigured, true);

  rejects(m => { m.platformAuthConfigured = true; m.platformAuthConfigSha256 = 'b'.repeat(64); });
  rejects(m => { m.platformAuthConfigured = true; m.platformAuthReleaseManaged = true; m.platformAuthConfigSha256 = 'bad'; });
  rejects(m => { m.platformAuthConfigured = false; m.platformAuthReleaseManaged = true; m.platformAuthConfigSha256 = 'b'.repeat(64); });
});
