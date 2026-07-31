'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop credential updates enter the application coordinator before stop, mutation, FD5 and READY', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
  const coordinator = fs.readFileSync(path.join(__dirname, '../../electron/desktopHost/DesktopCredentialApplicationCoordinator.js'), 'utf8');
  assert.doesNotMatch(source, /function\s+hydrateCredentials\s*\(/);
  assert.doesNotMatch(source, /persistCredentialToBackend\s*\(/);
  assert.match(source, /async function applyVaultMutationWithRestart/);
  assert.match(source, /desktopCredentialApplicationCoordinator\.applyVaultMutationWithRestart\(operation, key, value, options\)/);
  assert.doesNotMatch(source, /vaultHost\.persistFromDesktop\(key/);
  assert.doesNotMatch(source, /vaultHost\.removeFromDesktop\(key/);
  assert.doesNotMatch(source, /\bvault\.(?:set|remove|reset)\s*\(/);
  assert.match(coordinator, /await this\._stopAndRecover\(token/);
  assert.match(coordinator, /this\._transition\(STATES\.MUTATION_COMMITTING/);
  assert.match(coordinator, /await this\.vaultHost\.executeDesktopMutation\(/);
  assert.match(coordinator, /await this\._startAndValidate\(token, committedAuthority/);
  assert.match(coordinator, /fd5-ready-handshake-pending/);
  assert.match(coordinator, /fd6-not-active/);
});
