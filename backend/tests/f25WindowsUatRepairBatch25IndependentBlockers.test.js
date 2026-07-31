'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function runNode(source, args = [], options = {}) {
  const root = options.root || temp('yance-b25-child-');
  const file = path.join(root, 'runner.js');
  fs.writeFileSync(file, source, 'utf8');
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 30000
  });
  if (!options.keepRoot) fs.rmSync(root, { recursive: true, force: true });
  return result;
}

function spawnNode(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('full-media restore crash after original move preserves current-only media in durable protection backup', () => {
  const root = temp('yance-b25-restore-crash-');
  const helper = path.join(root, 'restore-helper.js');
  const backupModule = path.join(REPO_ROOT, 'backend', 'services', 'backupService.js');
  fs.writeFileSync(helper, `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const mode = process.argv[2];
    require(${JSON.stringify(path.join(REPO_ROOT, 'shared', 'constants.js'))}).configureSharedReleaseIdentity({
      buildId: 'b25-test', manifestSha256: 'a'.repeat(64), productName: 'Yance', productVersion: '0.0.0',
      publicProductName: '言策', publicProductNameEnglish: 'Yance', publicVersion: '0.0.0', internalProductId: 'Yance'
    });
    const root = process.env.YANCE_DATA_DIR;
    const media = path.join(root, 'media');
    const backup = require(${JSON.stringify(backupModule)});
    if (mode === 'prepare') {
      fs.mkdirSync(media, { recursive: true });
      fs.writeFileSync(path.join(media, 'asset.txt'), 'BACKUP_OLD_MEDIA');
      const created = backup.createBackup('b25-full-media-source', { profile: 'full-media', roots: ['media'], skipRetention: true });
      fs.writeFileSync(path.join(media, 'asset.txt'), 'CURRENT_NEW_MEDIA');
      fs.writeFileSync(path.join(media, 'current-only.txt'), 'CURRENT_ONLY');
      const staged = backup.stageRestore(created.name);
      process.stdout.write(JSON.stringify({ backupName: created.name, planId: staged.plan.id }));
    } else if (mode === 'crash') {
      backup.executePendingRestore({
        requireClosedDatabase: true,
        phase: 'test-crash',
        onTransition(event) {
          if (event.rootName === 'media' && event.phase === 'original_moved') process.exit(99);
        }
      });
    } else if (mode === 'resume') {
      const result = backup.executePendingRestore({ requireClosedDatabase: true, phase: 'test-resume' });
      const protection = result.result.protectionBackup;
      const protectionFile = path.join(root, 'backups', protection, 'media', 'current-only.txt');
      process.stdout.write(JSON.stringify({
        asset: fs.readFileSync(path.join(media, 'asset.txt'), 'utf8'),
        protection,
        currentOnlyProtected: fs.existsSync(protectionFile) ? fs.readFileSync(protectionFile, 'utf8') : '',
        pendingExists: fs.existsSync(path.join(root, 'tmp', 'pending-restore.json'))
      }));
    }
  `, 'utf8');
  const env = { YANCE_DATA_DIR: root, NODE_ENV: 'test' };
  try {
    const prepared = spawnSync(process.execPath, [helper, 'prepare'], { cwd: REPO_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const crash = spawnSync(process.execPath, [helper, 'crash'], { cwd: REPO_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(crash.status, 99, crash.stderr);
    assert.equal(fs.existsSync(path.join(root, 'media')), false, 'main media root must be between rename phases');
    assert.equal(fs.existsSync(path.join(root, 'tmp', 'restore-work')), true);
    const resumed = spawnSync(process.execPath, [helper, 'resume'], { cwd: REPO_ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    const body = JSON.parse(resumed.stdout);
    assert.equal(body.asset, 'BACKUP_OLD_MEDIA');
    assert.equal(body.currentOnlyProtected, 'CURRENT_ONLY');
    assert.equal(body.pendingExists, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('SQLite settings worker rejects hardlink alias of primary DB and accepts only trusted settings path', () => {
  const root = temp('yance-b25-settings-alias-');
  const primary = path.join(root, 'store', 'yance-r32.db');
  const settings = path.join(root, 'settings', 'desktop-settings.db');
  const worker = path.join(REPO_ROOT, 'electron', 'sqliteSettingsWorker.js');
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  const db = new DatabaseSync(primary); db.exec('CREATE TABLE authority(value TEXT)'); db.close();
  try {
    fs.linkSync(primary, settings);
    const rejected = spawnSync(process.execPath, [worker], {
      input: JSON.stringify({ operation: 'write', dbPath: settings, namespace: 'settings', key: 'theme', value: 'dark' }),
      encoding: 'utf8',
      env: { ...process.env, YANCE_DATA_DIR: root, YANCE_PRIMARY_SQLITE_PATH: primary, YANCE_SETTINGS_SQLITE_PATH: settings }
    });
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(JSON.parse(rejected.stdout).reasonCode, /SQLITE_(SECOND_WRITE_OWNER_REJECTED|SETTINGS_PATH_ALIAS_REJECTED)/);

    fs.unlinkSync(settings);
    const allowed = spawnSync(process.execPath, [worker], {
      input: JSON.stringify({ operation: 'write', dbPath: settings, namespace: 'settings', key: 'theme', value: 'dark' }),
      encoding: 'utf8',
      env: { ...process.env, YANCE_DATA_DIR: root, YANCE_PRIMARY_SQLITE_PATH: primary, YANCE_SETTINGS_SQLITE_PATH: settings }
    });
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
    assert.equal(JSON.parse(allowed.stdout).written, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy stdout ready marker cannot settle startup and full identity tuple is required', async () => {
  const { createBackendStartupSupervisor } = require('../../electron/backendStartupSupervisor');
  const supervisor = createBackendStartupSupervisor({
    baseUrl: 'http://127.0.0.1:1',
    expectedPid: 424242,
    startupNonce: 'nonce',
    startupAttemptId: 'attempt',
    backendSessionId: 'session',
    timeoutMs: 5000,
    pollIntervalMs: 1000,
    requestReady: async () => ({ ok: false })
  });
  const promise = supervisor.start();
  assert.equal(supervisor.observeStdout('YANCE_R32_SERVER_READY\n'), false);
  assert.equal(supervisor.snapshot().settled, false);
  assert.equal(supervisor.observeStdout(`YANCE_R32_SERVER_READY ${JSON.stringify({ pid: 424242, startupNonce: 'nonce' })}\n`), false);
  assert.equal(supervisor.observeStdout(`YANCE_R32_SERVER_READY ${JSON.stringify({
    pid: 424242,
    startupNonce: 'nonce',
    runtimeContract: { startupAttemptId: 'attempt', backendSessionId: 'session' }
  })}\n`), true);
  assert.equal((await promise).source, 'stdout-ready');
});

test('main window navigation and privileged IPC reject data/about/blob/file and subframes', () => {
  const { isAllowedURL, isTrustedMainFrameIpcEvent } = require('../../electron/r32WindowSecurity');
  const origins = new Set(['http://127.0.0.1:3000']);
  assert.equal(isAllowedURL('http://127.0.0.1:3000/app', origins), true);
  for (const value of ['data:text/html,hello', 'about:blank', 'blob:http://127.0.0.1:3000/id', 'file:///tmp/a.html']) {
    assert.equal(isAllowedURL(value, origins), false, value);
  }
  const contents = { getURL: () => 'http://127.0.0.1:3000/app' };
  const top = { url: 'http://127.0.0.1:3000/app' }; top.top = top;
  assert.equal(isTrustedMainFrameIpcEvent({ sender: contents, senderFrame: top }, { webContents: contents, allowedOrigins: [...origins] }), true);
  const dataFrame = { url: 'data:text/html,pwn' }; dataFrame.top = dataFrame;
  assert.equal(isTrustedMainFrameIpcEvent({ sender: contents, senderFrame: dataFrame }, { webContents: contents, allowedOrigins: [...origins] }), false);
  const subframe = { url: top.url, top };
  assert.equal(isTrustedMainFrameIpcEvent({ sender: contents, senderFrame: subframe }, { webContents: contents, allowedOrigins: [...origins] }), false);
});

test('unawaited nested async transaction failure rolls back root transaction', async () => {
  const root = temp('yance-b25-nested-tx-');
  const db = new DatabaseSync(path.join(root, 'tx.db'));
  const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');
  const coordinator = new SqliteTransactionCoordinator(db);
  db.exec('CREATE TABLE t(v INTEGER) STRICT');
  try {
    await assert.rejects(
      coordinator.runAsync(async () => {
        db.prepare('INSERT INTO t(v) VALUES(1)').run();
        coordinator.runAsync(async () => {
          db.prepare('INSERT INTO t(v) VALUES(2)').run();
          throw Object.assign(new Error('NESTED_FAIL'), { code: 'NESTED_FAIL' });
        });
        return 'root-ok';
      }),
      error => error.code === 'NESTED_FAIL'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 0);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('simultaneous SQLite ownership claim allows at most one process', async () => {
  const root = temp('yance-b25-owner-race-');
  const helper = path.join(root, 'claim.js');
  const modulePath = path.join(REPO_ROOT, 'backend', 'lib', 'sqliteOwnership.js');
  fs.writeFileSync(helper, `
    'use strict';
    const { claimOwnership } = require(${JSON.stringify(modulePath)});
    const startAt = Number(process.argv[3]);
    while (Date.now() < startAt) {}
    try {
      const handle = claimOwnership({ dbPath: process.argv[2], staleMs: 5000 });
      process.stdout.write('CLAIMED');
      setTimeout(() => { handle.release(); process.exit(0); }, 1500);
    } catch (error) {
      process.stdout.write(String(error.code || error.message));
      process.exit(0);
    }
  `, 'utf8');
  try {
    for (let i = 0; i < 10; i += 1) {
      const dbPath = path.join(root, `race-${i}.db`);
      const startAt = Date.now() + 200;
      const [a, b] = await Promise.all([
        spawnNode(helper, [dbPath, String(startAt)], {}),
        spawnNode(helper, [dbPath, String(startAt)], {})
      ]);
      const claims = [a.stdout, b.stdout].filter(value => value === 'CLAIMED').length;
      assert.equal(claims, 1, JSON.stringify({ a, b }));
      assert.ok([a.stdout, b.stdout].some(value => /SQLITE_OWNERSHIP_(?:CONFLICT|CLAIM_BUSY)/.test(value)), JSON.stringify({ a, b }));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('node test contexts without explicit data root are isolated from user default data', () => {
  const configPath = path.join(REPO_ROOT, 'backend', 'config.js');
  const source = `
    delete process.env.YANCE_DATA_DIR;
    delete process.env.WORKBUDDY_DATA_DIR;
    process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || 'child-v8';
    process.stdout.write(require(${JSON.stringify(configPath)}).PATHS.root);
  `;
  const a = runNode(source, [], { env: { NODE_TEST_CONTEXT: 'child-v8-a' } });
  const b = runNode(source, [], { env: { NODE_TEST_CONTEXT: 'child-v8-b' } });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.notEqual(a.stdout, b.stdout);
  assert.match(a.stdout, /yance-node-tests/);
  assert.doesNotMatch(a.stdout, /\.yance(?:[\\/]|$)/);
});
