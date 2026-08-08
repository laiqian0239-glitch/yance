'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SDK_VERSION = '0.6.2';
const CODE_VERSION = '0.30.5';
const SDK_COMMIT = 'c48df1693731443682fe8c7f356ef9b8a33df6c0';
const CODE_COMMIT = '3e5ead65dcf3b7fdf1e2da595660eb85063a9722';
const SHA40 = /^[a-f0-9]{40}$/u;

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Letta P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('V2.1 Letta P0 pins the exact current OSS authorities', () => {
  const lock = readJson('config/upstreams/v21-letta-p0.json');
  assert.equal(lock.schemaVersion, 1);
  assert.deepEqual(Object.keys(lock.upstreams).sort(), ['lettaAgentSdk', 'lettaCode']);
  assert.deepEqual(lock.upstreams.lettaAgentSdk, {
    repository: 'https://github.com/letta-ai/letta-agent-sdk.git',
    version: 'v0.6.2',
    commit: SDK_COMMIT,
    package: '@letta-ai/letta-agent-sdk@0.6.2',
    license: 'Apache-2.0'
  });
  assert.deepEqual(lock.upstreams.lettaCode, {
    repository: 'https://github.com/letta-ai/letta-code.git',
    version: 'v0.30.5',
    commit: CODE_COMMIT,
    package: '@letta-ai/letta-code@0.30.5',
    license: 'Apache-2.0',
    cli: 'letta server --backend local --listen ws://127.0.0.1:0'
  });
  for (const upstream of Object.values(lock.upstreams)) assert.match(upstream.commit, SHA40);
});

test('Letta dependencies are direct exact pins and the Node floor satisfies the SDK', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.dependencies['@letta-ai/letta-agent-sdk'], SDK_VERSION);
  assert.equal(pkg.dependencies['@letta-ai/letta-code'], CODE_VERSION);
  assert.equal(pkg.engines.node, '>=22.19.0');

  const lock = readJson('package-lock.json');
  assert.equal(lock.packages[''].dependencies['@letta-ai/letta-agent-sdk'], SDK_VERSION);
  assert.equal(lock.packages[''].dependencies['@letta-ai/letta-code'], CODE_VERSION);
  assert.equal(lock.packages['node_modules/@letta-ai/letta-agent-sdk'].version, SDK_VERSION);
  assert.equal(lock.packages['node_modules/@letta-ai/letta-code'].version, CODE_VERSION);
  assert.match(lock.packages['node_modules/@letta-ai/letta-agent-sdk'].integrity || '', /^sha512-/u);
  assert.match(lock.packages['node_modules/@letta-ai/letta-code'].integrity || '', /^sha512-/u);
});

test('license copies and notices preserve the Apache-2.0 obligations', () => {
  const notices = readText('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Letta Agent SDK/u);
  assert.match(notices, /Letta Code/u);
  for (const relativePath of [
    'third_party/licenses/letta-agent-sdk-Apache-2.0.txt',
    'third_party/licenses/letta-code-Apache-2.0.txt'
  ]) {
    const license = readText(relativePath);
    assert.match(license, /Apache License/u);
    assert.ok(license.length > 1000, `${relativePath} must contain the upstream license text`);
  }
});

test('the desktop adapter uses the official Letta Code CLI and public Agent SDK remote API only', () => {
  const source = readText('electron/lettaAgentRuntime.js');
  for (const required of [
    '@letta-ai/letta-code',
    '@letta-ai/letta-agent-sdk',
    'server',
    '--backend',
    'local',
    '--listen',
    'ws://127.0.0.1:0',
    'LETTA_LOCAL_BACKEND_DIR',
    'SIGTERM'
  ]) assert.ok(source.includes(required), `adapter must contain ${required}`);
  assert.match(source, /const args = \[entrypoint, 'server', '--backend', 'local', '--listen', DEFAULT_LISTEN_URL\]/u);
  assert.match(source, /backend\s*:\s*['"]remote['"]/u);
  assert.doesNotMatch(source, /\bmanagementTransport\b|\bownedConnection\b/u);
  assert.doesNotMatch(source, /@letta-ai\/letta-agent-sdk\//u);
  assert.doesNotMatch(source, /\bapp-server\b/u, 'deprecated Letta app-server CLI alias must not be used');
  assert.doesNotMatch(source, /0\.0\.0\.0|192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\./u);
});

test('adapter pure guards bind Letta storage under Yance and reject non-loopback listeners', () => {
  assert.equal(fs.existsSync(repositoryPath('electron/lettaAgentRuntime.js')), true, 'Letta runtime adapter must exist before loading it');
  const runtimeModule = require(repositoryPath('electron/lettaAgentRuntime.js'));
  assert.equal(runtimeModule.LETTA_AGENT_SDK_VERSION, SDK_VERSION);
  assert.equal(runtimeModule.LETTA_CODE_VERSION, CODE_VERSION);
  assert.equal(runtimeModule.assertLoopbackListenUrl('ws://127.0.0.1:4545'), 'ws://127.0.0.1:4545');
  assert.equal(runtimeModule.assertLoopbackListenUrl('ws://[::1]:4545'), 'ws://[::1]:4545');
  for (const denied of ['ws://0.0.0.0:4545', 'ws://192.168.1.10:4545', 'wss://127.0.0.1:4545']) {
    assert.throws(() => runtimeModule.assertLoopbackListenUrl(denied), /loopback|listen|LETTA/iu);
  }

  const dataRoot = path.join(os.tmpdir(), 'yance-letta-contract-root');
  const env = runtimeModule.buildLettaEnvironment({ ELECTRON_RUN_AS_NODE: '1', LETTA_API_KEY: 'must-not-cross-local-boundary', KEEP_ME: 'yes' }, dataRoot);
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(Object.prototype.hasOwnProperty.call(env, 'ELECTRON_RUN_AS_NODE'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(env, 'LETTA_API_KEY'), false);
  assert.equal(env.LETTA_LOCAL_BACKEND_DIR, path.join(dataRoot, 'letta', 'local-backend'));
});

test('official Letta Code entrypoint resolves from the direct package instead of Agent SDK internals', () => {
  assert.equal(fs.existsSync(repositoryPath('electron/lettaAgentRuntime.js')), true, 'Letta runtime adapter must exist before loading it');
  const runtimeModule = require(repositoryPath('electron/lettaAgentRuntime.js'));
  const entry = runtimeModule.resolveLettaCodeEntrypoint();
  assert.equal(path.isAbsolute(entry), true);
  assert.match(entry.replaceAll('\\', '/'), /node_modules\/@letta-ai\/letta-code\/letta\.js$/u);
  assert.doesNotMatch(entry.replaceAll('\\', '/'), /letta-agent-sdk\/node_modules/u);
});

test('real Letta App Server management probe is sessionless and shuts down its owned child', { timeout: 90000 }, async () => {
  assert.equal(fs.existsSync(repositoryPath('electron/lettaAgentRuntime.js')), true, 'Letta runtime adapter must exist before loading it');
  const runtimeModule = require(repositoryPath('electron/lettaAgentRuntime.js'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-letta-probe-'));
  const runtime = runtimeModule.createLettaAgentRuntime({
    nodeExecutablePath: process.execPath,
    dataRoot,
    startupTimeoutMs: 45000
  });

  try {
    const started = await runtime.start();
    assert.equal(started.ready, true);
    assert.equal(runtimeModule.assertLoopbackListenUrl(started.url), started.url);
    assert.equal(started.dataRoot, path.join(dataRoot, 'letta', 'local-backend'));

    const agents = await runtime.listAgents();
    assert.ok(Array.isArray(agents));
    assert.equal(runtime.snapshot().ready, true);
  } finally {
    await runtime.stop();
  }

  const stopped = runtime.snapshot();
  assert.equal(stopped.ready, false);
  assert.equal(stopped.pid, null);
  assert.equal(stopped.lastExit?.signal === 'SIGTERM' || stopped.lastExit?.code === 0, true);
});
