'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(__dirname, '../..');
const GRAPHITI_VERSION = 'v0.29.3';
const GRAPHITI_COMMIT = '021d3a57d511f21b10adaf7fa923bd5c1fce5e9d';
const GRAPHITI_UV_LOCK_BLOB = '38b26ce7d01f11287d71df7f5359867b85b3d6c4';
const NEO4J_VERSION = '2026.07.1';
const NEO4J_SHA256 = 'd70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162';
const TEMURIN_VERSION = 'jdk-21.0.11+10';
const TEMURIN_SHA256 = 'd3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64';
const CPYTHON_SHA256 = '18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d';

const repositoryPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Graphiti P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}
const readJson = relativePath => JSON.parse(readText(relativePath));

test('V2.1 Graphiti P0 seals exact mature OSS authorities and the first-party Neo4j checksum', () => {
  const lock = readJson('config/upstreams/v21-graphiti-p0.json');
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.workPackage, 'V21-GRAPHITI-P0-V1');
  assert.equal(lock.upstreams.graphiti.version, GRAPHITI_VERSION);
  assert.equal(lock.upstreams.graphiti.commit, GRAPHITI_COMMIT);
  assert.equal(lock.upstreams.graphiti.uvLockGitBlob, GRAPHITI_UV_LOCK_BLOB);
  assert.equal(lock.upstreams.neo4jCommunity.version, NEO4J_VERSION);
  assert.equal(lock.upstreams.neo4jCommunity.windowsX64Sha256, NEO4J_SHA256);
  assert.equal(lock.upstreams.neo4jCommunity.sha256Url, `https://dist.neo4j.org/neo4j-community-${NEO4J_VERSION}-windows.zip.sha256`);
  assert.equal(lock.upstreams.temurin.version, TEMURIN_VERSION);
  assert.equal(lock.upstreams.temurin.windowsX64AssetSha256, TEMURIN_SHA256);
  assert.equal(lock.upstreams.pythonBuildStandalone.windowsX64AssetSha256, CPYTHON_SHA256);
  assert.equal(lock.provider.baseUrl, 'https://openrouter.ai/api/v1');
  for (const key of ['chatModel', 'smallModel', 'rerankerModel', 'embeddingModel']) {
    assert.match(String(lock.provider[key] || ''), /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/iu, `${key} must be an explicit OpenRouter model id`);
  }
  const pkg = readJson('package.json');
  assert.equal(Object.keys(pkg.dependencies || {}).some(name => /graphiti|neo4j|python|uv/iu.test(name)), false);
});

test('Graphiti, Neo4j and Temurin redistribution obligations include full license texts', () => {
  const notices = readText('THIRD_PARTY_NOTICES.md');
  for (const required of ['Graphiti', 'Neo4j Community', 'Eclipse Temurin', 'python-build-standalone', 'CPython']) {
    assert.match(notices, new RegExp(required, 'u'));
  }
  for (const [relativePath, marker] of [
    ['third_party/licenses/graphiti-Apache-2.0.txt', /Apache License/u],
    ['third_party/licenses/neo4j-GPL-3.0.txt', /GNU GENERAL PUBLIC LICENSE/u],
    ['third_party/licenses/temurin-GPL-2.0-with-Classpath-Exception.txt', /GNU GENERAL PUBLIC LICENSE/u]
  ]) {
    const text = readText(relativePath);
    assert.match(text, marker);
    assert.ok(text.length > 500, `${relativePath} must contain upstream license text`);
  }
});

test('Electron Graphiti adapter is graph-specific, loopback-only and keeps runtime secrets out of ambient state', () => {
  const runtimePath = repositoryPath('electron/graphitiRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtime = require(runtimePath);
  assert.equal(runtime.GRAPHITI_VERSION, GRAPHITI_VERSION);
  assert.equal(runtime.GRAPHITI_COMMIT, GRAPHITI_COMMIT);
  assert.equal(runtime.assertLoopbackEndpoint('http://127.0.0.1:18766'), 'http://127.0.0.1:18766');
  for (const denied of ['http://0.0.0.0:18766', 'http://192.168.1.20:18766', 'https://127.0.0.1:18766']) {
    assert.throws(() => runtime.assertLoopbackEndpoint(denied), /loopback|Graphiti|endpoint/iu);
  }
  const env = runtime.buildGraphitiEnvironment({
    baseEnv: { OPENROUTER_API_KEY: 'ambient-denied', NEO4J_AUTH: 'ambient-denied', KEEP_ME: 'ambient-denied' },
    dataRoot: path.join(os.tmpdir(), 'yance-graphiti-contract-root'),
    openRouterApiKey: 'main-owned-openrouter-key',
    neo4jPassword: 'A'.repeat(43),
    loopbackToken: 'B'.repeat(43),
    chatModel: 'openai/gpt-4.1-mini',
    smallModel: 'openai/gpt-4.1-nano',
    rerankerModel: 'openai/gpt-4.1-nano',
    embeddingModel: 'openai/text-embedding-3-small'
  });
  assert.equal(env.KEEP_ME, undefined);
  assert.equal(env.OPENROUTER_API_KEY, 'main-owned-openrouter-key');
  assert.equal(env.YANCE_GRAPHITI_NEO4J_PASSWORD, 'A'.repeat(43));
  assert.equal(env.YANCE_GRAPHITI_LOOPBACK_TOKEN, 'B'.repeat(43));
  assert.equal(env.YANCE_GRAPHITI_DATA_ROOT, path.resolve(path.join(os.tmpdir(), 'yance-graphiti-contract-root')));
});

test('Graphiti Python bridge uses native temporal graph operations and OpenRouter-compatible clients', () => {
  const server = readText('runtime/graphiti/yance_graphiti_server.py');
  assert.match(server, /from graphiti_core import Graphiti/u);
  assert.match(server, /EpisodeType/u);
  assert.match(server, /OpenAIClient/u);
  assert.match(server, /OpenAIEmbedder/u);
  assert.match(server, /OpenAIRerankerClient/u);
  assert.match(server, /await\s+RUNTIME\.graphiti\.add_episode\(/u);
  assert.match(server, /await\s+RUNTIME\.graphiti\.search\(/u);
  assert.match(server, /group_id\s*=\s*relationship_group_id/u);
  assert.match(server, /reference_time\s*=/u);
  assert.doesNotMatch(server, /\brelationship_group_id\s*=\s*relationship_group_id\(/u, 'bridge must not shadow the relationship_group_id helper');
  assert.doesNotMatch(server, /class\s+(?:TemporalGraph|FactSupersession|GraphDatabase)|networkx|sqlite3/iu);
});

test('Graphiti relationship group ids are deterministic isolation keys and never expose channel send authority', () => {
  const runtimePath = repositoryPath('electron/graphitiRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtime = require(runtimePath);
  const a = runtime.relationshipGroupId('contact-A');
  assert.equal(a, runtime.relationshipGroupId('contact-A'));
  assert.notEqual(a, runtime.relationshipGroupId('contact-B'));
  assert.match(a, /^yance-rel-[a-f0-9]{64}$/u);
  const source = `${readText('electron/graphitiRelationshipRuntime.js')}\n${readText('runtime/graphiti/yance_graphiti_server.py')}`;
  assert.doesNotMatch(source, /sendMessage|sendText|sendMedia|channel\.send|whatsapp|telegram|facebook/iu);
});

test('Electron main owns Graphiti credential provisioning, ingestion, projection, degradation and shutdown', () => {
  const main = readText('electron/main.js');
  assert.match(main, /createGraphitiRelationshipRuntime/u);
  assert.match(main, /createNeo4jPassword/u);
  assert.match(main, /runtime:graphiti:neo4j/u);
  assert.match(main, /GRAPHITI_NEO4J_CREDENTIAL_PROVISION/u);
  assert.match(main, /credentialVaultHost\.executeDesktopMutation\(['"]persist['"]/u);
  assert.match(main, /addRelationshipEpisode\(/u);
  assert.match(main, /recallRelationshipFacts\(/u);
  assert.match(main, /\/api\/r32\/workspace\/contacts\/\$\{encodeURIComponent\(contactId\)\}\/graphiti-projection/u);
  assert.match(main, /graphiti:relationship-memory-degraded/u);
  assert.match(main, /stopGraphitiRelationshipRuntime\(/u);
  assert.match(main, /graphitiOwnershipPresent\(\)/u);
  assert.doesNotMatch(main, /YANCE_GRAPHITI_NEO4J_PASSWORD\s*=|OPENROUTER_API_KEY\s*=.*graphiti/iu);

  const runtimePath = repositoryPath('electron/graphitiRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtime = require(runtimePath);
  const password = runtime.createNeo4jPassword();
  assert.match(password, /^[A-Za-z0-9_-]{43}$/u);
});


function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createFakeGraphitiChild({ exitOnSpawn = false } = {}) {
  const child = new EventEmitter();
  child.pid = Math.floor(Math.random() * 10000) + 100;
  child.exitCode = null;
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.kill = () => true;
  if (exitOnSpawn) queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null); });
  return child;
}

function graphitiRuntimeHarness({ neo4jReadyPromise = Promise.resolve() } = {}) {
  const runtimePath = repositoryPath('electron/graphitiRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtimeModule = require(runtimePath);
  const spawned = [];
  let bridgeToken = '';
  const spawnProcess = (file, args = [], options = {}) => {
    const isAdmin = args[0] === 'dbms';
    const child = createFakeGraphitiChild({ exitOnSpawn: isAdmin });
    spawned.push({ file, args: [...args], options, child });
    if (args.includes('--host')) bridgeToken = String(options.env?.YANCE_GRAPHITI_LOOPBACK_TOKEN || '');
    return child;
  };
  const fakeFs = {
    existsSync(file) { return !String(file).endsWith('.neo4j-auth-initialized'); },
    mkdirSync() {},
    writeFileSync() {}
  };
  const fetchImpl = async (_url, options = {}) => {
    const challenge = String(options.headers?.['x-yance-graphiti-challenge'] || '');
    const proof = crypto.createHmac('sha256', bridgeToken).update(`yance-graphiti-health-v1:${challenge}`, 'utf8').digest('hex');
    return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, instanceProof: proof }); } };
  };
  const runtime = runtimeModule.createGraphitiRelationshipRuntime({
    resourcesPath: path.join(os.tmpdir(), 'graphiti-runtime-harness-resources'),
    dataRoot: path.join(os.tmpdir(), 'graphiti-runtime-harness-data'),
    getOpenRouterApiKey: async () => 'openrouter-secret',
    getNeo4jPassword: async () => 'A'.repeat(43),
    spawnProcess,
    fsImpl: fakeFs,
    fetchImpl,
    waitForNeo4jReady: async () => neo4jReadyPromise,
    startupTimeoutMs: 1000
  });
  return { runtime, spawned };
}

test('Graphiti bridge launch waits for authenticated Neo4j Bolt readiness instead of racing cold startup', async () => {
  const gate = deferred();
  const { runtime, spawned } = graphitiRuntimeHarness({ neo4jReadyPromise: gate.promise });
  const startPromise = runtime.start();
  await new Promise(resolve => setImmediate(resolve));
  const launchedBeforeNeo4jReady = spawned.filter(row => row.args.includes('--host'));
  assert.equal(launchedBeforeNeo4jReady.length, 0, 'Python bridge must not start before Neo4j Bolt is connectable');
  gate.resolve();
  await startPromise;
  assert.equal(spawned.filter(row => row.args.includes('--host')).length, 1);

  for (const row of spawned.filter(row => row.args[0] !== 'dbms')) {
    row.child.exitCode = 0;
    row.child.emit('exit', 0, 'SIGTERM');
  }
  await runtime.stop();
});

test('Graphiti runtime stop waits for both owned children to exit before reporting stopped', async () => {
  const { runtime, spawned } = graphitiRuntimeHarness();
  await runtime.start();
  const owned = spawned.filter(row => row.args[0] !== 'dbms');
  assert.equal(owned.length, 2);
  for (const row of owned) {
    row.child.kill = () => true;
  }

  let settled = false;
  const stopPromise = runtime.stop().then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'stop must remain pending while Graphiti/Neo4j still own live processes');

  for (const row of owned) {
    row.child.exitCode = 0;
    row.child.emit('exit', 0, 'SIGTERM');
  }
  assert.deepEqual(await stopPromise, { stopped: true });
  assert.equal(runtime.snapshot().graphitiPid, 0);
  assert.equal(runtime.snapshot().neo4jPid, 0);
});
