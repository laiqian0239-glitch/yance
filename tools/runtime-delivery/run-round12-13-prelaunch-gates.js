'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const outputRoot = path.join(root, '.tmp', 'round12-13-prelaunch-gates');

function run(label, command, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 96 * 1024 * 1024
  });
  const row = {
    label,
    command,
    args,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? String(result.error.stack || result.error.message || result.error) : ''
  };
  fs.writeFileSync(path.join(outputRoot, `${label}.stdout.log`), row.stdout, 'utf8');
  fs.writeFileSync(path.join(outputRoot, `${label}.stderr.log`), row.stderr, 'utf8');
  process.stdout.write(row.stdout);
  process.stderr.write(row.stderr);
  if (row.error) process.stderr.write(`${row.error}\n`);
  return row;
}

function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const rows = [run('engineering-protocol-v3', process.execPath, ['tools/protocol/validate-v3-protocols.js'])];
  const groups = [
    {
      label: 'round12-platform-core',
      files: [
        'backend/tests/platformCapabilityAuthority.test.js',
        'backend/tests/round12PlatformCoreMigration.test.js',
        'backend/tests/round12PlatformCoreAuthorities.test.js',
        'backend/tests/round12AdapterPorts.test.js',
        'backend/tests/round12ArchitectureStatus.test.js',
        'backend/tests/messageIdentityEvidenceOrdering.test.js',
        'backend/tests/round12Round13ThirdSelfCheck.test.js',
        'backend/tests/round12Round13RemainingClosure.test.js',
        'backend/tests/round12Round13ProductGovernanceClosure.test.js',
        'backend/tests/round12Round13FinalGovernanceClosure.test.js',
        'backend/tests/round12Round13FinalSevenClosure.test.js'
      ]
    },
    {
      label: 'round13-ai-quality',
      files: [
        'backend/tests/aiQualityRouteAuthority.test.js',
        'backend/tests/aiGatewayQualityEnforcement.test.js',
        'backend/tests/round13AIQualityArchitecture.test.js',
        'backend/tests/systemAuditRound2DirectorProduction.test.js',
        'backend/tests/personaBrain/candidateBinding.test.js'
      ]
    },
    {
      label: 'round11-ui-and-package',
      files: [
        'tests/uat/round11ConversationCenterUi.test.js',
        'tests/runtime-delivery/round12-13-windows-uat-package.test.js'
      ]
    },
    {
      label: 'platform-production-readiness',
      files: [
        'backend/tests/platformProductionReadinessAuthority.test.js',
        'backend/tests/facebookBusinessSuiteReconciliationRegression.test.js',
        'backend/tests/facebookProductionReadinessRegression.test.js',
        'backend/tests/telegramHistorySyncRegression.test.js',
        'tests/uat/exportPlatformProductionEvidence.test.js'
      ]
    },
    {
      label: 'complete-dependency-persona-api',
      files: [
        'tests/persona-brain/runtime-contract.test.js',
        'tests/persona-brain/workbench-api.test.js'
      ]
    }
  ];
  rows.push(...groups.map(group => run(group.label, process.execPath, ['--test', '--test-concurrency=1', ...group.files])));
  rows.push(run('round12-13-theme-audit', process.execPath, ['scripts/audit-theme-colors.js']));
  const ok = rows.every(row => row.exitCode === 0);
  const report = {
    schemaVersion: 1,
    documentType: 'YANCE_ROUND12_13_PRELAUNCH_GATES',
    generatedAtUtc: new Date().toISOString(),
    ok,
    dependencySensitiveTests: [
      'tests/persona-brain/runtime-contract.test.js',
      'tests/persona-brain/workbench-api.test.js'
    ],
    rows: rows.map(({ stdout, stderr, ...row }) => ({
      ...row,
      stdoutLog: `${row.label}.stdout.log`,
      stderrLog: `${row.label}.stderr.log`
    }))
  };
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok, outputRoot, gates: report.rows }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

try { main(); }
catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
