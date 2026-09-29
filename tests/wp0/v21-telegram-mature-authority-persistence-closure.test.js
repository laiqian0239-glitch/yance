'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Telegram Product capability copy names mautrix/Matrix authority and no GramJS shadow', () => {
  const caps = read('backend/services/platformCapabilities.js');
  assert.doesNotMatch(caps, /GramJS|MTProto|Telegram receive pipeline|attachTypingHandler/u);
  assert.match(caps, /mautrix-telegram/u);
  assert.match(caps, /Matrix/u);
});

test('active Telegram readiness regression no longer instantiates retired telegramAdapter', () => {
  const readiness = read('backend/tests/telegramHistorySyncRegression.test.js');
  assert.doesNotMatch(readiness, /const\s+telegramModule\s*=\s*require|new\s+TelegramAdapter/u);
  assert.match(readiness, /mautrix-telegram/u);
  assert.match(readiness, /backfill/u);
});

test('mautrix-backed Telegram and Facebook Personal accounts never enter Yance SESSION_RESTORE', () => {
  const { AccountManager } = require('../../backend/services/accountManager');
  const accounts = [
    { id: 'tg-a', platform: 'telegram', lifecycleState: 'active', autoReconnect: true, paused: false, credentialRef: 'account:tg-a', driverId: 'telegram-personal-mautrix-telegram', metadata: { driverId: 'telegram-personal-mautrix-telegram', protocolAuthority: 'mautrix-telegram', mautrixLoginId: 'tg-login' } },
    { id: 'fb-a', platform: 'facebook', lifecycleState: 'active', autoReconnect: true, paused: false, credentialRef: 'account:fb-a', driverId: 'facebook-personal-messenger-mautrix-meta', metadata: { driverId: 'facebook-personal-messenger-mautrix-meta', protocolAuthority: 'mautrix-meta', mautrixLoginId: 'fb-login' } },
  ];
  const manager = new AccountManager({
    accountList: () => accounts,
    accountReader: id => accounts.find(row => row.id === id) || null,
    durableExecutionAuthority: { createExecution() { throw new Error('YANCE_SESSION_RESTORE_MUST_NOT_RUN_FOR_MAUTRIX'); } },
    outboxAuthority: { createIntent() { throw new Error('YANCE_SESSION_RESTORE_MUST_NOT_RUN_FOR_MAUTRIX'); } },
  });
  assert.deepEqual(manager.requestPersistedSessionRestores(), []);
});

test('Telegram session durability belongs to mautrix-telegram persistent volume', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const config = read('config/matrix/mautrix-telegram/config.yaml');
  assert.match(compose, /mautrix-telegram-data:\/data/u);
  assert.match(config, /database:[\s\S]{0,140}type:\s*sqlite3-fk-wal[\s\S]{0,140}uri:\s*\/data\/mautrix-telegram\.db/u);
  assert.match(config, /backfill:[\s\S]{0,100}enabled:\s*true/u);
});
