'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  autoLaunch: false,
  closeToTray: true,
  startMinimized: false,
  autoConnectAccounts: true,
  backupOnStart: true,
  gifAutoplay: true,
  stickerAutoplay: true,
  mediaAutoDownload: true,
  pauseAnimationWhenHidden: true,
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
  lastBackupAt: '',
  lastBackupName: '',
  updatedAt: ''
});

const BOOLEAN_KEYS = Object.freeze([
  'autoLaunch', 'closeToTray', 'startMinimized', 'autoConnectAccounts', 'backupOnStart',
  'gifAutoplay', 'stickerAutoplay', 'mediaAutoDownload', 'pauseAnimationWhenHidden',
  'autoCheckUpdates', 'autoDownloadUpdates'
]);

function normalize(value = {}) {
  const out = { ...DEFAULTS };
  for (const key of BOOLEAN_KEYS) if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = value[key] === true;
  out.lastBackupAt = String(value.lastBackupAt || '').slice(0, 64);
  out.lastBackupName = String(value.lastBackupName || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 180);
  out.updatedAt = String(value.updatedAt || '').slice(0, 64);
  return out;
}

function read(file) {
  try { return normalize(JSON.parse(fs.readFileSync(file, 'utf8') || '{}')); }
  catch (_) { return normalize({}); }
}

function write(file, patch = {}) {
  const current = read(file);
  const allowed = {};
  for (const key of BOOLEAN_KEYS) if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key] === true;
  if (Object.prototype.hasOwnProperty.call(patch, 'lastBackupAt')) allowed.lastBackupAt = patch.lastBackupAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'lastBackupName')) allowed.lastBackupName = patch.lastBackupName;
  const next = normalize({ ...current, ...allowed, updatedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

module.exports = { DEFAULTS, BOOLEAN_KEYS, normalize, read, write };
