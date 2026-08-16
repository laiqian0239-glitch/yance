'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SHA40 = /^[a-f0-9]{40}$/u;

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('V2.1 communication P0 pins the three mature OSS authorities to exact commits', () => {
  const lock = readJson('config/upstreams/v21-comms-p0.json');
  assert.equal(lock.schemaVersion, 1);
  assert.deepEqual(Object.keys(lock.upstreams).sort(), ['elementWeb', 'mautrixWhatsapp', 'synapse']);
  assert.deepEqual(lock.upstreams.synapse, {
    repository: 'https://github.com/element-hq/synapse.git',
    version: 'v1.158.0',
    commit: '7a3e98b6f77ee3a5fe4dbeb934b0a0c1721e6afe',
    license: 'AGPL-3.0-or-later'
  });
  assert.deepEqual(lock.upstreams.elementWeb, {
    repository: 'https://github.com/element-hq/element-web.git',
    version: 'v1.12.25',
    commit: 'a2a996ae50d802878bf48e4bbf3730004bdcc55c',
    license: 'AGPL-3.0-only'
  });
  assert.deepEqual(lock.upstreams.mautrixWhatsapp, {
    repository: 'https://github.com/mautrix/whatsapp.git',
    version: 'v0.2607.0',
    commit: 'a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2',
    license: 'AGPL-3.0-or-later WITH upstream-exceptions'
  });
  for (const upstream of Object.values(lock.upstreams)) assert.match(upstream.commit, SHA40);
});

test('Synapse, Element and mautrix-whatsapp are the runtime authorities rather than a Yance message service', () => {
  const compose = readText('services/matrix/docker-compose.yml');
  assert.match(compose, /^\s{2}synapse:\s*$/mu);
  assert.match(compose, /^\s{2}element:\s*$/mu);
  assert.match(compose, /^\s{2}mautrix-whatsapp:\s*$/mu);
  assert.doesNotMatch(compose, /yance-(?:message|channel|matrix)-(?:service|store|runtime)/iu);
  assert.match(compose, /config\/matrix\/synapse\/homeserver\.yaml/u);
  assert.match(compose, /config\/matrix\/mautrix-whatsapp\/config\.yaml/u);
  assert.match(compose, /config\/matrix\/element-config\.json/u);

  const synapse = readText('config/matrix/synapse/homeserver.yaml');
  const bridge = readText('config/matrix/mautrix-whatsapp/config.yaml');
  const element = readJson('config/matrix/element-config.json');
  assert.match(synapse, /server_name:\s*yance\.local/u);
  assert.match(bridge, /address:\s*http:\/\/synapse:8008/u);
  assert.equal(element.default_server_config['m.homeserver'].base_url, 'http://127.0.0.1:8008');
});

test('mautrix-whatsapp database storage remains a top-level bridgev2 authority config', () => {
  const bridge = readText('config/matrix/mautrix-whatsapp/config.yaml');
  assert.match(bridge, /^database:\s*$/mu);
  assert.doesNotMatch(bridge, /^\s+database:\s*$/mu);
  for (const section of ['homeserver', 'appservice', 'database', 'bridge', 'logging']) {
    assert.match(bridge, new RegExp(`^${section}:\\s*$`, 'mu'), `${section} must remain a top-level mautrix bridge config section`);
  }
});

test('bootstrap is exact-commit, patch-drift and mutable-ref fail closed', () => {
  const bootstrap = readText('tools/matrix/bootstrap.js');
  assert.match(bootstrap, /assertExactCommit/u);
  assert.match(bootstrap, /rev-parse/u);
  assert.match(bootstrap, /apply[^\n]*--check|--check[^\n]*apply/u);
  assert.match(bootstrap, /v21-comms-p0\.json/u);
  assert.match(bootstrap, /0001-yance-global-right-workspace\.patch/u);
  assert.doesNotMatch(bootstrap, /checkout[^\n]*(?:main|master|latest)/iu);
  assert.doesNotMatch(bootstrap, /(?:image|tag):\s*latest/iu);
});

test('copyleft obligations are carried in notices and exact license copies', () => {
  const notices = readText('THIRD_PARTY_NOTICES.md');
  for (const name of ['Element Web', 'Synapse', 'mautrix-whatsapp']) assert.match(notices, new RegExp(name, 'u'));
  for (const relativePath of [
    'third_party/licenses/element-web-AGPL-3.0.txt',
    'third_party/licenses/synapse-AGPL-3.0.txt',
    'third_party/licenses/mautrix-whatsapp-AGPL-3.0.txt',
    'third_party/licenses/mautrix-whatsapp-LICENSE.exceptions.txt'
  ]) {
    assert.ok(readText(relativePath).length > 100, `${relativePath} must contain upstream license text`);
  }
});
