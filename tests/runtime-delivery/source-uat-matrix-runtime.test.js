'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const supervisorPath = path.join(repoRoot, 'tools', 'runtime-delivery', 'source-uat-runtime-supervisor.js');
const launcherPath = path.join(repoRoot, 'tools', 'runtime-delivery', 'start-source-uat.js');
const supervisor = require(supervisorPath);

function tempMatrixRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-uat-matrix-'));
  fs.mkdirSync(path.join(root, 'services', 'matrix', '.runtime', 'synapse'), { recursive: true });
  fs.mkdirSync(path.join(root, 'services', 'matrix', '.runtime', 'element-web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'services', 'matrix', 'docker-compose.yml'), 'services: {}\n', 'utf8');
  return root;
}

function yanceElementConfig() {
  return {
    statusCode: 200,
    body: {
      brand: 'Yance',
      default_server_config: {
        'm.homeserver': {
          base_url: 'http://127.0.0.1:8008',
          server_name: 'yance.local'
        }
      }
    }
  };
}

function synapseVersions() {
  return { statusCode: 200, body: { versions: ['v1.1'] } };
}

function unavailable() {
  const error = new Error('connect ECONNREFUSED 127.0.0.1');
  error.code = 'ECONNREFUSED';
  throw error;
}

test('source UAT owns the existing Docker Compose Matrix dependency before Electron spawn', () => {
  assert.equal(
    typeof supervisor.ensureMatrixElementRuntime,
    'function',
    'source-UAT runtime supervisor must expose the canonical Matrix/Element readiness authority'
  );

  const launcher = fs.readFileSync(launcherPath, 'utf8');
  const ensureIndex = launcher.indexOf('await ensureMatrixElementRuntime');
  const electronIndex = launcher.indexOf('startDetachedElectron(');
  assert.ok(ensureIndex >= 0, 'source-UAT launcher must ensure the Matrix/Element runtime');
  assert.ok(electronIndex > ensureIndex, 'Matrix/Element readiness must complete before Electron is spawned');
  assert.doesNotMatch(launcher, /tools[\\/]matrix[\\/]bootstrap\.js|mautrix-whatsapp/u, 'source-UAT launch must not redownload or restart frozen bridge authorities');
});

test('when Synapse is already healthy, source UAT starts only Element with no dependency recreation', async () => {
  assert.equal(typeof supervisor.ensureMatrixElementRuntime, 'function');
  const root = tempMatrixRoot();
  const commands = [];
  let elementReady = false;
  const result = await supervisor.ensureMatrixElementRuntime({
    repoRoot: root,
    timeoutMs: 100,
    pollIntervalMs: 1,
    requestJson: async url => {
      if (url === 'http://127.0.0.1:8008/_matrix/client/versions') return synapseVersions();
      if (url === 'http://127.0.0.1:8080/config.json') return elementReady ? yanceElementConfig() : unavailable();
      throw new Error(`unexpected URL: ${url}`);
    },
    spawnSyncImpl(command, args) {
      commands.push({ command, args: [...args] });
      elementReady = true;
      return { status: 0, signal: null, error: null };
    }
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.startedServices, ['element']);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, 'docker');
  assert.deepEqual(commands[0].args.slice(-5), ['up', '-d', '--no-deps', 'element']);
  assert.equal(commands[0].args.includes('synapse'), false, 'healthy external Synapse must not be recreated');
});

test('when both Matrix endpoints are absent, source UAT starts only canonical Synapse and Element services', async () => {
  assert.equal(typeof supervisor.ensureMatrixElementRuntime, 'function');
  const root = tempMatrixRoot();
  const commands = [];
  let started = false;
  const result = await supervisor.ensureMatrixElementRuntime({
    repoRoot: root,
    timeoutMs: 100,
    pollIntervalMs: 1,
    requestJson: async url => {
      if (!started) return unavailable();
      if (url === 'http://127.0.0.1:8008/_matrix/client/versions') return synapseVersions();
      if (url === 'http://127.0.0.1:8080/config.json') return yanceElementConfig();
      throw new Error(`unexpected URL: ${url}`);
    },
    spawnSyncImpl(command, args) {
      commands.push({ command, args: [...args] });
      started = true;
      return { status: 0, signal: null, error: null };
    }
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.startedServices, ['synapse', 'element']);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args.slice(-4), ['up', '-d', 'synapse', 'element']);
  assert.equal(commands[0].args.includes('mautrix-whatsapp'), false);
});

test('missing exact-source Matrix materialization fails closed without invoking bootstrap or Docker', async () => {
  assert.equal(typeof supervisor.ensureMatrixElementRuntime, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-uat-matrix-missing-'));
  fs.mkdirSync(path.join(root, 'services', 'matrix'), { recursive: true });
  fs.writeFileSync(path.join(root, 'services', 'matrix', 'docker-compose.yml'), 'services: {}\n', 'utf8');
  let dockerCalls = 0;

  await assert.rejects(
    supervisor.ensureMatrixElementRuntime({
      repoRoot: root,
      timeoutMs: 20,
      pollIntervalMs: 1,
      requestJson: async () => unavailable(),
      spawnSyncImpl() {
        dockerCalls += 1;
        return { status: 0, signal: null, error: null };
      }
    }),
    error => {
      assert.equal(error.reasonCode, 'SOURCE_UAT_MATRIX_RUNTIME_MATERIALIZATION_MISSING');
      assert.match(error.message, /Matrix|Element|materialized|源码/u);
      return true;
    }
  );
  assert.equal(dockerCalls, 0);
});
