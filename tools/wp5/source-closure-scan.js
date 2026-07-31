#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, resultEnvelope, writeJson } = require('./common');

const roots = ['backend', 'electron', 'frontend', 'shared'];
const files = [];
for (const root of roots) {
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:js|json|html|css)$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(path.join(ROOT, root));
}
const rel = file => path.relative(ROOT, file).replace(/\\/g, '/');
const text = file => fs.readFileSync(file, 'utf8');
const occurrences = (pattern, allow = () => false) => files.flatMap(file => {
  const content = text(file); const rows = [];
  for (const match of content.matchAll(pattern)) {
    const row = { file: rel(file), line: content.slice(0, match.index).split('\n').length, match: match[0] };
    if (!allow(row, content)) rows.push(row);
  }
  return rows;
});

const checks = [
  ['DEFAULT_YANCE27_ROOT_ABSENT', occurrences(/(?:\.yance27|Yance27)/g, row => [
    'backend/runtime/RuntimeAuthorityMigrationCoordinator.js',
    'backend/services/legacyRootDiscovery.js',
    'electron/legacyDataRoots.js',
    'electron/desktopHost/LegacyRuntimeCutoverGate.js',
    'electron/main.js',
    'backend/services/migrationService.js',
    // This module is an explicit negative-injection probe. It never participates
    // in the installed runtime entry graph; the legacy literals are test inputs.
    'electron/wp7InstalledRuntimeProbeProductionHost.js'
  ].includes(row.file))],
  // Match the retired runtime authority key only. Prefixes such as
  // YANCE_SAFE_MODE_FINAL_FAILURE_THRESHOLD are unrelated safety tuning knobs.
  ['YANCE_SAFE_MODE_RUNTIME_ACCESS_ABSENT', occurrences(/YANCE_SAFE_MODE(?!_[A-Z0-9])/g, (row, content) => {
    if (row.file !== 'electron/desktopHost/BackendProcessHost.js') return false;
    const line = content.split('\n')[row.line - 1] || '';
    return /delete\s+env\.YANCE_SAFE_MODE\s*;/.test(line);
  })],
  ['SAFE_MODE_STATE_RUNTIME_IO_ABSENT', occurrences(/safe-mode-state\.json/g, row => [
    'backend/runtime/RuntimeAuthorityMigrationCoordinator.js',
    'electron/wp7InstalledRuntimeProbeProductionHost.js'
  ].includes(row.file))],
  ['SYSTEM_POLICY_SAFE_MODE_AUTHORITY_ABSENT', occurrences(/system-policy\.safeMode|policy\.safeMode/g, row => row.file === 'backend/services/systemPolicy.js')],
  // Detect direct persistence or reads from desktop settings. Do not use a broad
  // same-line proximity rule because the bundled renderer is intentionally
  // minified and policy.safeMode may appear thousands of characters after the
  // desktopSettings state declaration on the same physical line.
  ['DESKTOP_SETTINGS_SAFE_MODE_STORAGE_ABSENT', occurrences(/desktopSettings(?:\?\.|\.|\[['"])(?:safeMode)|desktop\?\.settings\?\.safeMode/g)],
  ['RENDERER_SAFE_MODE_RESTART_FALLBACK_ABSENT', occurrences(/restartSafeMode|restart-safe/g)],
  ['LEGACY_ENV_DISCOVERY_ABSENT', occurrences(/YANCE_LEGACY_DATA_DIRS/g)],
  ['DIRECT_RUNTIME_MODE_SQL_SINGLE_MODULE', occurrences(/(?:UPDATE|INSERT\s+INTO)\s+runtime_state[\s\S]{0,180}operating_mode/gi, row => row.file === 'backend/runtime/RuntimeStateStore.js')],
  ['PRODUCTION_LIFECYCLE_MANAGER_IMPORT_ABSENT', occurrences(/require\([^\n]*shared\/core\/lifecycleManager|from\s+['"][^'"]*shared\/core\/lifecycleManager/g)],
  ['WP5_AUTHORIZATION_PRESENT', fs.readFileSync(path.join(ROOT, 'implementation/work-package-status.json'), 'utf8').includes('"productionImplementationAuthorized": true') ? [] : [{ file: 'implementation/work-package-status.json', line: 1, match: 'authorization missing' }]],
  ['FINAL_IDENTITY_BINDING_VALID', (() => {
    const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'implementation/work-package-status.json'), 'utf8'));
    const wp5 = status.workPackages.WP5 || {};
    const values = [wp5.implementationCommit, wp5.candidateBindingCommit, wp5.finalDeliveryHead, wp5.finalSourceTree];
    const finalAccepted = wp5.status === 'COMPLETED' || wp5.reviewStatus === 'ACCEPTED' || wp5.finalAcceptanceStatus === 'WP5_ACCEPTED';
    if (!finalAccepted) {
      return values.every(value => value == null) ? [] : [{ file: 'implementation/work-package-status.json', line: 1, match: 'premature identity' }];
    }
    return values.every(value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value))
      ? []
      : [{ file: 'implementation/work-package-status.json', line: 1, match: 'invalid final identity binding' }];
  })()]
];
const cases = checks.map(([id, violations]) => ({ id, status: violations.length ? 'FAIL' : 'PASS', violations }));
const report = resultEnvelope('WP5_SOURCE_CLOSURE_SCAN', cases, { scannedFiles: files.length });
report.phase='CONVERGENCE_PRE_REVIEW'; report.identity.sourceTree=report.identity.worktreeSourceTree; report.identity.implementationCommit=report.identity.sourceCommit;
  const artifact = writeJson('source-closure-scan.json', report);
console.log(JSON.stringify({ status: report.status, summary: report.summary, artifact }, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
