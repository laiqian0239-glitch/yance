'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PARLANT_VERSION = 'v3.3.2';
const PARLANT_COMMIT = '61bba3b2b3fffd677d345e393e8c942dbd400297';
const PARLANT_UV_LOCK_BLOB = 'aa2f7de8e858f19296df58efec56d72c8d3f50a5';
const UV_VERSION = '0.12.3';
const UV_COMMIT = '507230998c9541d67814b57463ac00e454ff6991';
const PYTHON_BUILD_STANDALONE_RELEASE = '20260807';
const PYTHON_BUILD_STANDALONE_COMMIT = '00c8a06113f11220667c3bcf5fab1672ff9e78ef';
const CPYTHON_VERSION = '3.12.13';

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Parlant P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('V2.1 Parlant P0 pins exact mature OSS runtime authorities without adding Node dependencies', () => {
  const lock = readJson('config/upstreams/v21-parlant-p0.json');
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.upstreams.parlant.version, PARLANT_VERSION);
  assert.equal(lock.upstreams.parlant.commit, PARLANT_COMMIT);
  assert.equal(lock.upstreams.parlant.license, 'Apache-2.0');
  assert.equal(lock.upstreams.parlant.uvLockGitBlob, PARLANT_UV_LOCK_BLOB);
  assert.equal(lock.upstreams.uv.version, UV_VERSION);
  assert.equal(lock.upstreams.uv.commit, UV_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.release, PYTHON_BUILD_STANDALONE_RELEASE);
  assert.equal(lock.upstreams.pythonBuildStandalone.commit, PYTHON_BUILD_STANDALONE_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.cpythonVersion, CPYTHON_VERSION);

  const pkg = readJson('package.json');
  assert.equal(Object.keys(pkg.dependencies || {}).some(name => /parlant|python|uv/iu.test(name)), false, 'Parlant P0 must not invent a Node-side Python/runtime dependency layer');
});

test('Parlant, uv, python-build-standalone and CPython redistribution obligations are explicit', () => {
  const notices = readText('THIRD_PARTY_NOTICES.md');
  for (const required of ['Parlant', 'uv', 'python-build-standalone', 'CPython']) {
    assert.match(notices, new RegExp(required, 'u'));
  }

  const licenses = [
    ['third_party/licenses/parlant-Apache-2.0.txt', /Apache License/u],
    ['third_party/licenses/uv-Apache-2.0.txt', /Apache License/u],
    ['third_party/licenses/uv-MIT.txt', /MIT License|Permission is hereby granted/u],
    ['third_party/licenses/python-build-standalone-MPL-2.0.txt', /Mozilla Public License/u],
    ['third_party/licenses/cpython-PSF-2.0.txt', /PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2|Python Software Foundation License/u]
  ];
  for (const [relativePath, marker] of licenses) {
    const license = readText(relativePath);
    assert.match(license, marker);
    assert.ok(license.length > 500, `${relativePath} must contain the upstream license text`);
  }
});

test('the Electron adapter is Parlant-specific, loopback-only, telemetry-off and main-owned', () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  assert.equal(fs.existsSync(runtimePath), true, 'Parlant relationship runtime adapter must exist');
  delete require.cache[require.resolve(runtimePath)];
  const runtimeModule = require(runtimePath);

  assert.equal(runtimeModule.PARLANT_VERSION, PARLANT_VERSION);
  assert.equal(runtimeModule.PARLANT_COMMIT, PARLANT_COMMIT);
  assert.equal(runtimeModule.assertLoopbackEndpoint('http://127.0.0.1:8800'), 'http://127.0.0.1:8800');
  assert.equal(runtimeModule.assertLoopbackEndpoint('http://localhost:8800'), 'http://localhost:8800');
  for (const denied of ['http://0.0.0.0:8800', 'http://192.168.1.20:8800', 'https://127.0.0.1:8800']) {
    assert.throws(() => runtimeModule.assertLoopbackEndpoint(denied), /loopback|Parlant|endpoint/iu);
  }

  const dataRoot = path.join(os.tmpdir(), 'yance-parlant-contract-root');
  const env = runtimeModule.buildParlantEnvironment({
    ELECTRON_RUN_AS_NODE: '1',
    PARLANT_DATA_COLLECTION: 'true',
    OPENROUTER_API_KEY: 'ambient-key-must-not-be-trusted',
    KEEP_ME: 'yes'
  }, dataRoot, 'explicit-main-owned-key');
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(env.PARLANT_DATA_COLLECTION, 'false');
  assert.equal(env.OPENROUTER_API_KEY, 'explicit-main-owned-key');
  assert.equal(Object.prototype.hasOwnProperty.call(env, 'ELECTRON_RUN_AS_NODE'), false);
  assert.equal(env.YANCE_PARLANT_DATA_ROOT, path.join(dataRoot, 'parlant'));
});

test('relationship keys are only deterministic isolation keys and do not become a Yance Journey store', () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  assert.equal(fs.existsSync(runtimePath), true, 'Parlant relationship runtime adapter must exist');
  delete require.cache[require.resolve(runtimePath)];
  const runtimeModule = require(runtimePath);

  const a1 = runtimeModule.relationshipNamespaceKey('contact-A');
  const a2 = runtimeModule.relationshipNamespaceKey('contact-A');
  const b = runtimeModule.relationshipNamespaceKey('contact-B');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^[a-f0-9]{64}$/u);

  const source = readText('electron/parlantRelationshipRuntime.js');
  assert.doesNotMatch(source, /new\s+Map\([^\n]*(?:journey|goal)|journeyGraph|goalGraph|transitionGraph/iu, 'Yance must not own a duplicate Journey/Goal graph');
  assert.doesNotMatch(source, /sqlite|better-sqlite3|leveldb|indexeddb/iu, 'the thin Parlant adapter must not add a second relationship-goal persistence authority');
});

test('the Python bridge builds real Parlant Journeys instead of reimplementing a state machine', () => {
  const server = readText('runtime/parlant/yance_parlant_server.py');
  assert.match(server, /import parlant\.sdk as p|from parlant import sdk as p/u);
  assert.match(server, /create_journey\(/u);
  assert.match(server, /initial_state\.transition_to\(/u);
  assert.match(server, /chat_state\s*=/u);
  assert.match(server, /condition\s*=/u, 'goal Journey needs an explicit completion/transition condition');
  assert.match(server, /mode\s*=\s*["']manual["']|["']manual["']/u, 'pause must use native Parlant manual session mode');
  assert.match(server, /["']auto["']/u, 'resume must use native Parlant auto session mode');
  assert.doesNotMatch(server, /class\s+(?:Journey|GoalGraph|TransitionGraph)|networkx|state_machine/iu);
});

test('runtime API is relationship-scoped, ingests customer events and returns candidates without send authority', () => {
  const source = readText('electron/parlantRelationshipRuntime.js');
  for (const required of [
    'readRelationshipGoal',
    'upsertRelationshipGoal',
    'deleteRelationshipGoal',
    'setRelationshipGoalPaused',
    'ingestCustomerMessage',
    'requestReplyCandidate'
  ]) assert.ok(source.includes(required), `Parlant adapter must expose ${required}`);

  assert.match(source, /contactId|relationship/iu);
  assert.match(source, /customer/iu, 'incoming customer messages must be represented explicitly');
  assert.doesNotMatch(source, /sendMessage|sendText|sendMedia|channel\.send|whatsapp|telegram|facebook/iu, 'Parlant must return a candidate, never send to a channel');
});

test('provider/runtime failures fail closed and plaintext OpenRouter credentials never enter renderer projections', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');

  assert.match(runtime, /PARLANT_RUNTIME_NOT_READY|PARLANT_PROVIDER_UNAVAILABLE|PARLANT_DEGRADED/u);
  assert.doesNotMatch(preload, /OPENROUTER_API_KEY|openRouterApiKey|apiKey/iu);
  assert.doesNotMatch(workspace, /OPENROUTER_API_KEY|openRouterApiKey|apiKey/iu);
  assert.doesNotMatch(main, /console\.(?:log|info|warn|error)\([^\n]*OPENROUTER_API_KEY/iu);
  assert.doesNotMatch(runtime, /console\.(?:log|info|warn|error)\([^\n]*(?:OPENROUTER_API_KEY|openRouterApiKey)/iu);
});

test('application startup never resolves Python dependencies online', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const server = readText('runtime/parlant/yance_parlant_server.py');
  for (const source of [runtime, server]) {
    assert.doesNotMatch(source, /\b(?:pip|uv)\s+(?:install|sync)|subprocess[^\n]*(?:pip|uv)|git\s+clone|curl\s+http|Invoke-WebRequest/iu);
  }
  assert.match(runtime, /parlant-runtime|PARLANT_RUNTIME/iu, 'Electron must launch a pre-materialized packaged runtime');
});
