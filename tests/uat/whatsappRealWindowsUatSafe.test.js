'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildPaths,
  buildWorkflowPlan,
  parseArgs,
  relevantStateHashes,
  resolveDataRoot,
  verifyBackupState,
  classifyPostMigrationDiagnostic,
  writeComparisonReports,
  writeSummaryMarkdown
} = require('../../tools/uat/runWhatsappRealWindowsUatSafe');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-real-uat-safe-'));
  const store = path.join(root, 'store');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'yance-r32.db'), 'sqlite-fixture', 'utf8');
  return root;
}

test('安全工作流固定先检查、诊断和备份，再启动真实源码', () => {
  const dataRoot = fixture();
  const options = parseArgs(['--data-root', dataRoot, '--worker', 'https://worker.example', '--port', '28777', '--evidence-root', path.join(dataRoot, '..', 'evidence')]);
  const resolution = resolveDataRoot(dataRoot);
  const paths = buildPaths(path.resolve(__dirname, '..', '..'), options, resolution.selected.dataRoot, new Date('2026-07-21T12:00:00Z'));
  const plan = buildWorkflowPlan(paths.repoRoot, options, resolution, paths);
  assert.deepEqual(plan.stages.slice(0, 6), [
    'BLOCK_IF_YANCE_PROCESS_RUNNING',
    'P0_CONTRACT_PREFLIGHT',
    'READ_ONLY_WHATSAPP_DIAGNOSTIC_BEFORE',
    'FULL_DATA_ROOT_BACKUP',
    'VERIFY_BACKUP_CORE_HASHES',
    'SOURCE_STATE_HASHES_BEFORE'
  ]);
  assert.ok(plan.stages.indexOf('FULL_DATA_ROOT_BACKUP') < plan.stages.indexOf('APPLY_BACKED_UP_WHATSAPP_ACCOUNT_RECONCILIATION'));
  assert.ok(plan.stages.indexOf('APPLY_BACKED_UP_WHATSAPP_ACCOUNT_RECONCILIATION') < plan.stages.indexOf('READ_ONLY_WHATSAPP_DIAGNOSTIC_POST_MIGRATION'));
  assert.ok(plan.stages.indexOf('READ_ONLY_WHATSAPP_DIAGNOSTIC_POST_MIGRATION') < plan.stages.indexOf('START_SOURCE_UAT_AND_WAIT_FOR_EXIT'));
  assert.equal(plan.destructiveBeforeBackup, false);
  assert.equal(plan.fullPipelineExecuted, false);
  assert.equal(plan.wp7Executed, false);
  assert.equal(plan.strictExecuted, false);
  assert.equal(plan.finalBuilderExecuted, false);
});

test('PrepareOnly 只生成诊断和备份，不安排启动或 reconciliation 后检查', () => {
  const dataRoot = fixture();
  const options = parseArgs(['--data-root', dataRoot, '--prepare-only']);
  const resolution = resolveDataRoot(dataRoot);
  const paths = buildPaths('/repo', options, resolution.selected.dataRoot, new Date('2026-07-21T12:00:00Z'));
  const plan = buildWorkflowPlan('/repo', options, resolution, paths);
  assert.equal(plan.prepareOnly, true);
  assert.equal(plan.stages.includes('START_SOURCE_UAT_AND_WAIT_FOR_EXIT'), false);
  assert.equal(plan.stages.includes('COMPARE_BEFORE_AND_AFTER'), false);
});

test('备份核心数据库文件必须逐项通过 SHA-256', () => {
  const dataRoot = fixture();
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-real-uat-backup-'));
  fs.cpSync(dataRoot, backupRoot, { recursive: true });
  assert.equal(verifyBackupState(dataRoot, backupRoot).ok, true);
  fs.writeFileSync(path.join(backupRoot, 'store', 'yance-r32.db'), 'corrupt', 'utf8');
  assert.throws(() => verifyBackupState(dataRoot, backupRoot), error => error?.reasonCode === 'WHATSAPP_REAL_UAT_BACKUP_VERIFICATION_FAILED');
});

test('状态哈希覆盖 SQLite/WAL/SHM 与关键日志且不修改源文件', () => {
  const dataRoot = fixture();
  const database = path.join(dataRoot, 'store', 'yance-r32.db');
  fs.writeFileSync(`${database}-wal`, 'wal', 'utf8');
  const before = fs.readFileSync(database, 'utf8');
  const hashes = relevantStateHashes(dataRoot);
  assert.equal(hashes.files.length, 5);
  assert.equal(hashes.files.find(row => row.file === database).exists, true);
  assert.match(hashes.files.find(row => row.file === database).sha256, /^[0-9a-f]{64}$/u);
  assert.equal(fs.readFileSync(database, 'utf8'), before);
});



test('migration 后忽略旧版头像像素误报，但仍阻断真实结构问题', () => {
  const repairable = classifyPostMigrationDiagnostic({
    summary: { duplicateGroups: 0, invalidCanonicalAuthorityRows: 0 },
    mergeIntegrity: { blockers: ['WHATSAPP_AVATAR_PLATFORM_CONTENT_MISMATCH'] }
  });
  assert.equal(repairable.okToLaunch, true);
  assert.deepEqual(repairable.repairable, []);
  assert.deepEqual(repairable.blockers, []);
  assert.deepEqual(repairable.nonRepairable, []);

  const structural = classifyPostMigrationDiagnostic({
    summary: { duplicateGroups: 1, invalidCanonicalAuthorityRows: 0 },
    mergeIntegrity: { blockers: ['WHATSAPP_AVATAR_PLATFORM_CONTENT_MISMATCH', 'WHATSAPP_MERGED_REFERENCE_LEAK'] }
  });
  assert.equal(structural.okToLaunch, false);
  assert.ok(structural.nonRepairable.includes('WHATSAPP_DUPLICATE_GROUPS_REMAIN'));
  assert.ok(structural.nonRepairable.includes('WHATSAPP_MERGED_REFERENCE_LEAK'));
});

test('启动前后比较在当前进程内写出 JSON 和 Markdown，不依赖 Windows 子进程', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-real-uat-compare-'));
  const beforeJson = path.join(root, 'before.json');
  const afterJson = path.join(root, 'after.json');
  const comparisonJson = path.join(root, 'comparison.json');
  const comparisonMarkdown = path.join(root, 'comparison.md');
  const base = {
    source: { dataRoot: 'C:\\Data\\Yance' },
    p0Baseline: { whatsappIdentityContractVersion: 5, whatsappMergeIntegrityContractVersion: 3 },
    summary: {
      duplicateGroups: 0, duplicateActiveConversations: 0, invalidCanonicalAuthorityRows: 0,
      staleMergedReferences: 0, pendingSendPayloadMismatches: 0, sendRouteBlockedConversations: 0,
      avatarProvenanceErrors: 0, whatsappMediaReady: 0, whatsappMediaPending: 0, whatsappMediaFailed: 0, whatsappMediaMissingEnvelope: 0, weakDisplayNameConversations: 1, foreignKeyViolations: 0,
      mergeAuditRows: 1, whatsappConversations: 1, whatsappContacts: 1, whatsappMessages: 5
    },
    mergeIntegrity: { ok: true, blockers: [] },
    allConversationRows: [{ conversationId: 'c1', mergedInto: '' }]
  };
  fs.writeFileSync(beforeJson, JSON.stringify(base));
  fs.writeFileSync(afterJson, JSON.stringify(base));
  const report = writeComparisonReports({ beforeJson, afterJson, comparisonJson, comparisonMarkdown });
  assert.equal(report.status, 'READY_FOR_REAL_UI_UAT');
  assert.equal(fs.existsSync(comparisonJson), true);
  assert.match(fs.readFileSync(comparisonMarkdown, 'utf8'), /READY_FOR_REAL_UI_UAT/u);
  const workflowSource = fs.readFileSync(path.resolve(__dirname, '../../tools/uat/runWhatsappRealWindowsUatSafe.js'), 'utf8');
  assert.doesNotMatch(workflowSource, /commandResult\(process\.execPath, \[path\.join\(repoRoot, 'tools', 'uat', 'compareWhatsappIdentityDiagnostics\.js'/u);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('流程报告明确保留真实 UI 和重启持久化验收', () => {
  const markdown = writeSummaryMarkdown({
    status: 'READY_FOR_REAL_UI_UAT', dataRoot: 'D:\\Data', evidenceRoot: 'D:\\Evidence',
    startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:10:00Z', stages: [], blockers: []
  });
  assert.match(markdown, /完全退出并再次启动后仍保持一致/u);
  assert.match(markdown, /不串账号、不串平台/u);
  const warningMarkdown = writeSummaryMarkdown({
    status: 'READY_FOR_REAL_UI_UAT', dataRoot: 'D:\Data', evidenceRoot: 'D:\Evidence',
    startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:10:00Z', stages: [], blockers: [],
    warnings: [{ reasonCode: 'WHATSAPP_REAL_TEXT_SEND_NOT_OBSERVED', note: '仍需真实发送文本验证。' }]
  });
  assert.match(warningMarkdown, /WHATSAPP_REAL_TEXT_SEND_NOT_OBSERVED/u);
  assert.match(warningMarkdown, /仍需真实发送文本验证/u);
});

test('根目录入口不触碰主题或 Telegram，并保留阻断退出码', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const ps1 = fs.readFileSync(path.join(repoRoot, 'RUN_WHATSAPP_REAL_UAT_SAFE.ps1'), 'utf8');
  const cmd = fs.readFileSync(path.join(repoRoot, 'RUN_WHATSAPP_REAL_UAT_SAFE.cmd'), 'utf8');
  assert.match(ps1, /P0 合同预检/u);
  assert.match(ps1, /完整备份/u);
  assert.doesNotMatch(ps1, /主题|Telegram/u);
  assert.match(cmd, /exit \/b %EXIT_CODE%/u);
});
