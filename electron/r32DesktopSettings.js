'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULTS, normalizeDesktopSettings, sanitizeDesktopSettingsPatch, DESKTOP_SETTING_KEYS } = require('./desktopSettingsSchema');

const DESKTOP_NAMESPACE = 'desktop-settings';
const DESKTOP_DOCUMENT_KEY = 'document';

function nowIso() { return new Date().toISOString(); }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function stableClone(value) { return JSON.parse(JSON.stringify(value)); }

function atomicWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  let fd = null;
  try {
    fd = fs.openSync(temp, 'w', 0o600);
    fs.writeFileSync(fd, data, 'utf8');
    try { fs.fsyncSync(fd); } catch (_) {}
    fs.closeSync(fd);
    fd = null;
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch (_) {}
    }
    fs.renameSync(temp, filePath);
    try {
      const dir = fs.openSync(path.dirname(filePath), 'r');
      try { fs.fsyncSync(dir); } catch (_) {}
      fs.closeSync(dir);
    } catch (_) {}
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
  }
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { return { error }; }
}

class R32DesktopSettings {
  constructor(filePath) {
    // Desktop settings are intentionally outside the authoritative core SQLite
    // database. The backend is the only core DB writer; Electron owns only this
    // desktop UI preference document.
    const resolved = path.resolve(filePath || 'desktop-settings.json');
    this.filePath = resolved.endsWith('.json') ? resolved : path.join(path.dirname(resolved), 'desktop-settings.json');
    this.dbPath = this.filePath; // compatibility for diagnostics that used the old name
    ensureDirectory(path.dirname(this.filePath));
    this.ensure();
  }
  ensure() {
    if (fs.existsSync(this.filePath)) return;
    atomicWriteJson(this.filePath, {
      schemaVersion: 1,
      namespace: DESKTOP_NAMESPACE,
      key: DESKTOP_DOCUMENT_KEY,
      updatedAt: nowIso(),
      value: normalizeDesktopSettings(DEFAULTS)
    });
  }
  _readDocument() {
    const loaded = readJsonFile(this.filePath);
    if (!loaded.error && loaded && typeof loaded === 'object') return loaded;
    const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(this.filePath, corruptPath); } catch (_) {}
    const repaired = {
      schemaVersion: 1,
      namespace: DESKTOP_NAMESPACE,
      key: DESKTOP_DOCUMENT_KEY,
      updatedAt: nowIso(),
      repairedFromCorruption: true,
      corruptBackupPath: corruptPath,
      value: normalizeDesktopSettings(DEFAULTS)
    };
    atomicWriteJson(this.filePath, repaired);
    return repaired;
  }
  read() {
    const document = this._readDocument();
    return normalizeDesktopSettings(document.value || document.settings || document);
  }
  update(patch = {}) {
    const allowed = sanitizeDesktopSettingsPatch(patch);
    const current = this.read();
    const partial = {};
    for (const key of DESKTOP_SETTING_KEYS) if (Object.prototype.hasOwnProperty.call(patch, key)) partial[key] = allowed[key];
    const next = normalizeDesktopSettings({ ...current, ...partial, updatedAt: nowIso() });
    atomicWriteJson(this.filePath, {
      schemaVersion: 1,
      namespace: DESKTOP_NAMESPACE,
      key: DESKTOP_DOCUMENT_KEY,
      updatedAt: next.updatedAt,
      value: stableClone(next)
    });
    return next;
  }
  verify() {
    const document = this._readDocument();
    const text = fs.readFileSync(this.filePath, 'utf8');
    const settings = normalizeDesktopSettings(document.value || document.settings || document);
    return {
      ok: true,
      updatedAt: settings.updatedAt || document.updatedAt || '',
      bytes: Buffer.byteLength(text),
      filePath: this.filePath,
      dbPath: this.filePath,
      writableNamespace: DESKTOP_NAMESPACE,
      namespaces: [DESKTOP_NAMESPACE],
      storage: 'json',
      sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex')
    };
  }
}
module.exports = { R32DesktopSettings, DESKTOP_NAMESPACE, DESKTOP_DOCUMENT_KEY };
