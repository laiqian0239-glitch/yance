'use strict';

const { getStore } = require('./storeProvider');

function get(namespace, key, fallback = null) {
  return getStore().getSetting(String(namespace), String(key), fallback);
}
function set(namespace, key, value) {
  getStore().setSetting(String(namespace), String(key), value);
  return value;
}
function remove(namespace, key) {
  const store = getStore();
  return store.db.prepare('DELETE FROM r32_settings WHERE namespace=? AND key=?').run(String(namespace), String(key));
}
function listDocumentNamespaces() {
  return getStore().db.prepare(`SELECT namespace, updated_at AS updatedAt, length(value_json) AS bytes FROM r32_settings WHERE key='document' ORDER BY namespace`).all();
}
function findRunningMigration() {
  return getStore().db.prepare("SELECT migration_id, started_at FROM r32_schema_migrations WHERE status='running' ORDER BY started_at DESC LIMIT 1").get() || null;
}
function getCompletedMigration(migrationId) {
  return getStore().db.prepare("SELECT migration_id AS id, checksum, completed_at AS appliedAt, status FROM r32_schema_migrations WHERE migration_id=? AND status='completed'").get(String(migrationId)) || null;
}
function countInterruptedSync() {
  return Number(getStore().db.prepare("SELECT COUNT(*) AS count FROM sync_checkpoints WHERE phase IN ('in_progress','interrupted','failed')").get()?.count || 0);
}
function schemaVersion() { return Number(getStore().getMeta?.('schemaVersion', 0) || 0); }
function dbPath() { return getStore().dbPath; }
function quickCheck() { return getStore().db.prepare('PRAGMA quick_check').get(); }
function pragma(name) {
  if (!/^[a-z_]+$/i.test(String(name))) throw Object.assign(new Error('Invalid PRAGMA name'), { code: 'INVALID_PRAGMA' });
  try { return Object.values(getStore().db.prepare(`PRAGMA ${name}`).get() || {})[0]; } catch (_) { return null; }
}
function countTable(table) {
  const allowed = new Set(['r32_accounts','contacts','r32_conversations','r32_messages','customer_profiles','relationship_insights','r32_send_queue']);
  if (!allowed.has(String(table))) throw Object.assign(new Error('Unsupported table count'), { code: 'UNSUPPORTED_TABLE' });
  return Number(getStore().db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

module.exports = {
  get, set, remove, listDocumentNamespaces, findRunningMigration, getCompletedMigration,
  countInterruptedSync, schemaVersion, dbPath, quickCheck, pragma, countTable
};
