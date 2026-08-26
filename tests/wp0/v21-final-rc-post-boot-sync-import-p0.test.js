'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  walkLegacyDatabases,
  databaseFingerprint
} = require('../../backend/migrations/legacySqliteMigrator');

function createLegacySqlite(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE wb_accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        label TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
    `);
    db.prepare('INSERT INTO wb_accounts (id, platform, label, active) VALUES (?, ?, ?, ?)')
      .run('acct-1', 'whatsapp', 'Existing account', 1);
  } finally {
    db.close();
  }
}

function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return databaseFingerprint(file, db);
  } finally {
    db.close();
  }
}

test('existing-data legacy discovery excludes Yance-owned migration snapshots without disabling legitimate imports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-postboot-migration-red-'));
  try {
    const legitimate = path.join(root, 'legacy', 'workbuddy.db');
    const migrationSnapshot = path.join(
      root,
      'migration-backups',
      'yance-r32.db.011_round12_round13_selfcheck_hardening.2026-07-27T06-04-24-043Z.sqlite'
    );

    createLegacySqlite(legitimate);
    fs.mkdirSync(path.dirname(migrationSnapshot), { recursive: true });
    fs.copyFileSync(legitimate, migrationSnapshot);

    const discovered = walkLegacyDatabases(root).map(file => path.resolve(file));

    assert.ok(
      discovered.includes(path.resolve(legitimate)),
      'a legitimate non-backup legacy SQLite source must remain discoverable; disabling the scanner is not an acceptable fix'
    );
    assert.equal(
      discovered.includes(path.resolve(migrationSnapshot)),
      false,
      'Yance-owned migration-backups SQLite snapshots must never be rediscovered as fresh legacy import sources'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('completed legacy migration identity is stable when the same existing-data payload is copied to an isolated UAT root', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-live-root-red-'));
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-uat-root-red-'));
  try {
    const source = path.join(sourceRoot, 'legacy', 'workbuddy.db');
    const relocated = path.join(isolatedRoot, 'legacy', 'workbuddy.db');

    createLegacySqlite(source);
    fs.mkdirSync(path.dirname(relocated), { recursive: true });
    fs.copyFileSync(source, relocated);

    assert.deepEqual(
      fs.readFileSync(relocated),
      fs.readFileSync(source),
      'fixture precondition: the UAT copy must be byte-identical to the source database'
    );

    const sourceFingerprint = fingerprint(source);
    const relocatedFingerprint = fingerprint(relocated);

    assert.equal(
      relocatedFingerprint,
      sourceFingerprint,
      'legacy migration completion identity must be content-stable across an isolated-root copy; absolute fixture location cannot manufacture a new migration source identity'
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
});

test('the proven migration family sits on the synchronous require(serverEntry) path after backend-boot-started', () => {
  const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  const migrationServiceSource = fs.readFileSync(path.join(ROOT, 'backend', 'services', 'migrationService.js'), 'utf8');

  const bootStartedIndex = serverSource.indexOf("productionDiagnostics.recordEvent('backend-boot-started'");
  const startupMigrateIndex = serverSource.indexOf("executeStartupAuthorityCommand('startup.migrate')");
  const listenIndex = serverSource.indexOf('server.listen(');

  assert.ok(bootStartedIndex >= 0, 'server must retain the fresh backend-boot-started diagnostic boundary');
  assert.ok(startupMigrateIndex > bootStartedIndex, 'startup.migrate must execute synchronously after backend-boot-started');
  assert.ok(listenIndex > startupMigrateIndex, 'startup.migrate must precede the asynchronous server.listen readiness boundary');
  assert.match(
    serverSource,
    /if \(!startupMigration\?\.ok\)[\s\S]{0,500}throw error;/u,
    'a failed startup.migrate result must synchronously throw before CommonJS server import returns'
  );
  assert.match(
    migrationServiceSource,
    /walkLegacyDatabases\(sourceRoot, \{ skipFiles: \[PATHS\.sqlite\] \}\)/u,
    'startup migration must consume the same legacy SQLite discovery seam exercised by this RED'
  );
  assert.match(
    migrationServiceSource,
    /migrateRoot\(PATHS\.root, \{[^}]*stopOnError: true/u,
    'current-root startup migration must remain fail-closed on a discovered SQLite import error'
  );
});
