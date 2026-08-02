'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostModulePath = path.join(repoRoot, 'backend', 'services', 'authorityWriteHost.js');

function tempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a1-process-'));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

const childProgram = String.raw`
'use strict';
const path = require('node:path');
const repoRoot = process.argv[1];
const dbPath = process.argv[2];
const instanceId = process.argv[3];
const mode = process.argv[4];
process.env.YANCE_PROCESS_ROLE = 'desktop-host';
const { acquireAuthorityWriteHost } = require(path.join(repoRoot, 'backend', 'services', 'authorityWriteHost.js'));
const { SqliteConnectionBroker } = require(path.join(repoRoot, 'backend', 'lib', 'sqliteConnectionBroker.js'));
let host;
let broker;
try {
  host = acquireAuthorityWriteHost({ dbPath, instanceId });
  broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  broker.open();
  process.stdout.write(JSON.stringify({ ok: true, token: host.tokenSnapshot(), pid: process.pid }) + '\n');
  if (mode === 'hold') setInterval(() => host.heartbeat(), 100).unref();
  else { broker.close(); host.close(); }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code || error.reasonCode || '', message: error.message }) + '\n');
  process.exitCode = 42;
}
`;

function spawnAttempt(dbPath, instanceId, mode = 'exit') {
  return spawnSync(process.execPath, ['-e', childProgram, repoRoot, dbPath, instanceId, mode], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, YANCE_PROCESS_ROLE: 'desktop-host' }
  });
}

function waitForJsonLine(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`child readiness timeout: ${text}`)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      text += chunk;
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(text.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (!text.includes('\n')) {
        clearTimeout(timer);
        reject(new Error(`child exited before readiness: ${code} ${text}`));
      }
    });
  });
}

function waitForExit(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode != null || child.signalCode != null) return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => reject(new Error('child exit timeout')), timeoutMs);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('real second backend process is rejected while the first host is alive', async () => {
  assert.equal(fs.existsSync(hostModulePath), true, 'AuthorityWriteHost service must exist');
  const { root, dbPath } = tempDb();
  let first;
  try {
    first = spawn(process.execPath, ['-e', childProgram, repoRoot, dbPath, 'process-a', 'hold'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, YANCE_PROCESS_ROLE: 'desktop-host' }
    });
    const ready = await waitForJsonLine(first);
    assert.equal(ready.ok, true);

    const second = spawnAttempt(dbPath, 'process-b');
    assert.equal(second.status, 42, second.stdout + second.stderr);
    const result = JSON.parse(String(second.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.equal(result.ok, false);
    assert.ok(['SQLITE_OWNERSHIP_CONFLICT', 'AUTHORITY_WRITE_HOST_CONFLICT'].includes(result.code), result.code);
  } finally {
    if (first && first.exitCode == null) {
      try { first.kill('SIGKILL'); } catch (_) {}
      await waitForExit(first).catch(() => {});
    }
    cleanup(root);
  }
});

test('forced owner death permits takeover with a strictly newer generation and fencing token', async () => {
  assert.equal(fs.existsSync(hostModulePath), true, 'AuthorityWriteHost service must exist');
  const { root, dbPath } = tempDb();
  let first;
  try {
    first = spawn(process.execPath, ['-e', childProgram, repoRoot, dbPath, 'process-a', 'hold'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, YANCE_PROCESS_ROLE: 'desktop-host' }
    });
    const ready = await waitForJsonLine(first);
    assert.equal(ready.ok, true);
    assert.ok(Number(ready.token.hostGeneration) >= 1);
    assert.ok(Number(ready.token.fencingToken) >= 1);

    first.kill('SIGKILL');
    await waitForExit(first);

    const takeover = spawnAttempt(dbPath, 'process-b');
    assert.equal(takeover.status, 0, takeover.stdout + takeover.stderr);
    const result = JSON.parse(String(takeover.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.equal(result.ok, true);
    assert.ok(result.token.hostGeneration > ready.token.hostGeneration, JSON.stringify({ before: ready.token, after: result.token }));
    assert.ok(result.token.fencingToken > ready.token.fencingToken, JSON.stringify({ before: ready.token, after: result.token }));
  } finally {
    if (first && first.exitCode == null) {
      try { first.kill('SIGKILL'); } catch (_) {}
      await waitForExit(first).catch(() => {});
    }
    cleanup(root);
  }
});
