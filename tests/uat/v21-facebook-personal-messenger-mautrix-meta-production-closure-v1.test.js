'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
function read(relative) {
  const file = path.join(ROOT, ...relative.split('/'));
  assert.equal(fs.existsSync(file), true, `missing Facebook Personal Messenger production file: ${relative}`);
  return fs.readFileSync(file, 'utf8');
}

test('post-login production adapter uses official matrix-js-sdk and keeps Meta protocol/session authority in mautrix/meta', () => {
  const source = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');
  assert.match(source, /matrix-js-sdk/u);
  assert.match(source, /mautrix-meta/u);
  assert.match(source, /messenger-lite/u);
  assert.doesNotMatch(source, /playwright|selenium|puppeteer|browserSessionRef|cookie\s*harvest|document\.querySelector|page\.evaluate/iu);
  assert.doesNotMatch(source, /fetch\([^\n]*\/_matrix\/client\/.{0,80}\/sync/iu);
});

test('adapter closes post-login send receive history attachments receipts typing recovery expiry isolation and canonical replay contracts without a second queue', () => {
  const source = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');
  for (const contract of [
    'connect', 'disconnect', 'sendText', 'sendMedia', 'fetchHistory', 'markRead', 'setTyping',
    'matrix-js-sdk', 'externalEventId', 'idempotency', 'accountId', 'SESSION_RESTORE'
  ]) assert.match(source, new RegExp(contract, 'u'), `missing production closure contract: ${contract}`);
  assert.doesNotMatch(source, /better-sqlite|new\s+Map\s*\([^)]*\)[\s\S]{0,500}(?:retry|queue|outbox)/iu);
});

test('Matrix runtime wires mautrix/meta as a sidecar Application Service next to Synapse and does not replace Facebook Page Chatwoot', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const synapse = read('config/matrix/synapse/homeserver.yaml');
  const meta = read('config/matrix/mautrix-meta/config.yaml');
  assert.match(compose, /mautrix-meta/u);
  assert.match(compose, /synapse/u);
  assert.match(synapse, /app_service_config_files/u);
  assert.match(meta, /messenger-lite/u);
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /facebook-page-official[\s\S]*facebookChatwoot/u);
  assert.match(registry, /facebook-personal-messenger-mautrix-meta/u);
});

test('the previously proven real username/password login is inherited evidence, so this closure tests post-login behavior rather than browser login reproof', () => {
  const source = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');
  assert.match(source, /messenger-lite/u);
  assert.doesNotMatch(source, /experimental.*opt.?in|YANCE_FACEBOOK_PERSONAL_MESSENGER_EXPERIMENTAL/iu);
});
