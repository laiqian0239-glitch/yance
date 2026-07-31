'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POLICY_VERSION = 1;
const DEFAULTS = Object.freeze({
  maxAutomaticCount: 14,
  maxAutomaticAgeDays: 30,
  maxTotalBytes: 12 * 1024 * 1024 * 1024,
  minAutomaticKeep: 3
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function createdMs(row) {
  const value = Date.parse(clean(row?.manifest?.createdAt || row?.createdAt || row?.name));
  return Number.isFinite(value) ? value : 0;
}
function bytes(row) { return Math.max(0, Number(row?.manifest?.totalBytes || row?.bytes || 0)); }

function retentionClass(row) {
  const explicit = clean(row?.manifest?.retention?.className || row?.manifest?.retentionClass).toLowerCase();
  if (explicit) return explicit;
  const label = clean(row?.manifest?.label || row?.label).toLowerCase();
  if (/^(automatic|automatic-pre-r32-upgrade|automatic-pre-upgrade)(?:$|[-_])/u.test(label)) return 'automatic';
  if (/^(pre_restore|before-account-migration|portable_source|restore-protection|pre-restore)(?:$|[-_])/u.test(label)) return 'protection';
  if (/manual|operator|user/u.test(label)) return 'manual';
  return 'manual';
}

function referenceNames(options = {}) {
  const names = new Set();
  const pending = options.pendingRestore || null;
  for (const value of [pending?.backupName, pending?.name, pending?.protectionBackup]) if (clean(value)) names.add(clean(value));
  const activeStates = new Set(['verified-awaiting-restart', 'running', 'failed-awaiting-review', 'failed-needs-manual-recovery']);
  for (const row of Array.isArray(options.restoreHistory) ? options.restoreHistory : []) {
    if (!activeStates.has(clean(row?.state).toLowerCase())) continue;
    for (const value of [row?.backupName, row?.name, row?.protectionBackup]) if (clean(value)) names.add(clean(value));
  }
  return names;
}

function planRetention(backups = [], options = {}) {
  const policy = { ...DEFAULTS, ...(options.policy || {}) };
  const now = Number(options.nowMs || Date.now());
  const referenced = referenceNames(options);
  const rows = backups.map(row => ({
    ...row,
    retentionClass: retentionClass(row),
    createdMs: createdMs(row),
    bytes: bytes(row),
    referenced: referenced.has(clean(row.name)),
    locked: row?.manifest?.retention?.locked === true
  })).sort((a, b) => b.createdMs - a.createdMs || clean(b.name).localeCompare(clean(a.name)));

  const automatic = rows.filter(row => row.retentionClass === 'automatic');
  const protectedRows = rows.filter(row => row.retentionClass !== 'automatic' || row.locked || row.referenced);
  const removable = automatic.filter(row => !row.locked && !row.referenced);
  const removeNames = new Set();
  const minKeep = Math.max(0, Number(policy.minAutomaticKeep || 0));

  removable.forEach((row, index) => {
    const ageDays = row.createdMs ? (now - row.createdMs) / 86400000 : Infinity;
    const outsideNewestMinimum = index >= minKeep;
    if (outsideNewestMinimum && ageDays > Number(policy.maxAutomaticAgeDays || DEFAULTS.maxAutomaticAgeDays)) removeNames.add(row.name);
  });

  const keptAutomatic = () => automatic.filter(row => !removeNames.has(row.name));
  while (keptAutomatic().length > Math.max(minKeep, Number(policy.maxAutomaticCount || DEFAULTS.maxAutomaticCount))) {
    const candidate = [...keptAutomatic()].reverse().find(row => !row.locked && !row.referenced);
    if (!candidate) break;
    removeNames.add(candidate.name);
  }

  let remainingBytes = rows.filter(row => !removeNames.has(row.name)).reduce((sum, row) => sum + row.bytes, 0);
  const maxBytes = Math.max(0, Number(policy.maxTotalBytes || DEFAULTS.maxTotalBytes));
  if (maxBytes > 0) {
    for (const candidate of [...automatic].reverse()) {
      if (remainingBytes <= maxBytes) break;
      if (removeNames.has(candidate.name) || candidate.locked || candidate.referenced) continue;
      if (keptAutomatic().length <= minKeep) break;
      removeNames.add(candidate.name);
      remainingBytes -= candidate.bytes;
    }
  }

  const remove = rows.filter(row => removeNames.has(row.name));
  const keep = rows.filter(row => !removeNames.has(row.name));
  return {
    policyVersion: POLICY_VERSION,
    policy,
    total: rows.length,
    automatic: automatic.length,
    protected: protectedRows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    remainingBytes: keep.reduce((sum, row) => sum + row.bytes, 0),
    remove: remove.map(row => ({ name: row.name, dir: row.dir, bytes: row.bytes, createdAt: row.manifest?.createdAt || '', reason: 'automatic-retention-policy' })),
    keep: keep.map(row => ({ name: row.name, retentionClass: row.retentionClass, referenced: row.referenced, locked: row.locked })),
    pressure: {
      countExceeded: automatic.length > Number(policy.maxAutomaticCount || DEFAULTS.maxAutomaticCount),
      bytesExceeded: rows.reduce((sum, row) => sum + row.bytes, 0) > maxBytes,
      protectedOnlyPreventsTarget: keep.reduce((sum, row) => sum + row.bytes, 0) > maxBytes && keptAutomatic().length <= minKeep
    }
  };
}

function applyRetention(backups = [], options = {}) {
  const plan = planRetention(backups, options);
  const root = options.backupRoot ? path.resolve(options.backupRoot) : '';
  const removed = [];
  const failures = [];
  if (options.dryRun === true) return { ...plan, removed, failures, dryRun: true };
  for (const row of plan.remove) {
    try {
      const target = path.resolve(row.dir || '');
      if (!root || target === root || !target.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('恢复点路径不在受控备份目录内'), { code: 'BACKUP_RETENTION_PATH_OUTSIDE_ROOT' });
      }
      fs.rmSync(target, { recursive: true, force: true });
      removed.push({ ...row, removedAt: new Date().toISOString() });
    } catch (error) {
      failures.push({ name: row.name, code: error.code || 'BACKUP_RETENTION_DELETE_FAILED', message: error.message });
    }
  }
  return { ...plan, removed, failures, dryRun: false, pass: failures.length === 0 };
}

module.exports = { POLICY_VERSION, DEFAULTS, retentionClass, planRetention, applyRetention };
