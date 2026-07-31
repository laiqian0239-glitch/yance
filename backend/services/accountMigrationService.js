'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config');
const accountStore = require('./accountStore');
const backupService = require('./backupService');
const logger = require('./logger');
const { readValidCredentials } = require('./credentialRecoveryService');

const plans = new Map();
const MAX_FILES = 5000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

function safeId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function walk(root) {
  const rows = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && rows.length < MAX_FILES) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      rows.push({ full, entry, depth });
      if (entry.isDirectory() && depth < 5 && !['node_modules', 'dist', 'build', '.git', 'cache', 'logs', 'media', 'backups', 'legacy-json'].includes(entry.name.toLowerCase())) {
        stack.push({ dir: full, depth: depth + 1 });
      }
      if (rows.length >= MAX_FILES) break;
    }
  }
  return rows;
}

function jsonSignals(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_JSON_BYTES) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const lower = raw.toLowerCase();
    if (!raw.trim().startsWith('{') && !raw.trim().startsWith('[')) return null;
    JSON.parse(raw);
    if ((lower.includes('apiid') || lower.includes('api_id')) && (lower.includes('apihash') || lower.includes('api_hash'))) return 'telegram';
    if (lower.includes('pageaccesstoken') || lower.includes('page_access_token') || (lower.includes('pageid') && lower.includes('webhook'))) return 'facebook';
    return null;
  } catch (_) { return null; }
}

function scan(sourceDir) {
  if (!sourceDir) throw Object.assign(new Error('请选择旧版本数据目录'), { code: 'SOURCE_DIR_REQUIRED', status: 400 });
  const root = path.resolve(sourceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Object.assign(new Error('旧版本目录不存在'), { code: 'SOURCE_DIR_NOT_FOUND', status: 404 });
  const rows = walk(root);
  const candidates = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.entry.isDirectory()) {
      const credentials = readValidCredentials(row.full);
      if (credentials) {
        const key = `whatsapp:${row.full}`;
        if (!seen.has(key)) {
          seen.add(key);
          const identity = String(credentials.me?.name || credentials.me?.id || credentials.me?.lid || path.basename(row.full));
          candidates.push({
            id: safeId(key),
            platform: 'whatsapp',
            kind: 'auth-directory',
            sourcePath: row.full,
            displayName: identity,
            identityHint: identity,
            canMigrateCredential: true,
            requiresSecureReentry: false,
            validationState: 'filesystem-validated'
          });
        }
      }
    }
    if (row.entry.isFile() && row.entry.name.toLowerCase().endsWith('.json')) {
      const platform = jsonSignals(row.full);
      if (!platform) continue;
      const key = `${platform}:${row.full}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: safeId(key),
        platform,
        kind: 'metadata-file',
        sourcePath: row.full,
        displayName: `迁移的 ${platform === 'telegram' ? 'Telegram' : 'Facebook'} 账号`,
        identityHint: path.basename(row.full),
        canMigrateCredential: false,
        requiresSecureReentry: true,
        validationState: 'secure-reentry-required'
      });
    }
  }
  const stat = fs.statSync(root);
  const confirmToken = crypto.createHash('sha256').update(`${root}|${stat.mtimeMs}|${candidates.map(row => row.id).join(',')}`).digest('hex');
  const plan = {
    mode: 'dry-run',
    destructive: false,
    sourceDir: root,
    scannedFiles: rows.length,
    candidates,
    warnings: [
      '迁移不会删除或修改旧版本目录。',
      'WhatsApp凭据先复制到临时目录并校验，再原子提交到新的隔离目录。',
      'WhatsApp账号只有在首次真实连接成功后才标记为已验证；首次验证判定登出会撤销新账号和新副本。',
      'Telegram与Facebook密钥不会从普通JSON直接导入；仅迁移账号元数据，敏感凭据必须重新写入Windows安全存储。'
    ],
    confirmToken,
    createdAt: new Date().toISOString()
  };
  plans.set(confirmToken, plan);
  return plan;
}

function commitWhatsAppCredentials(source, destination, candidateId) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (sourceRoot === destinationRoot) return { copied: false, destination: destinationRoot, validationState: 'filesystem-validated' };
  if (fs.existsSync(destinationRoot)) throw Object.assign(new Error('目标WhatsApp凭据目录已存在'), { code: 'MIGRATION_TARGET_EXISTS', status: 409 });
  const stage = path.join(PATHS.tmp, `wa-migration-${candidateId}-${crypto.randomUUID()}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  try {
    fs.cpSync(sourceRoot, stage, { recursive: true, errorOnExist: true, force: false });
    if (!readValidCredentials(stage)) {
      throw Object.assign(new Error('复制后的WhatsApp凭据不完整或未注册'), { code: 'COPIED_CREDENTIAL_VALIDATION_FAILED' });
    }
    fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
    try {
      fs.renameSync(stage, destinationRoot);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      fs.cpSync(stage, destinationRoot, { recursive: true, errorOnExist: true, force: false });
      fs.rmSync(stage, { recursive: true, force: true });
    }
    return { copied: true, destination: destinationRoot, validationState: 'filesystem-validated' };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    if (fs.existsSync(destinationRoot) && !readValidCredentials(destinationRoot)) fs.rmSync(destinationRoot, { recursive: true, force: true });
    throw error;
  }
}

async function importCandidate(candidate) {
  const existing = accountStore.list().find(account => account.metadata?.migrationSource === candidate.sourcePath);
  if (existing) return { skipped: true, candidateId: candidate.id, reason: 'already-imported', accountId: existing.id };

  const adapterAccountId = `migrated-${candidate.platform}-${candidate.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  let committedCredentials = null;
  try {
    if (candidate.platform === 'whatsapp' && candidate.canMigrateCredential) {
      committedCredentials = commitWhatsAppCredentials(candidate.sourcePath, path.join(PATHS.whatsappAuth, adapterAccountId), candidate.id);
    }
    const account = await accountStore.create({
      platform: candidate.platform,
      adapterAccountId,
      displayName: candidate.displayName,
      identityLabel: candidate.requiresSecureReentry ? '需要重新输入安全凭据' : '旧会话凭据已恢复，等待真实连接验证',
      autoReconnect: candidate.platform === 'whatsapp',
      metadata: {
        migrationSource: candidate.sourcePath,
        migrationKind: candidate.kind,
        migratedAt: new Date().toISOString(),
        credentialDirectory: committedCredentials?.destination || '',
        recoveredFrom: candidate.sourcePath,
        validationState: candidate.platform === 'whatsapp' ? 'pending-live-connect' : 'secure-reentry-required',
        filesystemValidated: Boolean(committedCredentials)
      },
      source: 'legacy-account-migration'
    });
    return {
      skipped: false,
      accountId: account.id,
      candidateId: candidate.id,
      credentialCopied: Boolean(committedCredentials?.copied),
      validationState: account.metadata?.validationState,
      requiresSecureReentry: candidate.requiresSecureReentry
    };
  } catch (error) {
    if (committedCredentials?.copied) fs.rmSync(committedCredentials.destination, { recursive: true, force: true });
    throw error;
  }
}

async function execute(confirmToken, selectedIds = []) {
  const plan = plans.get(String(confirmToken || ''));
  if (!plan) throw Object.assign(new Error('迁移计划已失效，请重新扫描'), { code: 'MIGRATION_PLAN_EXPIRED', status: 409 });
  const selected = new Set((selectedIds.length ? selectedIds : plan.candidates.map(row => row.id)).map(String));
  const restorePoint = backupService.createBackup('before-account-migration');
  const imported = [];
  const skipped = [];
  const failed = [];
  for (const candidate of plan.candidates.filter(row => selected.has(row.id))) {
    try {
      const result = await importCandidate(candidate);
      if (result.skipped) skipped.push(result);
      else imported.push(result);
    } catch (error) {
      failed.push({ id: candidate.id, platform: candidate.platform, reason: error.message, code: error.code || 'ACCOUNT_MIGRATION_FAILED', rolledBack: true });
      logger.error('accounts', 'migration-candidate-failed', { candidateId: candidate.id, platform: candidate.platform, error: error.message, code: error.code || '' });
    }
  }
  await accountStore.record('legacy-accounts-migrated', {
    sourceDir: plan.sourceDir,
    imported: imported.length,
    skipped: skipped.length,
    failed: failed.length,
    restorePoint: restorePoint.dir
  });
  plans.delete(confirmToken);
  return {
    ok: failed.length === 0,
    imported,
    skipped,
    failed,
    backupCreated: true,
    restorePoint: restorePoint.dir,
    sourceUntouched: true,
    liveValidationPending: imported.filter(row => row.validationState === 'pending-live-connect').length
  };
}

module.exports = { scan, execute, commitWhatsAppCredentials, importCandidate };
