'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../config');

const LEGACY_MARKERS = new Set([
  'accounts.json', 'contacts.json', 'conversations.json', 'messages.json',
  'notification-settings.json', 'system-policy.json', 'feature-flags.json',
  'desktop-settings.json', 'system-health-history.json', 'registry.json',
  'creds.json', 'credentials.safe.json', 'chat-engine.db', 'workbuddy.db',
  'database.db', 'yance.db', 'yance26.db', 'yance27.db'
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'backups', 'legacy-json', 'logs', 'media', 'tmp', 'cache']);

function splitExplicitRoots(value) {
  if (!value) return [];
  return String(value).split(path.delimiter).map(item => item.trim()).filter(Boolean);
}

function expectedYance27Root(currentRoot) {
  const resolved = path.resolve(currentRoot);
  const name = path.basename(resolved);
  let legacyName = '';
  if (/^(?:yance|yance29)$/i.test(name)) legacyName = 'Yance27';
  else if (/^\.(?:yance|yance29)$/i.test(name)) legacyName = '.yance27';
  else legacyName = process.platform === 'win32' ? 'Yance27' : '.yance27';
  return path.join(path.dirname(resolved), legacyName);
}

function hasMigrationMarker(root, maxDepth = 4) {
  const target = path.resolve(root);
  const visited = new Set();
  let found = false;
  function visit(directory, depth) {
    if (found || depth > maxDepth) return;
    const resolved = path.resolve(directory);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    let entries = [];
    try { entries = fs.readdirSync(resolved, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (entry.isFile() && (LEGACY_MARKERS.has(lower) || lower.startsWith('app-state-sync-key-') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3') || /(?:yance|workbuddy|chat|message).+\.db$/i.test(lower))) {
        found = true;
        return;
      }
      if (entry.isDirectory() && !SKIP_DIRS.has(lower)) visit(path.join(resolved, entry.name), depth + 1);
      if (found) return;
    }
  }
  visit(target, 0);
  return found;
}

function discoverLegacyDataRoots(options = {}) {
  const currentRoot = path.resolve(options.currentRoot || PATHS.root);
  const requested = Array.isArray(options.explicitRoots) && options.explicitRoots.length
    ? options.explicitRoots
    : [options.legacyRoot || expectedYance27Root(currentRoot)];
  const candidates = [];
  for (const value of requested) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    if (resolved === currentRoot || candidates.includes(resolved)) continue;
    try { if (!fs.statSync(resolved).isDirectory()) continue; } catch (_) { continue; }
    if (!hasMigrationMarker(resolved, Number(options.maxDepth || 4))) continue;
    candidates.push(resolved);
  }
  return {
    currentRoot,
    expectedLegacyRoot: path.resolve(options.legacyRoot || expectedYance27Root(currentRoot)),
    legacyRoots: candidates,
    discoveryPolicy: 'EXACT_YANCE27_ONLY',
    environmentRootsAccepted: false,
    siblingScanUsed: false,
    scannedAt: new Date().toISOString()
  };
}

module.exports = { discoverLegacyDataRoots, hasMigrationMarker, splitExplicitRoots, expectedYance27Root, LEGACY_MARKERS };
