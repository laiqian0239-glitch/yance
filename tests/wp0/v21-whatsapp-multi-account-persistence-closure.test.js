'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

test('mautrix-backed WhatsApp accounts are not scheduled into Yance SESSION_RESTORE', () => {
  const { AccountManager } = require('../../backend/services/accountManager');
  const accounts = [
    { id: 'wa-a', platform: 'whatsapp', lifecycleState: 'active', autoReconnect: true, paused: false, credentialRef: 'account:wa-a', driverId: 'whatsapp-personal-mautrix-whatsapp', metadata: { driverId: 'whatsapp-personal-mautrix-whatsapp', protocolAuthority: 'mautrix-whatsapp', mautrixLoginId: 'login-a' } },
    { id: 'wa-b', platform: 'whatsapp', lifecycleState: 'active', autoReconnect: true, paused: false, credentialRef: 'account:wa-b', driverId: 'whatsapp-personal-mautrix-whatsapp', metadata: { driverId: 'whatsapp-personal-mautrix-whatsapp', protocolAuthority: 'mautrix-whatsapp', mautrixLoginId: 'login-b' } },
  ];
  const manager = new AccountManager({
    accountList: () => accounts,
    accountReader: id => accounts.find(row => row.id === id) || null,
    durableExecutionAuthority: { createExecution() { throw new Error('YANCE_SESSION_RESTORE_MUST_NOT_RUN_FOR_MAUTRIX'); } },
    outboxAuthority: { createIntent() { throw new Error('YANCE_SESSION_RESTORE_MUST_NOT_RUN_FOR_MAUTRIX'); } },
  });
  assert.deepEqual(manager.requestPersistedSessionRestores(), []);
});

test('mautrix-whatsapp owns durable login state in its own persistent data volume', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const config = read('config/matrix/mautrix-whatsapp/config.yaml');
  assert.match(compose, /mautrix-whatsapp-data:\/data/u);
  assert.match(config, /database:[\s\S]{0,120}type:\s*sqlite3-fk-wal[\s\S]{0,120}uri:\s*\/data\/mautrix-whatsapp\.db/u);
  const adapter = read('backend/services/mautrixProvisioningAdapter.js');
  assert.match(adapter, /connect:\s*observe/u);
  assert.match(adapter, /if \(options\.logout !== true\) return \{ preserved: true, authority:/u);
});

test('Yance source authority has no local WhatsApp or Baileys session owner', () => {
  for (const rel of [
    'backend/services/whatsappAuthResolver.js',
    'backend/services/credentialRecoveryService.js',
  ]) assert.equal(exists(rel), false, `${rel} must be retired`);
  const config = read('backend/config.js');
  assert.doesNotMatch(config, /whatsappAuth|baileysAuthLegacy/u);
  const migration = read('backend/services/accountMigrationService.js');
  assert.doesNotMatch(migration, /readValidCredentials|commitWhatsAppCredentials|credentialDirectory|auth-directory/u);
  for (const rel of [
    'backend/services/backupService.js',
    'backend/services/diagnosticsService.js',
    'backend/services/systemCenterService.js',
  ]) assert.doesNotMatch(read(rel), /PATHS\.whatsappAuth|WhatsApp本地认证|whatsapp-auth/u, `${rel} must not advertise a Yance-owned WhatsApp auth store`);
});
