'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { PATHS } = require('../config');
const { PRODUCT } = require('../../shared/constants');
const logger = require('./logger');
const backupRetention = require('./backupRetentionAuthority');

const ROOTS = Object.freeze({
  store: PATHS.db,
  models: PATHS.models,
  whatsappAuth: PATHS.whatsappAuth,
  secure: PATHS.secure,
  aiAssets: PATHS.aiAssets,
  notificationSounds: PATHS.notificationSounds
});

const OPTIONAL_ROOTS = Object.freeze({ media: PATHS.media });
const ALL_ROOTS = Object.freeze({ ...ROOTS, ...OPTIONAL_ROOTS });
const ROOT_LABELS = Object.freeze({
  store: '核心数据与系统设置',
  models: '模型注册、路由与验证记录',
  whatsappAuth: 'WhatsApp本地认证',
  secure: '系统加密凭据文件',
  aiAssets: '提示词、知识库与轻量AI资产',
  notificationSounds: '用户自定义提示音',
  media: '图片、视频、语音、贴纸与文件'
});
const BACKUP_PROFILES = Object.freeze({
  core: Object.keys(ROOTS),
  'data-only': ['store', 'models', 'aiAssets', 'notificationSounds'],
  'full-media': [...Object.keys(ROOTS), 'media']
});

const PENDING_FILE = path.join(PATHS.tmp, 'pending-restore.json');
const HISTORY_ROOT = path.join(PATHS.tmp, 'restore-history');
const WORK_ROOT = path.join(PATHS.tmp, 'restore-work');

function fsyncDirectory(directory) {
  let fd = null;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
    // Windows may reject fsync on a directory handle. The file itself is still
    // fsynced before rename; keep the directory sync as a best-effort barrier.
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
  }
}

function listFiles(root, base = root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push({ full, rel: path.relative(base, full) });
  }
  return out;
}

function directoryStats(root) {
  const files = listFiles(root);
  return { files: files.length, bytes: files.reduce((sum, row) => {
    try { return sum + fs.statSync(row.full).size; } catch (_) { return sum; }
  }, 0) };
}

function checksum(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function addManifestFile(manifest, file, manifestPath) {
  const size = fs.statSync(file).size;
  manifest.totalBytes += size;
  manifest.files.push({ path: manifestPath, size, sha256: checksum(file) });
}

function createConsistentSqliteSnapshot(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 15000');
    const escaped = destination.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
  const verify = new DatabaseSync(destination, { readOnly: true });
  try {
    const row = verify.prepare('PRAGMA integrity_check').get();
    const result = row ? String(Object.values(row)[0] || '') : '';
    if (result.toLowerCase() !== 'ok') throw Object.assign(new Error(`SQLite备份完整性检查失败：${result || 'unknown'}`), { code: 'SQLITE_BACKUP_INTEGRITY_FAILED' });
  } finally {
    verify.close();
  }
}

function safeBackupName(name) {
  const input = String(name || '');
  const safe = input.replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe !== input) throw Object.assign(new Error('备份名称无效'), { code: 'INVALID_BACKUP_NAME', status: 400 });
  return safe;
}

function safeRootName(name) {
  const rootName = String(name || '');
  if (!ALL_ROOTS[rootName]) throw Object.assign(new Error(`备份根目录不受支持：${rootName}`), { code: 'BACKUP_ROOT_NOT_ALLOWED', status: 400 });
  return rootName;
}

function resolveManifestEntry(backupDir, entry = {}) {
  const raw = String(entry.path || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw Object.assign(new Error(`备份路径无效：${raw}`), { code: 'INVALID_BACKUP_ENTRY', status: 400 });
  const parts = raw.split('/').filter(Boolean);
  if (parts.length < 2 || parts.some(part => part === '.' || part === '..')) throw Object.assign(new Error(`备份路径越界：${raw}`), { code: 'BACKUP_PATH_TRAVERSAL', status: 400 });
  const rootName = safeRootName(parts.shift());
  const targetRoot = ALL_ROOTS[rootName];
  const source = path.resolve(backupDir, raw);
  const backupRoot = `${path.resolve(backupDir)}${path.sep}`;
  if (!source.startsWith(backupRoot)) throw Object.assign(new Error(`备份源路径越界：${raw}`), { code: 'BACKUP_PATH_TRAVERSAL', status: 400 });
  const target = path.resolve(targetRoot, ...parts);
  const allowedTargetRoot = `${path.resolve(targetRoot)}${path.sep}`;
  if (!target.startsWith(allowedTargetRoot)) throw Object.assign(new Error(`恢复目标越界：${raw}`), { code: 'RESTORE_PATH_TRAVERSAL', status: 400 });
  return { source, target, rootName, relative: parts.join(path.sep), manifestPath: raw };
}

function createBackup(label = 'manual', options = {}) {
  fs.mkdirSync(PATHS.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = String(label || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'manual';
  const dir = path.join(PATHS.backups, `${stamp}-${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  const mediaStats = directoryStats(PATHS.media);
  const manifest = {
    schemaVersion: 3,
    product: {
      name: PRODUCT.publicName,
      version: PRODUCT.publicVersion,
      updateName: PRODUCT.updateName,
      updateVersion: PRODUCT.updateVersion,
      internalProductId: PRODUCT.internalProductId,
      build: PRODUCT.build
    },
    createdAt: new Date().toISOString(),
    label: String(label || 'manual').slice(0, 80),
    machine: { platform: process.platform, arch: process.arch, hostnameHash: crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12) },
    profile: String(options.profile || 'core'),
    retention: {
      policyVersion: backupRetention.POLICY_VERSION,
      className: backupRetention.retentionClass({ manifest: { label: String(label || 'manual') } }),
      locked: options.lockRetention === true
    },
    roots: Object.keys(ROOTS),
    coverage: Object.entries(ALL_ROOTS).map(([id, root]) => ({ id, label: ROOT_LABELS[id], source: root, included: id !== 'media' })),
    excluded: [
      { id: 'media', label: '媒体缓存与下载文件', reason: '标准恢复点默认不复制大型媒体，可选择完整媒体备份', files: mediaStats.files, bytes: mediaStats.bytes },
      { id: 'ollama-base-models', label: 'Ollama大型基础模型', reason: '仅记录模型注册信息，不复制外部模型文件' }
    ],
    files: [],
    totalBytes: 0
  };
  const profile = String(options.profile || 'core');
  const profileRoots = BACKUP_PROFILES[profile] || BACKUP_PROFILES.core;
  const selectedRoots = Array.isArray(options.roots) && options.roots.length ? [...new Set(options.roots.map(safeRootName))] : [...profileRoots];
  manifest.profile = BACKUP_PROFILES[profile] ? profile : 'custom';
  manifest.roots = selectedRoots;
  manifest.coverage = manifest.coverage.map(row => ({ ...row, included: selectedRoots.includes(row.id) }));
  if (selectedRoots.includes('media')) manifest.excluded = manifest.excluded.filter(row => row.id !== 'media');
  for (const rootName of selectedRoots) {
    const root = ALL_ROOTS[rootName];
    fs.mkdirSync(root, { recursive: true });
    const sqliteSource = path.resolve(PATHS.sqlite);
    const hasSqlite = rootName === 'store' && fs.existsSync(sqliteSource);
    if (hasSqlite) {
      const sqliteRelative = path.relative(root, sqliteSource);
      const sqliteManifestPath = path.posix.join(rootName, sqliteRelative.split(path.sep).join('/'));
      const sqliteTarget = path.join(dir, ...sqliteManifestPath.split('/'));
      createConsistentSqliteSnapshot(sqliteSource, sqliteTarget);
      addManifestFile(manifest, sqliteTarget, sqliteManifestPath);
    }
    for (const file of listFiles(root)) {
      const resolvedFile = path.resolve(file.full);
      if (hasSqlite && (resolvedFile === sqliteSource || resolvedFile === `${sqliteSource}-wal` || resolvedFile === `${sqliteSource}-shm`)) continue;
      const rel = path.posix.join(rootName, file.rel.split(path.sep).join('/'));
      const target = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.full, target);
      addManifestFile(manifest, target, rel);
    }
  }
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  atomicWrite(path.join(dir, 'manifest.json'), manifest);
  clearVerificationCache(path.basename(dir));
  logger.info('backup', 'backup-created', { dir, files: manifest.files.length, bytes: manifest.totalBytes, label: manifest.label, roots: manifest.roots });
  let retention = null;
  if (options.skipRetention !== true) {
    retention = enforceRetention();
    if (retention.failures?.length) logger.warn('backup', 'backup-retention-partial-failure', { failures: retention.failures });
    else if (retention.removed?.length) logger.info('backup', 'backup-retention-complete', { removed: retention.removed.length, kept: retention.keep?.length || 0 });
  }
  return { ok: true, name: path.basename(dir), dir, manifest, retention };
}

function readManifest(name) {
  const safe = safeBackupName(name);
  const dir = path.join(PATHS.backups, safe);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw Object.assign(new Error('找不到备份清单'), { code: 'BACKUP_NOT_FOUND', status: 404 });
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (_) { throw Object.assign(new Error('备份清单无法读取'), { code: 'BACKUP_MANIFEST_INVALID', status: 400 }); }
  return { safe, dir, manifestPath, manifest };
}

function listBackups() {
  if (!fs.existsSync(PATHS.backups)) return [];
  return fs.readdirSync(PATHS.backups, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = path.join(PATHS.backups, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
      return { name: entry.name, dir, manifest };
    })
    .sort((a, b) => String(b.manifest?.createdAt || b.name).localeCompare(String(a.manifest?.createdAt || a.name)));
}

function verifyBackupUncached(name) {
  try {
    const { safe, dir, manifest } = readManifest(name);
    if (![1, 2, 3].includes(Number(manifest.schemaVersion))) return { ok: false, code: 'BACKUP_SCHEMA_UNSUPPORTED', message: '备份格式不受支持', name: safe, filesChecked: 0 };
    const roots = Array.isArray(manifest.roots) && manifest.roots.length ? manifest.roots : [...new Set((manifest.files || []).map(entry => String(entry.path || '').split('/')[0]).filter(Boolean))];
    roots.forEach(safeRootName);
    let filesChecked = 0;
    let totalBytes = 0;
    for (const entry of manifest.files || []) {
      const resolved = resolveManifestEntry(dir, entry);
      if (!roots.includes(resolved.rootName)) return { ok: false, code: 'BACKUP_ROOT_MANIFEST_MISMATCH', message: `备份根目录与清单不一致：${entry.path}`, name: safe, filesChecked };
      if (!fs.existsSync(resolved.source)) return { ok: false, code: 'BACKUP_FILE_MISSING', message: `备份文件缺失：${entry.path}`, name: safe, filesChecked };
      const stat = fs.statSync(resolved.source);
      if (!stat.isFile()) return { ok: false, code: 'BACKUP_ENTRY_NOT_FILE', message: `备份条目不是文件：${entry.path}`, name: safe, filesChecked };
      if (Number(entry.size) !== stat.size) return { ok: false, code: 'BACKUP_SIZE_MISMATCH', message: `备份大小不一致：${entry.path}`, name: safe, filesChecked };
      if (!/^[a-f0-9]{64}$/i.test(String(entry.sha256 || '')) || checksum(resolved.source) !== entry.sha256) return { ok: false, code: 'BACKUP_CHECKSUM_FAILED', message: `备份校验失败：${entry.path}`, name: safe, filesChecked };
      filesChecked += 1;
      totalBytes += stat.size;
    }
    return { ok: true, code: 'BACKUP_VALID', message: '完整性与路径安全校验通过', name: safe, filesChecked, totalBytes, roots, manifest };
  } catch (error) {
    return { ok: false, code: error.code || 'BACKUP_VERIFY_FAILED', message: error.message, name: String(name || ''), filesChecked: 0 };
  }
}


const VERIFICATION_CACHE = new Map();
const VERIFICATION_CACHE_TTL_MS = Math.max(1000, Number(process.env.YANCE_BACKUP_VERIFY_TTL_MS || 300000));

function verifyBackup(name, options = {}) {
  let safe = '';
  let signature = '';
  try {
    safe = safeBackupName(name);
    const manifestPath = path.join(PATHS.backups, safe, 'manifest.json');
    const stat = fs.statSync(manifestPath);
    signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = VERIFICATION_CACHE.get(safe);
    if (!options.force && cached && cached.signature === signature && Date.now() - cached.at < VERIFICATION_CACHE_TTL_MS) {
      return cached.result;
    }
  } catch (_) {}
  const result = verifyBackupUncached(name);
  if (safe) VERIFICATION_CACHE.set(safe, { signature, at: Date.now(), result });
  return result;
}

function clearVerificationCache(name = '') {
  if (name) VERIFICATION_CACHE.delete(String(name));
  else VERIFICATION_CACHE.clear();
}

function pendingRestore() {
  if (!fs.existsSync(PENDING_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch (_) { return { state: 'invalid', error: '恢复任务文件无法读取' }; }
}

function stageRestore(name) {
  const verification = verifyBackup(name, { force: true });
  if (!verification.ok) throw Object.assign(new Error(verification.message), { code: verification.code, status: 400 });
  const existing = pendingRestore();
  if (existing && existing.state !== 'completed' && existing.state !== 'cancelled') throw Object.assign(new Error('已经存在等待执行的恢复任务，请先取消或重启完成'), { code: 'RESTORE_ALREADY_PENDING', status: 409 });
  const manifestFile = path.join(PATHS.backups, verification.name, 'manifest.json');
  const plan = {
    schemaVersion: 2,
    id: `restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    backupName: verification.name,
    manifestSha256: checksum(manifestFile),
    requestedAt: new Date().toISOString(),
    state: 'verified-awaiting-restart',
    roots: verification.roots,
    files: verification.filesChecked,
    totalBytes: verification.totalBytes,
    requiresRestart: true
  };
  atomicWrite(PENDING_FILE, plan);
  logger.warn('backup', 'restore-staged', { backupName: verification.name, planId: plan.id, files: plan.files, roots: plan.roots });
  return { ok: true, staged: true, plan };
}

function cancelPendingRestore() {
  const plan = pendingRestore();
  if (!plan) return { ok: true, cancelled: false, message: '当前没有待执行恢复任务' };
  try { fs.unlinkSync(PENDING_FILE); } catch (_) {}
  const result = { ...plan, state: 'cancelled', completedAt: new Date().toISOString() };
  fs.mkdirSync(HISTORY_ROOT, { recursive: true });
  atomicWrite(path.join(HISTORY_ROOT, `${safeBackupName(String(plan.id || `cancel-${Date.now()}`))}.json`), result);
  logger.warn('backup', 'restore-cancelled', { planId: plan.id, backupName: plan.backupName });
  return { ok: true, cancelled: true, plan: result };
}

function copyVerifiedToStage(verification, stageRoot) {
  const backupDir = path.join(PATHS.backups, verification.name);
  for (const rootName of verification.roots) fs.mkdirSync(path.join(stageRoot, rootName), { recursive: true });
  for (const entry of verification.manifest.files || []) {
    const resolved = resolveManifestEntry(backupDir, entry);
    const target = path.join(stageRoot, resolved.rootName, resolved.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(resolved.source, target);
    if (fs.statSync(target).size !== Number(entry.size) || checksum(target) !== entry.sha256) throw Object.assign(new Error(`恢复暂存校验失败：${entry.path}`), { code: 'RESTORE_STAGE_VERIFY_FAILED' });
  }
}

function removePath(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function restoreJournalFile(work) {
  return path.join(work, 'restore-journal.json');
}

function readRestoreJournal(work) {
  const file = restoreJournalFile(work);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    throw Object.assign(new Error(`恢复日志无法读取：${error.message}`), {
      code: 'RESTORE_JOURNAL_INVALID', journalFile: file
    });
  }
}

function writeRestoreJournal(work, journal) {
  journal.updatedAt = new Date().toISOString();
  atomicWrite(restoreJournalFile(work), journal);
  return journal;
}

function notifyRestoreTransition(options, journal, rootName, phase) {
  if (typeof options.onTransition === 'function') {
    options.onTransition(Object.freeze({
      planId: journal.planId,
      journalState: journal.state,
      rootName: rootName || '',
      phase: phase || '',
      journal: JSON.parse(JSON.stringify(journal))
    }));
  }
}

function createRestoreJournal(plan, verification, work, protection) {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    planId: plan.id,
    backupName: verification.name,
    manifestSha256: plan.manifestSha256 || '',
    state: 'prepared',
    createdAt,
    updatedAt: createdAt,
    protectionBackup: protection?.name || '',
    roots: verification.roots.map(rootName => ({
      rootName,
      targetRoot: ALL_ROOTS[rootName],
      stagedRoot: path.join(work, 'stage', rootName),
      rollbackRoot: path.join(work, 'rollback', rootName),
      phase: 'pending',
      originalExisted: fs.existsSync(ALL_ROOTS[rootName])
    }))
  };
}

function restoreProtectionOptions(verification) {
  return {
    roots: verification.roots,
    profile: verification.roots.includes('media') ? 'full-media' : 'custom',
    lockRetention: true,
    skipRetention: true
  };
}

function assertRestoreJournalMatches(journal, plan, verification) {
  if (String(journal.planId || '') !== String(plan.id || '') ||
      String(journal.backupName || '') !== String(verification.name || '') ||
      (journal.manifestSha256 && String(journal.manifestSha256) !== String(plan.manifestSha256 || ''))) {
    throw Object.assign(new Error('恢复日志与待恢复任务身份不一致'), {
      code: 'RESTORE_JOURNAL_IDENTITY_MISMATCH',
      journalPlanId: journal.planId || '',
      pendingPlanId: plan.id || ''
    });
  }
}

function reconcileRestoreRoot(work, journal, item, options) {
  const targetExists = () => fs.existsSync(item.targetRoot);
  const stagedExists = () => fs.existsSync(item.stagedRoot);
  const rollbackExists = () => fs.existsSync(item.rollbackRoot);

  if (item.phase === 'pending') {
    // A crash can happen after rename but before the journal write. Infer that
    // state from the durable rollback path rather than deleting the work tree.
    if (rollbackExists() && !targetExists()) {
      item.originalExisted = true;
      item.phase = 'original_moved';
      writeRestoreJournal(work, journal);
    } else {
      if (targetExists()) {
        if (rollbackExists()) {
          throw Object.assign(new Error(`恢复回滚目录已存在：${item.rootName}`), {
            code: 'RESTORE_ROLLBACK_PATH_CONFLICT', rootName: item.rootName
          });
        }
        fs.renameSync(item.targetRoot, item.rollbackRoot);
        fsyncDirectory(path.dirname(item.targetRoot));
        item.originalExisted = true;
      } else {
        item.originalExisted = false;
      }
      item.phase = 'original_moved';
      writeRestoreJournal(work, journal);
      notifyRestoreTransition(options, journal, item.rootName, 'original_moved');
    }
  }

  if (item.phase === 'original_moved') {
    // If the stage rename completed but the journal write did not, target is
    // present and staged is absent. Record the inferred state and continue.
    if (targetExists() && !stagedExists()) {
      item.phase = 'staged_moved';
      writeRestoreJournal(work, journal);
    } else {
      if (!stagedExists()) {
        // Forward recovery is impossible. Restore the previous root if it was
        // moved so the application returns to a complete old state.
        if (item.originalExisted && rollbackExists() && !targetExists()) {
          fs.renameSync(item.rollbackRoot, item.targetRoot);
          fsyncDirectory(path.dirname(item.targetRoot));
        }
        throw Object.assign(new Error(`恢复暂存根目录缺失：${item.rootName}`), {
          code: 'RESTORE_STAGE_ROOT_MISSING', rootName: item.rootName
        });
      }
      if (targetExists()) {
        throw Object.assign(new Error(`恢复目标在 stage 切换前意外存在：${item.rootName}`), {
          code: 'RESTORE_TARGET_UNEXPECTEDLY_PRESENT', rootName: item.rootName
        });
      }
      fs.renameSync(item.stagedRoot, item.targetRoot);
      fsyncDirectory(path.dirname(item.targetRoot));
      item.phase = 'staged_moved';
      writeRestoreJournal(work, journal);
      notifyRestoreTransition(options, journal, item.rootName, 'staged_moved');
    }
  }

  if (item.phase === 'staged_moved') {
    if (!targetExists()) {
      throw Object.assign(new Error(`已切换恢复根目录缺失：${item.rootName}`), {
        code: 'RESTORE_COMMITTED_ROOT_MISSING', rootName: item.rootName
      });
    }
    item.phase = 'committed';
    writeRestoreJournal(work, journal);
    notifyRestoreTransition(options, journal, item.rootName, 'committed');
  }
}

function rollbackRestoreJournal(work, journal) {
  const failures = [];
  for (const item of [...journal.roots].reverse()) {
    try {
      if (['staged_moved', 'committed'].includes(item.phase) && fs.existsSync(item.targetRoot)) {
        removePath(item.targetRoot);
      }
      if (item.originalExisted && fs.existsSync(item.rollbackRoot)) {
        fs.renameSync(item.rollbackRoot, item.targetRoot);
        fsyncDirectory(path.dirname(item.targetRoot));
      }
      item.phase = 'rolled_back';
      writeRestoreJournal(work, journal);
    } catch (error) {
      failures.push({ rootName: item.rootName, error: error.message });
    }
  }
  return failures;
}

function executePendingRestore(options = {}) {
  if (options.requireClosedDatabase === true) {
    const broker = require('../lib/sqliteConnectionBroker').getSqliteConnectionBroker({ optional: true });
    if (broker?.isOpen?.()) {
      throw Object.assign(new Error('Restore requires every SQLite handle to be closed'), {
        code: 'RESTORE_REQUIRES_CLOSED_DATABASE', phase: String(options.phase || '')
      });
    }
  }
  const plan = pendingRestore();
  if (!plan || plan.state === 'invalid') return { ok: true, executed: false, reason: plan?.error || 'no-pending-restore' };
  const verification = verifyBackup(plan.backupName, { force: true });
  if (!verification.ok) throw Object.assign(new Error(`恢复前校验失败：${verification.message}`), { code: verification.code || 'RESTORE_VERIFY_FAILED' });
  const manifestFile = path.join(PATHS.backups, verification.name, 'manifest.json');
  if (plan.manifestSha256 && checksum(manifestFile) !== plan.manifestSha256) throw Object.assign(new Error('备份清单在恢复任务创建后发生变化'), { code: 'RESTORE_MANIFEST_CHANGED' });

  const work = path.join(WORK_ROOT, safeBackupName(plan.id));
  const stage = path.join(work, 'stage');
  const rollback = path.join(work, 'rollback');
  let journal = readRestoreJournal(work);
  let protection = null;
  const result = { ...plan, state: 'running', startedAt: new Date().toISOString(), protectionBackup: '', rollbackPerformed: false };

  try {
    if (!journal) {
      // Work without a journal is not authoritative and can only exist before
      // the first root switch. Clean it once, then never delete journaled work
      // during restart recovery.
      removePath(work);
      fs.mkdirSync(stage, { recursive: true });
      fs.mkdirSync(rollback, { recursive: true });
      protection = createBackup(`pre_restore_${String(plan.id).slice(-12)}`, restoreProtectionOptions(verification));
      result.protectionBackup = protection.name;
      copyVerifiedToStage(verification, stage);
      journal = createRestoreJournal(plan, verification, work, protection);
      writeRestoreJournal(work, journal);
      notifyRestoreTransition(options, journal, '', 'prepared');
    } else {
      assertRestoreJournalMatches(journal, plan, verification);
      result.protectionBackup = journal.protectionBackup || '';
    }

    if (journal.state === 'committed') {
      // The data switch completed and only final bookkeeping was interrupted.
      result.state = 'completed';
    } else {
      journal.state = 'switching';
      writeRestoreJournal(work, journal);
      for (const item of journal.roots) reconcileRestoreRoot(work, journal, item, options);
      journal.state = 'committed';
      journal.committedAt = new Date().toISOString();
      writeRestoreJournal(work, journal);
      notifyRestoreTransition(options, journal, '', 'journal_committed');
      result.state = 'completed';
    }

    result.completedAt = new Date().toISOString();
    result.message = '恢复已完成，旧状态已保存为同范围保护备份';
    result.protectionBackup = journal.protectionBackup || result.protectionBackup;
    fs.mkdirSync(HISTORY_ROOT, { recursive: true });
    atomicWrite(path.join(HISTORY_ROOT, `${safeBackupName(plan.id)}.json`), result);
    try { fs.unlinkSync(PENDING_FILE); fsyncDirectory(path.dirname(PENDING_FILE)); } catch (_) {}
    notifyRestoreTransition(options, journal, '', 'bookkeeping_committed');
    removePath(work);
    logger.warn('backup', 'restore-completed', { planId: plan.id, backupName: plan.backupName, protectionBackup: result.protectionBackup, roots: verification.roots });
    return { ok: true, executed: true, result };
  } catch (error) {
    result.state = 'failed';
    result.failedAt = new Date().toISOString();
    result.error = error.message;
    if (journal && journal.state !== 'committed') {
      const rollbackFailures = rollbackRestoreJournal(work, journal);
      result.rollbackPerformed = rollbackFailures.length === 0;
      if (rollbackFailures.length) result.rollbackError = rollbackFailures.map(row => `${row.rootName}: ${row.error}`).join('; ');
      journal.state = rollbackFailures.length ? 'manual_review' : 'rolled_back';
      journal.failure = { code: error.code || 'RESTORE_EXECUTION_FAILED', message: error.message, rollbackFailures };
      writeRestoreJournal(work, journal);
    }
    result.state = result.rollbackError ? 'failed-needs-manual-recovery' : 'failed-rolled-back';
    atomicWrite(PENDING_FILE, { ...result, state: 'failed-awaiting-review' });
    fs.mkdirSync(HISTORY_ROOT, { recursive: true });
    atomicWrite(path.join(HISTORY_ROOT, `${safeBackupName(plan.id)}.json`), result);
    logger.error('backup', 'restore-failed', { planId: plan.id, error: error.message, rollbackPerformed: result.rollbackPerformed, rollbackError: result.rollbackError || '' });
    throw Object.assign(error, { code: error.code || 'RESTORE_EXECUTION_FAILED', restoreResult: result });
  }
}

function restoreHistory(limit = 20) {
  if (!fs.existsSync(HISTORY_ROOT)) return [];
  return fs.readdirSync(HISTORY_ROOT).filter(name => name.endsWith('.json')).map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(HISTORY_ROOT, name), 'utf8')); } catch (_) { return null; }
  }).filter(Boolean).sort((a, b) => String(b.completedAt || b.failedAt || b.requestedAt).localeCompare(String(a.completedAt || a.failedAt || a.requestedAt))).slice(0, Math.max(1, Number(limit || 20)));
}

function retentionState(options = {}) {
  return backupRetention.planRetention(listBackups(), {
    policy: options.policy,
    nowMs: options.nowMs,
    pendingRestore: pendingRestore(),
    restoreHistory: restoreHistory(100)
  });
}

function enforceRetention(options = {}) {
  return backupRetention.applyRetention(listBackups(), {
    policy: options.policy,
    nowMs: options.nowMs,
    dryRun: options.dryRun === true,
    backupRoot: PATHS.backups,
    pendingRestore: pendingRestore(),
    restoreHistory: restoreHistory(100)
  });
}

function restoreBackup(name) { return stageRestore(name); }

module.exports = {
  ROOTS,
  ROOT_LABELS,
  OPTIONAL_ROOTS,
  ALL_ROOTS,
  BACKUP_PROFILES,
  createBackup,
  listBackups,
  readManifest,
  verifyBackup,
  stageRestore,
  cancelPendingRestore,
  executePendingRestore,
  pendingRestore,
  restoreHistory,
  retentionState,
  enforceRetention,
  restoreBackup,
  checksum,
  createConsistentSqliteSnapshot,
  listFiles,
  directoryStats,
  clearVerificationCache,
  resolveManifestEntry,
  safeBackupName
};
