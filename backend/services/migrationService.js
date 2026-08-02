'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const backupService = require('./backupService');
const logger = require('./logger');
const { PATHS } = require('../config');
const { walk, migrateLegacyJson } = require('./legacyJsonMigrator');
const { walkLegacyDatabases, migrateLegacySqlite } = require('./legacySqliteMigrator');
const { discoverLegacyDataRoots } = require('./legacyRootDiscovery');
const { getMigrationAuthority } = require('./migrationAuthority');

const plans = new Map();

function sourceAssets(sourceRoot) {
  const jsonFiles = walk(sourceRoot);
  const sqliteFiles = walkLegacyDatabases(sourceRoot, { skipFiles: [PATHS.sqlite] });
  return { jsonFiles, sqliteFiles };
}
function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function sourceSnapshot(sourceRoot, files) {
  return files.map(file => {
    const stat = fs.statSync(file);
    return {
      path: path.relative(sourceRoot, file),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      sha256: fileSha256(file)
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}
function assetFingerprint(files) {
  const rows = files.map(file => {
    const stat = fs.statSync(file);
    return { path: path.resolve(file), size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), sha256: fileSha256(file) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function summarizeFiles(sourceRoot, files, type) {
  return files.map(file => ({ path: path.relative(sourceRoot, file), size: fs.statSync(file).size, type }));
}

function aggregateImportedCounts(report = {}) {
  const totals = {};
  for (const section of [report.sqlite?.imported, report.json?.imported]) {
    for (const [key, value] of Object.entries(section || {})) totals[key] = (totals[key] || 0) + (Number(value) || 0);
  }
  totals.total = Object.values(totals).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return totals;
}

function verifyImportReport(report = {}) {
  const imported = aggregateImportedCounts(report);
  const discoveredFiles = Number(report.sqlite?.files?.length || 0) + Number(report.json?.files?.length || 0);
  const completed = report.ok === true && (!report.executed || imported.total > 0 || discoveredFiles > 0);
  return {
    ok: completed,
    executed: report.executed === true,
    discoveredFiles,
    imported,
    sourceUntouched: report.sourceUntouched !== true || report.sourceVerification?.ok === true,
    sourceVerification: report.sourceVerification || null,
    checkedAt: new Date().toISOString()
  };
}

function createPlan(sourceDir = PATHS.root) {
  const sourceRoot = path.resolve(String(sourceDir || PATHS.root));
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw Object.assign(new Error('迁移源目录不存在'), { code: 'MIGRATION_SOURCE_NOT_FOUND', status: 404 });
  }
  const { jsonFiles, sqliteFiles } = sourceAssets(sourceRoot);
  const files = [...jsonFiles, ...sqliteFiles];
  const fingerprint = assetFingerprint(files);
  const confirmToken = crypto.createHash('sha256').update(`${sourceRoot}|${fingerprint}|${Date.now()}`).digest('hex');
  const plan = {
    sourceDir: sourceRoot,
    mode: 'dry-run',
    destructive: false,
    fileCount: files.length,
    jsonFileCount: jsonFiles.length,
    sqliteFileCount: sqliteFiles.length,
    totalBytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    files: [...summarizeFiles(sourceRoot, jsonFiles, 'json'), ...summarizeFiles(sourceRoot, sqliteFiles, 'sqlite')],
    confirmToken,
    warnings: files.length ? ['旧SQLite数据库始终只读；当前工作区旧JSON仅在成功导入后移动到 legacy-json 归档目录。'] : ['没有发现可迁移的旧数据。'],
    steps: ['创建升级前恢复点', '只读识别旧SQLite结构', '单事务导入聊天、客户档案、关系事件与AI资产', '导入旧JSON中的聊天、AI记忆、知识库与媒体索引', '核对实际写入数量并记录迁移指纹', '失败自动回滚当前导入事务'],
    createdAt: new Date().toISOString()
  };
  plans.set(confirmToken, plan);
  return plan;
}

function importSourceRoot(sourceRoot, options = {}) {
  const root = path.resolve(sourceRoot);
  const { jsonFiles, sqliteFiles } = sourceAssets(root);
  const initialFiles = [...jsonFiles, ...sqliteFiles];
  const sourceBefore = options.sourceUntouched === true ? sourceSnapshot(root, initialFiles) : null;
  const result = {
    root,
    ok: true,
    executed: false,
    mode: 'nothing-to-import',
    sourceUntouched: options.sourceUntouched === true,
    json: { ok: true, mode: 'nothing-to-import' },
    sqlite: { ok: true, mode: 'nothing-to-import' },
    warnings: [],
    sourceVerification: options.sourceUntouched === true ? { ok: false, before: sourceBefore, after: null, sourceMutationCount: null } : null
  };
  const migrationAuthority = (sqliteFiles.length || jsonFiles.length)
    ? (options.migrationAuthority || getMigrationAuthority())
    : null;
  if (sqliteFiles.length) {
    result.sqlite = migrateLegacySqlite({ sourceRoot: root, dbPath: PATHS.sqlite, files: sqliteFiles, stopOnError: options.stopOnError === true, migrationAuthority });
    result.ok = result.ok && result.sqlite.ok;
    result.executed = result.executed || !['nothing-to-import', 'already-imported'].includes(result.sqlite.mode);
    result.warnings.push(...(result.sqlite.warnings || []));
  }
  if (jsonFiles.length) {
    result.json = migrateLegacyJson({ sourceRoot: root, dbPath: PATHS.sqlite, files: jsonFiles, archive: options.archiveJson === true, migrationAuthority });
    result.ok = result.ok && result.json.ok;
    result.executed = result.executed || !['nothing-to-import', 'already-imported'].includes(result.json.mode);
    result.warnings.push(...(result.json.warnings || []));
  }
  try {
    result.relational = require('./workspaceDataService').migrateLegacyDocuments();
    result.executed = result.executed || result.relational.migrated === true;
  } catch (error) {
    result.ok = false;
    result.warnings.push(`Stage 6.0 关系数据迁移失败：${error.message}`);
  }

  if (options.sourceUntouched === true) {
    const assetsAfter = sourceAssets(root);
    const afterFiles = [...assetsAfter.jsonFiles, ...assetsAfter.sqliteFiles];
    const sourceAfter = sourceSnapshot(root, afterFiles);
    const beforeEncoded = JSON.stringify(sourceBefore);
    const afterEncoded = JSON.stringify(sourceAfter);
    result.sourceVerification = {
      ok: beforeEncoded === afterEncoded,
      before: sourceBefore,
      after: sourceAfter,
      sourceMutationCount: beforeEncoded === afterEncoded ? 0 : 1,
      checkedAt: new Date().toISOString()
    };
    if (!result.sourceVerification.ok) {
      result.ok = false;
      result.code = 'LEGACY_SOURCE_MUTATED_DURING_IMPORT';
      result.warnings.push('Earlier Yance source changed during read-only migration verification.');
    }
  }

  result.mode = result.ok ? (result.executed ? 'completed' : 'already-imported') : 'completed-with-warnings';
  result.verification = verifyImportReport(result);
  if (result.executed && !result.verification.ok) {
    result.ok = false;
    result.mode = 'verification-failed';
    result.warnings.push('迁移任务执行后未能通过写入数量核对。');
  }
  return result;
}

function executeJsonImport(sourceDir, confirmToken) {
  const plan = plans.get(String(confirmToken || ''));
  const sourceRoot = path.resolve(String(sourceDir || plan?.sourceDir || PATHS.root));
  if (!plan || plan.sourceDir !== sourceRoot) {
    throw Object.assign(new Error('迁移确认令牌无效或已过期'), { code: 'MIGRATION_CONFIRMATION_REQUIRED', status: 409 });
  }
  const restorePoint = plan.fileCount ? backupService.createBackup('pre-legacy-data-migration') : null;
  const insideCurrentRoot = sourceRoot === path.resolve(PATHS.root) || sourceRoot.startsWith(`${path.resolve(PATHS.root)}${path.sep}`);
  const report = importSourceRoot(sourceRoot, { sourceUntouched: !insideCurrentRoot, archiveJson: insideCurrentRoot, stopOnError: true });
  plans.delete(confirmToken);
  logger.warn('migration', 'legacy-import-completed', { sourceRoot, restorePoint: restorePoint?.dir || '', report });
  return { ok: report.ok, imported: report.executed, importedRecords: report.verification?.imported || aggregateImportedCounts(report), verification: report.verification || verifyImportReport(report), mode: report.mode, restorePoint: restorePoint?.dir || '', sourceUntouched: !insideCurrentRoot, report };
}

function migrateExternalRoot(root) {
  try {
    return importSourceRoot(root, { sourceUntouched: true, archiveJson: false, stopOnError: true });
  } catch (error) {
    logger.error('migration', 'external-legacy-root-import-failed', { root, error: error.stack || error.message });
    return { root, ok: false, executed: false, sourceUntouched: true, error: error.message, code: error.code || 'EXTERNAL_LEGACY_IMPORT_FAILED' };
  }
}

function migrateAtStartup() {
  const discovery = discoverLegacyDataRoots();
  const currentAssets = sourceAssets(PATHS.root);
  const externalRoots = discovery.legacyRoots;
  const externalAssetCount = externalRoots.reduce((total, root) => {
    const assets = sourceAssets(root);
    return total + assets.jsonFiles.length + assets.sqliteFiles.length;
  }, 0);
  const currentAssetCount = currentAssets.jsonFiles.length + currentAssets.sqliteFiles.length;
  if (!currentAssetCount && externalAssetCount === 0) {
    return { ok: true, executed: false, mode: 'nothing-to-import', legacyRoots: externalRoots, discovery };
  }

  const restorePoint = backupService.createBackup('automatic-pre-r32-upgrade');
  const externalReports = externalRoots.map(migrateExternalRoot);
  const externalFailures = externalReports.filter(row => !row.ok);
  if (externalFailures.length) {
    const failure = externalFailures[0];
    return {
      ok: false,
      executed: externalReports.some(row => row.executed),
      restorePoint: restorePoint.dir,
      legacyRoots: externalRoots,
      discovery,
      externalReports,
      error: failure.error || 'Earlier Yance data migration failed',
      code: failure.code || 'YANCE27_LEGACY_MIGRATION_FAILED'
    };
  }
  let currentReport = { root: PATHS.root, ok: true, executed: false, mode: 'nothing-to-import', sourceUntouched: false };

  if (currentAssetCount) {
    try {
      currentReport = importSourceRoot(PATHS.root, { sourceUntouched: false, archiveJson: true, stopOnError: true });
    } catch (error) {
      logger.error('migration', 'startup-current-root-import-failed', { restorePoint: restorePoint.dir, error: error.stack || error.message });
      return {
        ok: false,
        executed: false,
        restorePoint: restorePoint.dir,
        legacyRoots: externalRoots,
        discovery,
        externalReports,
        error: error.message,
        code: error.code || 'STARTUP_MIGRATION_FAILED'
      };
    }
  }

  const executed = currentReport.executed || externalReports.some(row => row.executed);
  const report = {
    currentRoot: currentReport,
    externalRoots: externalReports,
    externalFailureCount: externalFailures.length,
    completedAt: new Date().toISOString()
  };
  logger.info('migration', 'startup-legacy-to-r32-completed', {
    restorePoint: restorePoint.dir,
    currentMode: currentReport.mode,
    externalRoots: externalReports.map(row => ({ root: row.root, ok: row.ok, mode: row.mode || '', executed: row.executed }))
  });
  return {
    ok: true,
    executed,
    mode: 'completed',
    restorePoint: restorePoint.dir,
    legacyRoots: externalRoots,
    discovery,
    report,
    warnings: []
  };
}

module.exports = { createPlan, executeJsonImport, migrateAtStartup, migrateExternalRoot, importSourceRoot, sourceAssets, sourceSnapshot, aggregateImportedCounts, verifyImportReport };
