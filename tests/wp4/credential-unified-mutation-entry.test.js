'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED_RAW_WRITERS = new Set([
  'electron/credentialVault.js',
  'electron/desktopHost/CredentialVaultHost.js'
]);

function productionFiles() {
  const rows = [];
  for (const root of ['backend', 'electron', 'shared']) {
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile() && entry.name.endsWith('.js')) rows.push(absolute);
      }
    };
    visit(path.join(ROOT, root));
  }
  return rows;
}

function forbiddenMutationCalls() {
  const findings = [];
  const callPatterns = [
    { method: 'set', expression: /\b(?:vault|credentialVault|destinationVault)\s*\.\s*set\s*\(/g },
    { method: 'remove', expression: /\b(?:vault|credentialVault|destinationVault)\s*\.\s*remove\s*\(/g },
    { method: 'reset', expression: /\b(?:vault|credentialVault|destinationVault)\s*\.\s*reset\s*\(/g },
    { method: 'replaceRaw', expression: /\b(?:vault|credentialVault|destinationVault)\s*\.\s*replaceRaw\s*\(/g }
  ];
  for (const absolute of productionFiles()) {
    const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
    if (ALLOWED_RAW_WRITERS.has(relative)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const pattern of callPatterns) {
      for (const match of source.matchAll(pattern.expression)) {
        findings.push({ relative, method: pattern.method, line: source.slice(0, match.index).split('\n').length });
      }
    }
  }
  return findings;
}

function fakeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value)),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}

test('every production vault mutation enters the CredentialVaultHost coordinator', () => {
  assert.deepEqual(forbiddenMutationCalls(), []);
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  const recovery = fs.readFileSync(path.join(ROOT, 'electron/credentialVaultRecovery.js'), 'utf8');
  const desktopHost = fs.readFileSync(path.join(ROOT, 'electron/desktopHost/DesktopHost.js'), 'utf8');
  const applicationCoordinator = fs.readFileSync(path.join(ROOT, 'electron/desktopHost/DesktopCredentialApplicationCoordinator.js'), 'utf8');
  assert.match(main, /DesktopCredentialApplicationCoordinator/);
  assert.match(main, /desktopCredentialApplicationCoordinator\.applyVaultMutationWithRestart\(/);
  assert.match(applicationCoordinator, /vaultHost\.executeDesktopMutation\(/);
  assert.doesNotMatch(main, /credentialVaultHost\.persistFromDesktop\(/);
  assert.doesNotMatch(main, /credentialVaultHost\.removeFromDesktop\(/);
  assert.match(recovery, /credentialVaultHost\.persistFromMigration\(/);
  assert.match(desktopHost, /credentialVaultHost\.resetAfterBackendStopped\(/);
});

test('CredentialVault itself rejects every public mutation bypass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-unified-mutation-entry-'));
  try {
    const vault = new CredentialVault(path.join(root, 'vault.bin'), { safeStorage: fakeStorage() });
    for (const invoke of [
      () => vault.set('x', { value: true }),
      () => vault.remove('x'),
      () => vault.reset()
    ]) assert.throws(invoke, error => error.reasonCode === 'CREDENTIAL_VAULT_DIRECT_MUTATION_FORBIDDEN');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
