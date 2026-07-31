'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { discoverExistingDataRoots, inspectDataRoot } = require('../runtime-delivery/source-uat-delivery');
const { compareReports, markdown: comparisonMarkdown } = require('./compareWhatsappIdentityDiagnostics');

const DEFAULT_WORKER = 'https://yance-facebook-gateway.wangyi198675.workers.dev';
const DEFAULT_PORT = 27632;

function clean(value) { return String(value == null ? '' : value).trim(); }
function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function workflowError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}
function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    workerBaseUrl: DEFAULT_WORKER,
    port: DEFAULT_PORT,
    prepareOnly: false,
    skipInstall: false,
    allowLegacyHealthz: true,
    planOnly: false,
    allowNonWindows: false,
    noExplorer: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--data-root') options.dataRoot = argv[++index];
    else if (item.startsWith('--data-root=')) options.dataRoot = item.slice('--data-root='.length);
    else if (item === '--worker') options.workerBaseUrl = argv[++index];
    else if (item.startsWith('--worker=')) options.workerBaseUrl = item.slice('--worker='.length);
    else if (item === '--port') options.port = Number(argv[++index]);
    else if (item.startsWith('--port=')) options.port = Number(item.slice('--port='.length));
    else if (item === '--evidence-root') options.evidenceRoot = argv[++index];
    else if (item.startsWith('--evidence-root=')) options.evidenceRoot = item.slice('--evidence-root='.length);
    else if (item === '--prepare-only') options.prepareOnly = true;
    else if (item === '--skip-install') options.skipInstall = true;
    else if (item === '--allow-legacy-healthz') options.allowLegacyHealthz = true;
    else if (item === '--plan-only') options.planOnly = true;
    else if (item === '--allow-non-windows') options.allowNonWindows = true;
    else if (item === '--no-explorer') options.noExplorer = true;
    else throw workflowError('WHATSAPP_REAL_UAT_ARGUMENT_INVALID', `不支持的参数：${item}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw workflowError('WHATSAPP_REAL_UAT_PORT_INVALID', `端口无效：${options.port}`);
  }
  return options;
}

function resolveDataRoot(explicitRoot, env = process.env) {
  if (clean(explicitRoot)) {
    const result = inspectDataRoot(path.resolve(explicitRoot));
    if (!result.databaseExists) throw workflowError('WHATSAPP_REAL_UAT_DATABASE_MISSING', '指定数据目录没有有效 SQLite 数据库', result);
    return { selected: result, candidates: [result], mode: 'explicit' };
  }
  const candidates = discoverExistingDataRoots(env);
  const selected = candidates.find(row => row.databaseExists);
  if (!selected) {
    throw workflowError('WHATSAPP_REAL_UAT_EXISTING_DATA_NOT_FOUND', '没有找到包含 store\\yance-r32.db 的现有言策真实数据目录', { candidates });
  }
  return { selected, candidates, mode: 'largest-existing' };
}

function desktopPath() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true });
    const resolved = result.status === 0 ? clean(result.stdout) : '';
    if (resolved) return resolved;
    if (clean(process.env.USERPROFILE)) return path.join(process.env.USERPROFILE, 'Desktop');
  }
  return path.join(os.homedir(), 'Desktop');
}

function buildPaths(repoRoot, options, selectedRoot, now = new Date()) {
  const evidenceRoot = path.resolve(options.evidenceRoot || path.join(desktopPath(), `Yance-WhatsApp-Real-UAT-${stamp(now)}`));
  const reports = path.join(evidenceRoot, '01_REPORTS');
  const backup = path.join(evidenceRoot, '02_BACKUP', path.basename(selectedRoot) || 'Yance-Data');
  const logs = path.join(evidenceRoot, '03_LOGS');
  return {
    repoRoot,
    evidenceRoot,
    reports,
    backup,
    logs,
    p0: path.join(reports, '00-P0-Preflight.json'),
    migrationJson: path.join(reports, '03A-WhatsApp-Account-Reconciliation.json'),
    p0AfterMigration: path.join(reports, '03B-P0-Post-Migration.json'),
    migrationDiagnosticJson: path.join(reports, '03C-WhatsApp-Post-Migration.json'),
    migrationDiagnosticMarkdown: path.join(reports, '03C-WhatsApp-Post-Migration.md'),
    beforeJson: path.join(reports, '01-WhatsApp-Before.json'),
    beforeMarkdown: path.join(reports, '01-WhatsApp-Before.md'),
    backupVerification: path.join(reports, '02-Backup-Verification.json'),
    beforeHashes: path.join(reports, '03-State-Hashes-Before.json'),
    afterJson: path.join(reports, '04-WhatsApp-After.json'),
    afterMarkdown: path.join(reports, '04-WhatsApp-After.md'),
    afterHashes: path.join(reports, '05-State-Hashes-After.json'),
    comparisonJson: path.join(reports, '06-Reconciliation-Comparison.json'),
    comparisonMarkdown: path.join(reports, '06-Reconciliation-Comparison.md'),
    summaryJson: path.join(reports, '07-Workflow-Summary.json'),
    summaryMarkdown: path.join(reports, '07-Workflow-Summary.md'),
    robocopyLog: path.join(logs, 'backup-robocopy.log'),
    launchLog: path.join(logs, 'source-uat-launch.log')
  };
}

function buildWorkflowPlan(repoRoot, options, dataRootResolution, paths) {
  return {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_REAL_WINDOWS_UAT_SAFE_PLAN',
    generatedAt: new Date().toISOString(),
    repoRoot,
    sourceDataRoot: dataRootResolution.selected.dataRoot,
    dataSelectionMode: dataRootResolution.mode,
    evidenceRoot: paths.evidenceRoot,
    backupRoot: paths.backup,
    workerBaseUrl: options.workerBaseUrl,
    port: options.port,
    prepareOnly: options.prepareOnly,
    stages: [
      'BLOCK_IF_YANCE_PROCESS_RUNNING',
      'P0_CONTRACT_PREFLIGHT',
      'READ_ONLY_WHATSAPP_DIAGNOSTIC_BEFORE',
      'FULL_DATA_ROOT_BACKUP',
      'VERIFY_BACKUP_CORE_HASHES',
      'SOURCE_STATE_HASHES_BEFORE',
      ...(options.prepareOnly ? [] : [
        'APPLY_BACKED_UP_WHATSAPP_ACCOUNT_RECONCILIATION',
        'P0_POST_MIGRATION_PREFLIGHT',
        'READ_ONLY_WHATSAPP_DIAGNOSTIC_POST_MIGRATION',
        'START_SOURCE_UAT_AND_WAIT_FOR_EXIT',
        'BLOCK_IF_BACKEND_OWNER_REMAINS',
        'READ_ONLY_WHATSAPP_DIAGNOSTIC_AFTER',
        'SOURCE_STATE_HASHES_AFTER',
        'COMPARE_BEFORE_AND_AFTER',
        'REAL_UI_ACCEPTANCE_REQUIRED'
      ])
    ],
    destructiveBeforeBackup: false,
    fullPipelineExecuted: false,
    wp7Executed: false,
    strictExecuted: false,
    finalBuilderExecuted: false
  };
}

function commandResult(command, args, options = {}) {
  if (options.logPath) {
    fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
    fs.appendFileSync(options.logPath, `\n> ${command} ${args.join(' ')}\n`, 'utf8');
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    ...(options.inherit ? { stdio: 'inherit' } : { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
    windowsHide: false,
    shell: false,
    env: options.env || process.env
  });
  if (!options.inherit && options.logPath) fs.appendFileSync(options.logPath, `${result.stdout || ''}${result.stderr || ''}`, 'utf8');
  if (!options.inherit && result.stdout) process.stdout.write(result.stdout);
  if (!options.inherit && result.stderr) process.stderr.write(result.stderr);
  return { status: Number.isInteger(result.status) ? result.status : 1, signal: result.signal || null, error: result.error?.message || '' };
}

function runChecked(command, args, options = {}) {
  const accepted = new Set(options.acceptedCodes || [0]);
  const result = commandResult(command, args, options);
  if (!accepted.has(result.status)) {
    throw workflowError(options.reasonCode || 'WHATSAPP_REAL_UAT_COMMAND_FAILED', options.message || `${command} 执行失败`, { command, args, result });
  }
  return result;
}

function runningYanceProcesses(repoRoot, dataRoot) {
  if (process.platform !== 'win32') return [];
  const script = [
    "$rows = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Yance.exe','electron.exe','node.exe') } | Select-Object ProcessId,Name,CommandLine",
    '$rows | ConvertTo-Json -Compress'
  ].join('; ');
  let parsed = [];
  try {
    const raw = clean(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }));
    if (raw) parsed = JSON.parse(raw);
  } catch (error) {
    throw workflowError('WHATSAPP_REAL_UAT_PROCESS_SCAN_FAILED', '无法确认言策是否已完全退出', { message: error.message });
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const needles = [path.resolve(repoRoot), path.resolve(dataRoot), 'yance'].map(value => value.toLowerCase());
  return rows.filter(row => {
    if (Number(row.ProcessId) === process.pid) return false;
    const name = clean(row.Name).toLowerCase();
    const commandLine = clean(row.CommandLine).toLowerCase();
    if (name === 'yance.exe') return true;
    return commandLine && needles.some(needle => commandLine.includes(needle));
  });
}

function assertYanceStopped(repoRoot, dataRoot, stage) {
  const rows = runningYanceProcesses(repoRoot, dataRoot);
  if (rows.length) {
    throw workflowError('WHATSAPP_REAL_UAT_PROCESS_STILL_RUNNING', `${stage}：检测到言策相关进程，拒绝读取或备份可能仍在写入的 SQLite`, { processes: rows });
  }
  return rows;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function relevantStateHashes(dataRoot) {
  const database = path.join(dataRoot, 'store', 'yance-r32.db');
  const candidates = [database, `${database}-wal`, `${database}-shm`, path.join(dataRoot, 'logs', 'desktop.jsonl'), path.join(dataRoot, 'logs', 'server.jsonl')];
  return {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_REAL_UAT_STATE_HASHES',
    generatedAt: new Date().toISOString(),
    dataRoot: path.resolve(dataRoot),
    files: candidates.map(file => {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { file, exists: false, sizeBytes: 0, sha256: '' };
      const stat = fs.statSync(file);
      return { file, exists: true, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), sha256: sha256File(file) };
    })
  };
}

function verifyBackupState(sourceRoot, backupRoot) {
  const source = relevantStateHashes(sourceRoot);
  const backup = relevantStateHashes(backupRoot);
  const relative = row => path.relative(row.dataRoot || '', row.file || '').split(path.sep).join('/');
  const backupByRelative = new Map(backup.files.map(row => [relative({ ...row, dataRoot: backup.dataRoot }), row]));
  const checks = source.files.map(sourceRow => {
    const key = relative({ ...sourceRow, dataRoot: source.dataRoot });
    const backupRow = backupByRelative.get(key) || { exists: false, sizeBytes: 0, sha256: '' };
    const required = key === 'store/yance-r32.db' || (sourceRow.exists && ['store/yance-r32.db-wal', 'store/yance-r32.db-shm'].includes(key));
    return {
      relativePath: key,
      required,
      sourceExists: sourceRow.exists,
      backupExists: backupRow.exists,
      sourceSizeBytes: sourceRow.sizeBytes,
      backupSizeBytes: backupRow.sizeBytes,
      sourceSha256: sourceRow.sha256,
      backupSha256: backupRow.sha256,
      matches: sourceRow.exists === backupRow.exists && (!sourceRow.exists || (sourceRow.sizeBytes === backupRow.sizeBytes && sourceRow.sha256 === backupRow.sha256))
    };
  });
  const blockers = checks.filter(row => row.required && !row.matches).map(row => ({ reasonCode: 'WHATSAPP_REAL_UAT_BACKUP_CORE_FILE_MISMATCH', ...row }));
  const report = {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_REAL_UAT_BACKUP_VERIFICATION',
    generatedAt: new Date().toISOString(),
    sourceRoot: path.resolve(sourceRoot),
    backupRoot: path.resolve(backupRoot),
    ok: blockers.length === 0,
    checks,
    blockers
  };
  if (blockers.length) throw workflowError('WHATSAPP_REAL_UAT_BACKUP_VERIFICATION_FAILED', '备份后的 SQLite/WAL/SHM 未通过哈希校验，拒绝启动言策', report);
  return report;
}

function backupDataRoot(dataRoot, backupRoot, logPath) {
  if (path.resolve(backupRoot).toLowerCase().startsWith(`${path.resolve(dataRoot).toLowerCase()}${path.sep}`)) {
    throw workflowError('WHATSAPP_REAL_UAT_BACKUP_PATH_INVALID', '备份目录不能位于真实数据目录内部', { dataRoot, backupRoot });
  }
  fs.mkdirSync(backupRoot, { recursive: true });
  if (process.platform === 'win32') {
    const args = [dataRoot, backupRoot, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1', '/XJ', '/NP', `/LOG:${logPath}`, '/TEE'];
    return runChecked('robocopy.exe', args, {
      acceptedCodes: [0, 1, 2, 3, 4, 5, 6, 7],
      reasonCode: 'WHATSAPP_REAL_UAT_BACKUP_FAILED',
      message: '真实数据目录备份失败',
      inherit: true
    });
  }
  fs.cpSync(dataRoot, backupRoot, { recursive: true, force: true, errorOnExist: false });
  fs.writeFileSync(logPath, `Non-Windows test copy: ${dataRoot} -> ${backupRoot}\n`, 'utf8');
  return { status: 0, signal: null, error: '' };
}

function writeSummaryMarkdown(summary) {
  const lines = [
    '# 言策 WhatsApp 真实 Windows 安全验收流程', '',
    `- 状态：**${summary.status}**`,
    `- 数据目录：\`${summary.dataRoot}\``,
    `- 证据目录：\`${summary.evidenceRoot}\``,
    `- 开始：${summary.startedAt}`,
    `- 完成：${summary.completedAt || ''}`, '',
    '## 阶段结果', ''
  ];
  for (const row of summary.stages || []) lines.push(`- ${row.stage}：${row.status}${row.exitCode == null ? '' : `（exit ${row.exitCode}）`}`);
  if (summary.blockers?.length) {
    lines.push('', '## 阻断项', '');
    for (const blocker of summary.blockers) lines.push(`- ${blocker.reasonCode || blocker.code || 'BLOCKED'}：${blocker.message || JSON.stringify(blocker)}`);
  }
  if (summary.warnings?.length) {
    lines.push('', '## 未阻断但仍需验证', '');
    for (const warning of summary.warnings) lines.push(`- ${warning.reasonCode || 'WARNING'}：${warning.note || warning.message || JSON.stringify(warning)}`);
  }
  lines.push('', '## 仍需人工真实 UI 验收', '',
    '- 同一联系人只剩一个可见会话，姓名与头像不闪烁。',
    '- 联系人列表、会话顶部、消息气泡和客户档案使用同一头像。',
    '- AI 能读取合并后的完整历史，不再提示客户不存在。',
    '- 文本、图片和媒体发送不再出现发送来源冲突。',
    '- 完全退出并再次启动后仍保持一致，且不串账号、不串平台。', '');
  return lines.join('\n');
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

const DEPRECATED_NON_BLOCKING_DIAGNOSTIC_CODES = new Set([
  // Legacy diagnostics incorrectly treated image pixels as platform identity.
  // A WhatsApp Business contact may legitimately use a Facebook/Meta logo.
  'WHATSAPP_AVATAR_PLATFORM_CONTENT_MISMATCH'
]);
const STARTUP_REPAIRABLE_DIAGNOSTIC_BLOCKERS = new Set();

function classifyPostMigrationDiagnostic(report = {}) {
  const reasonCodes = new Set((Array.isArray(report?.mergeIntegrity?.blockers) ? report.mergeIntegrity.blockers : [])
    .map(clean).filter(code => code && !DEPRECATED_NON_BLOCKING_DIAGNOSTIC_CODES.has(code)));
  if (Number(report?.summary?.duplicateGroups || 0) > 0) reasonCodes.add('WHATSAPP_DUPLICATE_GROUPS_REMAIN');
  if (Number(report?.summary?.invalidCanonicalAuthorityRows || 0) > 0) reasonCodes.add('WHATSAPP_INVALID_CANONICAL_REMAINS');
  const blockers = [...reasonCodes];
  const nonRepairable = blockers.filter(code => !STARTUP_REPAIRABLE_DIAGNOSTIC_BLOCKERS.has(code));
  return {
    okToLaunch: nonRepairable.length === 0,
    blockers,
    repairable: blockers.filter(code => STARTUP_REPAIRABLE_DIAGNOSTIC_BLOCKERS.has(code)),
    nonRepairable
  };
}

function writeComparisonReports(paths) {
  const report = compareReports(readJson(paths.beforeJson), readJson(paths.afterJson), {
    beforePath: paths.beforeJson,
    afterPath: paths.afterJson
  });
  fs.mkdirSync(path.dirname(paths.comparisonJson), { recursive: true });
  fs.mkdirSync(path.dirname(paths.comparisonMarkdown), { recursive: true });
  fs.writeFileSync(paths.comparisonJson, canonicalJson(report), 'utf8');
  fs.writeFileSync(paths.comparisonMarkdown, comparisonMarkdown(report), 'utf8');
  return report;
}

function main() {
  const options = parseArgs();
  const repoRoot = path.resolve(__dirname, '..', '..');
  if (process.platform !== 'win32' && !options.allowNonWindows && !options.planOnly) {
    throw workflowError('WHATSAPP_REAL_UAT_WINDOWS_REQUIRED', '此入口只允许在真实 Windows 上执行');
  }
  const rootResolution = resolveDataRoot(options.dataRoot);
  const dataRoot = rootResolution.selected.dataRoot;
  const paths = buildPaths(repoRoot, options, dataRoot);
  const plan = buildWorkflowPlan(repoRoot, options, rootResolution, paths);
  if (options.planOnly) {
    process.stdout.write(canonicalJson(plan));
    return;
  }

  fs.mkdirSync(paths.reports, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.writeFileSync(path.join(paths.reports, '00-Workflow-Plan.json'), canonicalJson(plan), 'utf8');
  const summary = {
    schemaVersion: 1,
    kind: 'YANCE_WHATSAPP_REAL_WINDOWS_UAT_SAFE_RESULT',
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    completedAt: '',
    repoRoot,
    dataRoot,
    evidenceRoot: paths.evidenceRoot,
    backupRoot: paths.backup,
    stages: [],
    blockers: [],
    fullPipelineExecuted: false,
    wp7Executed: false,
    strictExecuted: false,
    finalBuilderExecuted: false
  };
  const record = (stage, status, extra = {}) => summary.stages.push({ stage, status, at: new Date().toISOString(), ...extra });
  const persistSummary = () => {
    fs.writeFileSync(paths.summaryJson, canonicalJson(summary), 'utf8');
    fs.writeFileSync(paths.summaryMarkdown, `${writeSummaryMarkdown(summary)}\n`, 'utf8');
  };

  try {
    assertYanceStopped(repoRoot, dataRoot, '启动前检查');
    record('BLOCK_IF_YANCE_PROCESS_RUNNING', 'PASS');

    const p0Args = [path.join(repoRoot, 'tools', 'uat', 'sourceUatP0Preflight.js'), '--data-root', dataRoot, '--worker', options.workerBaseUrl, '--output', paths.p0, '--allow-local-migration'];
    if (options.allowLegacyHealthz) p0Args.push('--allow-legacy-healthz');
    const p0 = runChecked(process.execPath, p0Args, { cwd: repoRoot, reasonCode: 'WHATSAPP_REAL_UAT_P0_BLOCKED', message: 'P0 合同预检未通过' });
    record('P0_CONTRACT_PREFLIGHT', 'PASS', { exitCode: p0.status, report: paths.p0 });

    const before = runChecked(process.execPath, [path.join(repoRoot, 'tools', 'uat', 'whatsappIdentityDiagnostics.js'), '--data-root', dataRoot, '--output', paths.beforeJson, '--markdown-output', paths.beforeMarkdown], {
      cwd: repoRoot, acceptedCodes: [0, 2], reasonCode: 'WHATSAPP_REAL_UAT_BEFORE_DIAGNOSTIC_FAILED', message: '启动前 WhatsApp 只读诊断失败'
    });
    record('READ_ONLY_WHATSAPP_DIAGNOSTIC_BEFORE', before.status === 2 ? 'FINDINGS_CAPTURED' : 'PASS', { exitCode: before.status, report: paths.beforeJson });

    backupDataRoot(dataRoot, paths.backup, paths.robocopyLog);
    record('FULL_DATA_ROOT_BACKUP', 'PASS', { backupRoot: paths.backup, log: paths.robocopyLog });

    const backupVerification = verifyBackupState(dataRoot, paths.backup);
    fs.writeFileSync(paths.backupVerification, canonicalJson(backupVerification), 'utf8');
    record('VERIFY_BACKUP_CORE_HASHES', 'PASS', { report: paths.backupVerification });

    fs.writeFileSync(paths.beforeHashes, canonicalJson(relevantStateHashes(dataRoot)), 'utf8');
    record('SOURCE_STATE_HASHES_BEFORE', 'PASS', { report: paths.beforeHashes });

    if (options.prepareOnly) {
      summary.status = 'PREPARED_BACKUP_COMPLETE';
      summary.completedAt = new Date().toISOString();
      persistSummary();
      process.stdout.write(canonicalJson({ ok: true, status: summary.status, evidenceRoot: paths.evidenceRoot, summary: paths.summaryJson }));
      return;
    }

    const migration = runChecked(process.execPath, [path.join(repoRoot, 'tools', 'uat', 'migrateWhatsappOrphanAccounts.js'), '--data-root', dataRoot, '--output', paths.migrationJson], {
      cwd: repoRoot, acceptedCodes: [0], reasonCode: 'WHATSAPP_REAL_UAT_ACCOUNT_RECONCILIATION_FAILED', message: '备份后的 WhatsApp 跨账号残留 reconciliation 失败'
    });
    record('APPLY_BACKED_UP_WHATSAPP_ACCOUNT_RECONCILIATION', 'PASS', { exitCode: migration.status, report: paths.migrationJson });

    const p0AfterArgs = [path.join(repoRoot, 'tools', 'uat', 'sourceUatP0Preflight.js'), '--data-root', dataRoot, '--worker', options.workerBaseUrl, '--output', paths.p0AfterMigration];
    if (options.allowLegacyHealthz) p0AfterArgs.push('--allow-legacy-healthz');
    const p0After = runChecked(process.execPath, p0AfterArgs, { cwd: repoRoot, reasonCode: 'WHATSAPP_REAL_UAT_POST_MIGRATION_P0_BLOCKED', message: 'WhatsApp migration 后 P0 合同预检未通过' });
    record('P0_POST_MIGRATION_PREFLIGHT', 'PASS', { exitCode: p0After.status, report: paths.p0AfterMigration });

    const migrationDiagnostic = runChecked(process.execPath, [path.join(repoRoot, 'tools', 'uat', 'whatsappIdentityDiagnostics.js'), '--data-root', dataRoot, '--output', paths.migrationDiagnosticJson, '--markdown-output', paths.migrationDiagnosticMarkdown], {
      cwd: repoRoot,
      acceptedCodes: [0, 2],
      reasonCode: 'WHATSAPP_REAL_UAT_POST_MIGRATION_DIAGNOSTIC_FAILED',
      message: 'WhatsApp migration 后数据完整性诊断执行失败'
    });
    const postMigrationDiagnosticReport = readJson(paths.migrationDiagnosticJson);
    const postMigrationDisposition = classifyPostMigrationDiagnostic(postMigrationDiagnosticReport);
    if (!postMigrationDisposition.okToLaunch) {
      throw workflowError('WHATSAPP_REAL_UAT_POST_MIGRATION_DIAGNOSTIC_BLOCKED', 'WhatsApp migration 后仍有不可由启动修复的数据阻断项', {
        report: paths.migrationDiagnosticJson,
        blockers: postMigrationDisposition.nonRepairable,
        allFindings: postMigrationDisposition.blockers
      });
    }
    record('READ_ONLY_WHATSAPP_DIAGNOSTIC_POST_MIGRATION', migrationDiagnostic.status === 2 ? 'REPAIRABLE_FINDINGS_CAPTURED' : 'PASS', {
      exitCode: migrationDiagnostic.status,
      report: paths.migrationDiagnosticJson,
      repairableFindings: postMigrationDisposition.repairable
    });

    const electron = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fs.existsSync(electron) && options.skipInstall) {
      throw workflowError('SOURCE_UAT_ELECTRON_MISSING', 'Electron 未安装且指定了 SkipInstall；已完成诊断和备份，但不会启动言策', { electron });
    }
    const startArgs = [path.join(repoRoot, 'tools', 'runtime-delivery', 'start-source-uat.js'), `--data-root=${dataRoot}`, `--port=${options.port}`];
    if (!fs.existsSync(electron)) startArgs.push('--install');
    const launch = commandResult(process.execPath, startArgs, { cwd: repoRoot, logPath: paths.launchLog, inherit: true });
    record('START_SOURCE_UAT_AND_WAIT_FOR_EXIT', launch.status === 0 ? 'PASS' : 'FAILED', { exitCode: launch.status, log: paths.launchLog });

    assertYanceStopped(repoRoot, dataRoot, '启动后检查');
    record('BLOCK_IF_BACKEND_OWNER_REMAINS', 'PASS');

    const after = runChecked(process.execPath, [path.join(repoRoot, 'tools', 'uat', 'whatsappIdentityDiagnostics.js'), '--data-root', dataRoot, '--output', paths.afterJson, '--markdown-output', paths.afterMarkdown], {
      cwd: repoRoot, acceptedCodes: [0, 2], reasonCode: 'WHATSAPP_REAL_UAT_AFTER_DIAGNOSTIC_FAILED', message: '启动后 WhatsApp 只读诊断失败'
    });
    record('READ_ONLY_WHATSAPP_DIAGNOSTIC_AFTER', after.status === 2 ? 'BLOCKED_FINDINGS_CAPTURED' : 'PASS', { exitCode: after.status, report: paths.afterJson });

    fs.writeFileSync(paths.afterHashes, canonicalJson(relevantStateHashes(dataRoot)), 'utf8');
    record('SOURCE_STATE_HASHES_AFTER', 'PASS', { report: paths.afterHashes });

    let comparisonReport;
    try {
      comparisonReport = writeComparisonReports(paths);
    } catch (error) {
      throw workflowError('WHATSAPP_REAL_UAT_COMPARISON_FAILED', '启动前后 WhatsApp 诊断对比失败', {
        before: paths.beforeJson,
        after: paths.afterJson,
        code: error.code || '',
        message: error.message || String(error),
        stack: error.stack || ''
      });
    }
    record('COMPARE_BEFORE_AND_AFTER', comparisonReport.blockers?.length ? 'BLOCKED' : 'PASS', {
      exitCode: comparisonReport.blockers?.length ? 2 : 0,
      report: paths.comparisonJson
    });

    if (launch.status !== 0) summary.blockers.push({ reasonCode: 'SOURCE_UAT_EXIT_NONZERO', message: `言策源码 UAT 退出码为 ${launch.status}`, exitCode: launch.status });
    if (comparisonReport.blockers?.length) summary.blockers.push(...comparisonReport.blockers);
    summary.warnings = Array.isArray(comparisonReport.warnings) ? comparisonReport.warnings : [];
    summary.status = summary.blockers.length ? 'BLOCKED' : 'READY_FOR_REAL_UI_UAT';
    summary.completedAt = new Date().toISOString();
    persistSummary();

    if (process.platform === 'win32' && !options.noExplorer) spawnSync('explorer.exe', [paths.evidenceRoot], { windowsHide: false });
    process.stdout.write(canonicalJson({ ok: !summary.blockers.length, status: summary.status, evidenceRoot: paths.evidenceRoot, summary: paths.summaryJson, comparison: paths.comparisonJson, blockers: summary.blockers }));
    if (summary.blockers.length) process.exitCode = 2;
  } catch (error) {
    summary.status = 'FAILED';
    summary.completedAt = new Date().toISOString();
    summary.blockers.push({ reasonCode: error.reasonCode || error.code || 'WHATSAPP_REAL_UAT_FAILED', message: error.message, details: error.details || {} });
    persistSummary();
    throw error;
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(canonicalJson({ ok: false, reasonCode: error.reasonCode || error.code || 'WHATSAPP_REAL_UAT_FAILED', message: error.message, details: error.details || {} }));
    process.exitCode = ['WHATSAPP_REAL_UAT_PROCESS_STILL_RUNNING', 'WHATSAPP_REAL_UAT_P0_BLOCKED'].includes(error.reasonCode) ? 2 : 1;
  }
}

module.exports = {
  buildPaths,
  buildWorkflowPlan,
  parseArgs,
  relevantStateHashes,
  resolveDataRoot,
  verifyBackupState,
  classifyPostMigrationDiagnostic,
  writeComparisonReports,
  stamp,
  writeSummaryMarkdown
};
