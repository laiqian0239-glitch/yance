'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const accountStore = require('./accountStore');
const backupService = require('./backupService');
const logger = require('./logger');

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
      '平台密钥不会从普通 JSON 直接导入；仅迁移账号元数据，认证必须通过当前成熟平台登录重新建立。'
    ],
    confirmToken,
    createdAt: new Date().toISOString()
  };
  plans.set(confirmToken, plan);
  return plan;
}

async function importCandidate(candidate) {
  const existing = accountStore.list().find(account => account.metadata?.migrationSource === candidate.sourcePath);
  if (existing) return { skipped: true, candidateId: candidate.id, reason: 'already-imported', accountId: existing.id };

  const adapterAccountId = `migrated-${candidate.platform}-${candidate.id}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const account = await accountStore.create({
    platform: candidate.platform,
    adapterAccountId,
    displayName: candidate.displayName,
    identityLabel: '需要重新输入安全凭据',
    autoReconnect: false,
    metadata: {
      migrationSource: candidate.sourcePath,
      migrationKind: candidate.kind,
      migratedAt: new Date().toISOString(),
      validationState: 'secure-reentry-required'
    },
    source: 'legacy-account-migration'
  });
  return {
    skipped: false,
    accountId: account.id,
    candidateId: candidate.id,
    validationState: account.metadata?.validationState,
    requiresSecureReentry: true
  };
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
    sourceUntouched: true
  };
}

module.exports = { scan, execute, importCandidate };
