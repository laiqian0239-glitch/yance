'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MATRIX_JS_COMMIT = '85362b92fabe6009bc1a86b63d046263b1dc66b3';
function read(relative) { return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8'); }
function json(relative) { return JSON.parse(read(relative)); }
const META_COMMIT = json('config/upstreams/v21-comms-p0.json').externalRuntimes.mautrixMeta.commit;

test('Facebook Personal production closure pins stable mautrix/meta v0.2609.0 and official matrix-js-sdk 42.0.0 exactly', () => {
  const lock = json('config/upstreams/v21-comms-p0.json');
  assert.deepEqual(lock.externalRuntimes?.mautrixMeta, {
    repository: 'https://github.com/mautrix/meta.git',
    version: 'v0.2609.0',
    commit: META_COMMIT,
    license: 'AGPL-3.0',
    adoptionMode: 'sidecar-service',
    protocolAuthority: 'facebook-personal-messenger',
    nativeLoginFlow: 'messenger-lite'
  });
  const pkg = json('package.json');
  assert.equal(pkg.dependencies?.['matrix-js-sdk'], '42.0.0');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, new RegExp(META_COMMIT, 'u'));
  assert.match(notices, new RegExp(MATRIX_JS_COMMIT, 'u'));
  assert.match(read('third_party/licenses/mautrix-meta-AGPL-3.0.txt'), /GNU AFFERO GENERAL PUBLIC LICENSE/u);
  assert.match(read('third_party/licenses/mautrix-meta-LICENSE.exceptions.txt'), /Beeper|Element/u);
  assert.match(read('third_party/licenses/matrix-js-sdk-Apache-2.0.txt'), /Apache License/u);
});

test('production keeps messenger-lite as the Yance-selected mature login flow without retired v26.07 mode overrides', () => {
  const upstream = json('config/upstreams/v21-comms-p0.json').externalRuntimes?.mautrixMeta;
  assert.equal(upstream.version, 'v0.2609.0');
  assert.equal(upstream.nativeLoginFlow, 'messenger-lite');
  const metaConfig = read('config/matrix/mautrix-meta/config.yaml');
  const materializedCompose = read('tools/product-experience/materialized-matrix-compose.yml');
  assert.match(metaConfig, /network:[\s\S]*cache_connection_state:\s*true[\s\S]*send_presence_on_typing:\s*true[\s\S]*thread_backfill:/u);
  assert.doesNotMatch(metaConfig, /^\s*mode:\s*/mu);
  assert.doesNotMatch(metaConfig, /^\s*allowed_modes:\s*/mu);
  assert.doesNotMatch(materializedCompose, /YANCE_MAUTRIX_META_NETWORK__MODE/u);
});

test('production source contains no Yance browser automation, cookie harvesting, direct Meta protocol client or hand-written Matrix sync engine', () => {
  const sources = [
    'backend/services/facebookPersonalMessengerMautrixAdapter.js',
    'backend/services/platformDriverRegistry.js',
    'backend/services/accountManagerCore.js',
    'backend/routes/accounts.js'
  ].map(read).join('\n');
  assert.doesNotMatch(sources, /playwright|selenium|puppeteer|browserSessionRef|isolated-browser-session|document\.querySelector|page\.evaluate/iu);
  assert.doesNotMatch(sources, /graph\.facebook\.com|facebook\.com\/api\/graphql|mqtt\.facebook/iu);
  assert.doesNotMatch(sources, /fetch\([^\n]*\/_matrix\/client\/.{0,80}\/sync/iu);
});

test('Facebook Page Chatwoot remains isolated while Personal Messenger moves to mautrix/meta and durable startup recovery', () => {
  const pageTest = read('tests/wp0/v21-facebook-page-chatwoot-integration-p0.test.js');
  const registry = read('backend/services/platformDriverRegistry.js');
  const server = read('backend/server.js');
  assert.match(pageTest, /facebook-page-official/u);
  assert.match(pageTest, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(registry, /facebook-page-official[\s\S]*facebookChatwoot/u);
  assert.match(registry, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(server, /composition\.commands\.startup\.requestSessionRestores/u);
});
