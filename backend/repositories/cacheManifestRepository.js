'use strict';

const { getStore } = require('./storeProvider');

function upsert(row) {
  return getStore().db.prepare(`
    INSERT INTO cache_manifest(relative_path, owner, schema_version, source_fingerprint, created_at, last_access_at, expires_at, protected, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(relative_path) DO UPDATE SET
      owner=excluded.owner, schema_version=excluded.schema_version,
      source_fingerprint=excluded.source_fingerprint, last_access_at=excluded.last_access_at,
      expires_at=excluded.expires_at, protected=excluded.protected, payload_json=excluded.payload_json
  `).run(row.relativePath, row.owner, row.schemaVersion, row.sourceFingerprint, row.createdAt, row.lastAccessAt, row.expiresAt, row.protected ? 1 : 0, JSON.stringify(row.payload || {}));
}
function list() { return getStore().db.prepare('SELECT * FROM cache_manifest').all(); }
function remove(relativePath) { return getStore().db.prepare('DELETE FROM cache_manifest WHERE relative_path=?').run(String(relativePath)); }
function exists(relativePath) { return Boolean(getStore().db.prepare('SELECT 1 FROM cache_manifest WHERE relative_path=?').get(String(relativePath))); }
function saveGcReport(report) { getStore().setSetting('cache-governance', 'last-gc', report); }

module.exports = { upsert, list, remove, exists, saveGcReport };
