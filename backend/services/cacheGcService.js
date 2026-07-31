'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');
const { PRODUCT } = require('../../shared/constants');
const cacheManifest = require('../repositories/cacheManifestRepository');
const logger = require('./logger');

const SAFE_OWNERS = new Set(['thumbnails', 'ui-state', 'model-scan', 'temporary-media', 'update-downloads', 'manifests']);
const VERSION_FILE = path.join(PATHS.cache, 'cache-version.json');

function now() { return new Date().toISOString(); }
function insideCache(file) {
  const root = path.resolve(PATHS.cache);
  const target = path.resolve(file);
  return target === root || target.startsWith(`${root}${path.sep}`);
}
function safeRelative(relativePath) {
  const value = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.includes('../') || value === '..') throw Object.assign(new Error('Unsafe cache path'), { code: 'UNSAFE_CACHE_PATH' });
  return value;
}
function fileBytes(file) { try { return fs.statSync(file).size; } catch (_) { return 0; } }

function register(relativePath, input = {}) {
  const relative = safeRelative(relativePath);
  const owner = String(input.owner || relative.split('/')[0]);
  if (!SAFE_OWNERS.has(owner)) throw Object.assign(new Error('Unknown cache owner'), { code: 'UNKNOWN_CACHE_OWNER' });
  const timestamp = now();
  cacheManifest.upsert({ relativePath: relative, owner, schemaVersion: Number(input.schemaVersion || 1), sourceFingerprint: String(input.sourceFingerprint || ''), createdAt: String(input.createdAt || timestamp), lastAccessAt: timestamp, expiresAt: String(input.expiresAt || ''), protected: input.protected === true, payload: input.payload || {} });
  return relative;
}

function removeRelative(relative) {
  const safe = safeRelative(relative);
  const target = path.join(PATHS.cache, safe);
  if (!insideCache(target)) throw Object.assign(new Error('Cache target escaped root'), { code: 'UNSAFE_CACHE_PATH' });
  const bytes = fileBytes(target);
  fs.rmSync(target, { recursive: true, force: true });
  return bytes;
}

function purge(options = {}) {
  fs.mkdirSync(PATHS.cache, { recursive: true });
  const timestamp = Date.now();
  const currentVersion = String(PRODUCT.version);
  let priorVersion = '';
  try { priorVersion = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).productVersion || ''; } catch (_) {}
  const versionChanged = Boolean(priorVersion && priorVersion !== currentVersion);
  const report = { ok: true, versionChanged, priorVersion, currentVersion, removed: [], removedBytes: 0, skippedProtected: 0, at: now() };

  const rows = cacheManifest.list();
  for (const row of rows) {
    const expired = row.expires_at && Date.parse(row.expires_at) <= timestamp;
    const invalidVersionOwner = versionChanged && ['ui-state', 'model-scan', 'manifests'].includes(row.owner);
    if (!expired && !invalidVersionOwner && options.force !== true) continue;
    if (Number(row.protected || 0) === 1) { report.skippedProtected += 1; continue; }
    try {
      const bytes = removeRelative(row.relative_path);
      report.removed.push({ path: row.relative_path, owner: row.owner, reason: expired ? 'expired' : 'version-changed', bytes });
      report.removedBytes += bytes;
      cacheManifest.remove(row.relative_path);
    } catch (error) {
      report.ok = false;
      report.removed.push({ path: row.relative_path, owner: row.owner, reason: 'cleanup-failed', error: error.message });
    }
  }

  // Untracked temporary files older than 30 days are safe to remove only inside
  // explicitly disposable owner directories. No credentials, database, media
  // originals, outbox or backups are under this root.
  const cutoff = timestamp - 30 * 24 * 60 * 60 * 1000;
  for (const owner of SAFE_OWNERS) {
    const root = path.join(PATHS.cache, owner);
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const target = path.join(root, entry.name);
      let stat; try { stat = fs.statSync(target); } catch (_) { continue; }
      const relative = path.relative(PATHS.cache, target).replace(/\\/g, '/');
      const tracked = cacheManifest.exists(relative);
      if (!tracked && stat.mtimeMs < cutoff) {
        const bytes = removeRelative(relative);
        report.removed.push({ path: relative, owner, reason: 'untracked-old', bytes });
        report.removedBytes += bytes;
      }
    }
  }
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ schemaVersion: 1, productVersion: currentVersion, updatedAt: now() }, null, 2));
  cacheManifest.saveGcReport(report);
  if (report.removed.length) logger.info('cache', 'cache-gc-completed', { removed: report.removed.length, removedBytes: report.removedBytes, versionChanged });
  return report;
}

module.exports = { SAFE_OWNERS, register, purge, removeRelative, insideCache };
