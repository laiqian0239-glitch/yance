'use strict';

const { getStore } = require('../repositories/storeProvider');

const NAMESPACE = 'backend-runtime-settings';
const DOCUMENT_KEY = 'document';
const RUNTIME_SETTING_KEYS = Object.freeze(['autoConnectAccounts', 'backupOnStart', 'mediaAutoDownload']);
const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  autoConnectAccounts: true,
  backupOnStart: true,
  mediaAutoDownload: false,
  updatedAt: ''
});

function runtimeSettingsError(key) {
  const error = new Error(`Backend runtime setting is not allowed: ${key}`);
  error.reasonCode = 'BACKEND_RUNTIME_SETTING_NOT_ALLOWED';
  error.settingKey = key;
  return error;
}

function normalize(value = {}) {
  return {
    schemaVersion: 1,
    autoConnectAccounts: value.autoConnectAccounts !== false,
    backupOnStart: value.backupOnStart !== false,
    mediaAutoDownload: value.mediaAutoDownload === true,
    updatedAt: String(value.updatedAt || '').slice(0, 64)
  };
}

function sanitizePatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw runtimeSettingsError('(invalid-patch)');
  const clean = {};
  for (const key of Object.keys(patch)) {
    if (!RUNTIME_SETTING_KEYS.includes(key)) throw runtimeSettingsError(key);
    clean[key] = patch[key] === true;
  }
  return clean;
}

class RuntimeSettingsService {
  constructor(options = {}) {
    this.storeProvider = typeof options.storeProvider === 'function' ? options.storeProvider : getStore;
    this.schemaReadyFor = null;
  }

  store() { return this.storeProvider(); }

  ensureSchema(storeOverride = null) {
    const store = storeOverride || this.store();
    if (this.schemaReadyFor === store) return store;
    store.db.exec('CREATE TABLE IF NOT EXISTS r32_settings (namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,key)) STRICT;');
    const row = store.db.prepare('SELECT 1 FROM r32_settings WHERE namespace=? AND key=?').get(NAMESPACE, DOCUMENT_KEY);
    if (!row) {
      const initial = normalize(DEFAULTS);
      store.db.prepare('INSERT INTO r32_settings(namespace,key,value_json,updated_at) VALUES(?,?,?,?)').run(NAMESPACE, DOCUMENT_KEY, JSON.stringify(initial), new Date().toISOString());
    }
    this.schemaReadyFor = store;
    return store;
  }

  read(storeOverride = null) {
    const store = this.ensureSchema(storeOverride || this.store());
    const row = store.db.prepare('SELECT value_json FROM r32_settings WHERE namespace=? AND key=?').get(NAMESPACE, DOCUMENT_KEY);
    try { return normalize(JSON.parse(row?.value_json || '{}')); }
    catch (_) { return normalize(DEFAULTS); }
  }

  update(patch = {}) {
    const cleanPatch = sanitizePatch(patch);
    const store = this.ensureSchema(this.store());
    return store.transaction(() => {
      const current = this.read(store);
      const next = normalize({ ...current, ...cleanPatch, updatedAt: new Date().toISOString() });
      store.db.prepare(`INSERT INTO r32_settings(namespace,key,value_json,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(namespace,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .run(NAMESPACE, DOCUMENT_KEY, JSON.stringify(next), next.updatedAt);
      return next;
    });
  }
}

const singleton = new RuntimeSettingsService();
module.exports = singleton;
module.exports.RuntimeSettingsService = RuntimeSettingsService;
module.exports.RUNTIME_SETTING_KEYS = RUNTIME_SETTING_KEYS;
module.exports.NAMESPACE = NAMESPACE;
