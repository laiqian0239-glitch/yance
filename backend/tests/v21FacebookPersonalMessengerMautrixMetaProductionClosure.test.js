'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');

test('Facebook Personal Messenger resolves to the production mautrix/meta Matrix driver without browser-session authority', () => {
  const registry = require('../services/platformDriverRegistry');
  const account = { id: 'fb-personal-a', platform: 'facebook', metadata: { accountKind: 'personal-messenger' } };
  assert.equal(registry.resolveDriverId(account), 'facebook-personal-messenger-mautrix-meta');
  const driver = registry.getForAccount(account);
  assert.equal(driver.supportLevel, 'production');
  assert.equal(driver.protocolAuthority, 'mautrix-meta');
  assert.equal(driver.isolationModel, 'matrix-application-service');
  assert.notEqual(driver.riskDisclosureRequired, true);
  const source = read('backend/services/platformDriverRegistry.js');
  assert.match(source, /facebookPersonalMessengerMautrixAdapter/u);
  assert.doesNotMatch(source, /facebookPersonalMessengerExperimentalAdapter/u);
  assert.doesNotMatch(source, /isolated-browser-session/u);
});

test('Facebook capability truth is driver/account-kind aware so Page and Personal Messenger cannot inherit each other capability contracts', () => {
  const capabilities = require('../services/platformCapabilities');
  assert.equal(typeof capabilities.resolveForAccount, 'function');
  const page = capabilities.resolveForAccount({ platform: 'facebook', metadata: { accountKind: 'page' } });
  const personal = capabilities.resolveForAccount({ platform: 'facebook', metadata: { accountKind: 'personal-messenger' } });
  assert.equal(page.authority, 'chatwoot-facebook-page');
  assert.equal(personal.authority, 'mautrix-meta');
  assert.notDeepEqual(personal, page);
  for (const name of ['sendText', 'receive', 'attachments', 'typing', 'readReceipt', 'historyBackfill']) {
    assert.equal(personal[name], true, `Personal Messenger capability must be backed by mautrix/meta: ${name}`);
  }
});

test('normal application startup requests durable persisted session restores through the existing runtime command', () => {
  const server = read('backend/server.js');
  assert.match(server, /composition\.commands\.startup\.requestSessionRestores/u);
  assert.doesNotMatch(server, /setInterval[\s\S]{0,500}SESSION_RESTORE/iu);
});

test('forward migration owns stale experimental driver retirement at schema 24 without editing historical migrations', () => {
  const engine = read('backend/lib/r32SqliteStoreEngine.js');
  const migration = read('backend/migrations/v21FacebookPersonalMessengerMautrixMetaProductionClosure.js');
  assert.match(engine, /v21FacebookPersonalMessengerMautrixMetaProductionClosure/u);
  assert.match(migration, /TARGET_SCHEMA_VERSION\s*=\s*24/u);
  assert.match(migration, /facebook-personal-messenger-experimental/u);
  assert.match(migration, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(migration, /isolated-browser-session/u);
});
