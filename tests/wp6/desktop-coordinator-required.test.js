'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopHost } = require('../../electron/desktopHost/DesktopHost');

test('DesktopHost fails closed instead of direct lifecycle or credential reset fallback', async () => {
  const host = new DesktopHost({ releaseManifestHost: { verify(){ return {}; }, backendStartupConfig(){ return {}; } }, backendProcessHost: {} });
  assert.throws(() => host.executeControl('backend.start'), error => (error.reasonCode || error.code) === 'WP6_DESKTOP_COORDINATOR_REQUIRED');
  await assert.rejects(() => host.resetCredentialVault(), error => (error.reasonCode || error.code) === 'WP6_DESKTOP_COORDINATOR_REQUIRED');
});
