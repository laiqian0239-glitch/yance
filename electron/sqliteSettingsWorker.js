#!/usr/bin/env node
'use strict';

// Reviewed SQLite settings boundary. Electron never imports node:sqlite; only
// this trusted Node child may perform the small, allow-listed settings protocol.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ALLOWED_OPERATIONS = new Set(['probe', 'read', 'write', 'delete']);
const ALLOWED_KEYS = new Set([
  'appearance',
  'interfaceDensity',
  'readingMode',
  'theme'
]);

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function readPayload() {
  const argvPayload = String(process.argv[2] || '').trim();
  const stdinPayload = argvPayload ? '' : fs.readFileSync(0, 'utf8').trim();
  const raw = argvPayload || stdinPayload;
  if (!raw) fail('WP7_SQLITE_BRIDGE_REQUEST_INVALID', 'SQLite worker request is missing');
  let payload;
  try { payload = JSON.parse(raw); }
  catch (error) { fail('WP7_SQLITE_BRIDGE_REQUEST_INVALID', 'SQLite worker request is not valid JSON', { message: error.message }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('WP7_SQLITE_BRIDGE_REQUEST_INVALID', 'SQLite worker request must be an object');
  return payload;
}

function canonicalPath(filePath) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  const parent = path.dirname(resolved);
  const canonicalParent = fs.realpathSync.native ? fs.realpathSync.native(parent) : fs.realpathSync(parent);
  return path.join(canonicalParent, path.basename(resolved));
}

function fileIdentity(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    nlink: Number(stat.nlink),
    size: String(stat.size)
  };
}

function sameFile(left, right) {
  if (!left || !right || !fs.existsSync(left) || !fs.existsSync(right)) return false;
  const a = fileIdentity(left);
  const b = fileIdentity(right);
  if (a && b && a.dev === b.dev && a.ino === b.ino) return true;
  return canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
}

function assertNoAliasComponents(filePath, dataRoot) {
  const root = path.resolve(dataRoot);
  const relative = path.relative(root, path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('WP7_SQLITE_BRIDGE_DB_PATH_INVALID', 'SQLite settings database must be inside the trusted data root', { filePath, dataRoot: root });
  }
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      fail('SQLITE_SETTINGS_PATH_ALIAS_REJECTED', 'SQLite settings path cannot contain symlink or junction components', { component: cursor });
    }
  }
}

function validateDbPath(requestedValue) {
  const dataRoot = String(process.env.YANCE_DATA_DIR || process.env.WORKBUDDY_DATA_DIR || '').trim();
  const trusted = String(process.env.YANCE_SETTINGS_SQLITE_PATH || '').trim();
  if (!dataRoot || !trusted || !path.isAbsolute(trusted) || path.extname(trusted).toLowerCase() !== '.db') {
    fail('WP7_SQLITE_BRIDGE_TRUSTED_PATH_REQUIRED', 'SQLite settings worker requires a trusted settings DB path from its parent process');
  }

  const trustedResolved = path.resolve(trusted);
  const requested = String(requestedValue || '').trim();
  if (requested && path.resolve(requested) !== trustedResolved) {
    fail('WP7_SQLITE_BRIDGE_DB_PATH_FORBIDDEN', 'Caller-provided SQLite path does not match the trusted settings database', {
      requested: path.resolve(requested), trusted: trustedResolved
    });
  }

  fs.mkdirSync(path.dirname(trustedResolved), { recursive: true });
  assertNoAliasComponents(trustedResolved, dataRoot);

  const primary = String(process.env.YANCE_PRIMARY_SQLITE_PATH || path.join(dataRoot, 'store', 'yance-r32.db')).trim();
  if (primary && path.resolve(primary).toLowerCase() === trustedResolved.toLowerCase()) {
    fail('SQLITE_SECOND_WRITE_OWNER_REJECTED', 'SQLite settings worker cannot open the broker-owned primary database', {
      dbPath: trustedResolved, primary: path.resolve(primary)
    });
  }
  if (primary && fs.existsSync(primary) && fs.existsSync(trustedResolved) && sameFile(primary, trustedResolved)) {
    fail('SQLITE_SECOND_WRITE_OWNER_REJECTED', 'SQLite settings worker cannot open an alias of the broker-owned primary database', {
      dbPath: trustedResolved, primary: path.resolve(primary), identity: fileIdentity(trustedResolved)
    });
  }
  if (fs.existsSync(trustedResolved)) {
    const stat = fs.lstatSync(trustedResolved);
    const identity = fileIdentity(trustedResolved);
    if (!stat.isFile() || stat.isSymbolicLink() || (identity && identity.nlink > 1)) {
      fail('SQLITE_SETTINGS_PATH_ALIAS_REJECTED', 'SQLite settings database must be a regular single-link file', {
        dbPath: trustedResolved, identity
      });
    }
  }
  return canonicalPath(trustedResolved);
}

function validateScope(payload) {
  const namespace = String(payload.namespace || 'settings');
  const key = String(payload.key || '');
  if (namespace !== 'settings' || !ALLOWED_KEYS.has(key)) {
    fail('WP7_SQLITE_BRIDGE_SCOPE_FORBIDDEN', 'SQLite settings namespace or key is outside the reviewed scope', { namespace, key });
  }
  return { namespace, key };
}

function openSettingsDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS yance_settings(namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(namespace, key)) STRICT;');
  return db;
}

function main() {
  const payload = readPayload();
  const operation = String(payload.operation || '');
  if (!ALLOWED_OPERATIONS.has(operation)) fail('WP7_SQLITE_BRIDGE_OPERATION_FORBIDDEN', 'SQLite worker operation is outside the reviewed protocol', { operation });

  if (operation === 'probe') {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE probe(value INTEGER) STRICT; INSERT INTO probe(value) VALUES(1);');
      const row = db.prepare('SELECT value FROM probe').get();
      process.stdout.write(`${JSON.stringify({ ok: row.value === 1, nodeSqliteAvailable: true })}\n`);
    } finally { db.close(); }
    return;
  }

  const dbPath = validateDbPath(payload.dbPath);
  const { namespace, key } = validateScope(payload);
  const db = openSettingsDatabase(dbPath);
  try {
    if (operation === 'read') {
      const row = db.prepare('SELECT value_json FROM yance_settings WHERE namespace = ? AND key = ?').get(namespace, key);
      process.stdout.write(`${JSON.stringify({ ok: true, found: Boolean(row), value: row ? JSON.parse(row.value_json) : null })}\n`);
      return;
    }
    if (operation === 'write') {
      const valueJson = JSON.stringify(payload.value ?? null);
      db.prepare('INSERT INTO yance_settings(namespace, key, value_json) VALUES(?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value_json = excluded.value_json').run(namespace, key, valueJson);
      process.stdout.write(`${JSON.stringify({ ok: true, written: true })}\n`);
      return;
    }
    db.prepare('DELETE FROM yance_settings WHERE namespace = ? AND key = ?').run(namespace, key);
    process.stdout.write(`${JSON.stringify({ ok: true, deleted: true })}\n`);
  } finally { db.close(); }
}

try { main(); }
catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, reasonCode: error.reasonCode || error.code || 'SQLITE_SETTINGS_WORKER_FAILED', message: error.message, details: error.details || {} })}\n`);
  process.exitCode = 1;
}
