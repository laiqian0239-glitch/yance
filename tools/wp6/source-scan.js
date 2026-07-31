'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, PRODUCTION_ROOTS, rel, walk } = require('./common');

const DELETED_PATHS = [
  'electron/core/coreRuntime.js','electron/core/accountContext.js','electron/core/securityGuard.js',
  'backend/core/coreRuntime.js','backend/core/lifecycleManager.js','backend/core/compositionRoot.js'
];
const JS = /\.(?:js|cjs|mjs)$/i;
function occurrence(file, source, pattern, reasonCode) {
  const rows = [];
  source.split(/\r?\n/).forEach((line, index) => { if (pattern.test(line)) rows.push({ file: rel(file), line: index + 1, reasonCode, excerpt: line.trim().slice(0, 240) }); pattern.lastIndex = 0; });
  return rows;
}
function scanSource(root = ROOT) {
  const findings = [], scannerErrors = [];
  for (const relative of DELETED_PATHS) if (fs.existsSync(path.join(root, relative))) findings.push({ file: relative, reasonCode: 'OLD_RUNTIME_EXACT_PATH_PRESENT' });
  const files = PRODUCTION_ROOTS.flatMap(name => walk(path.join(root, name), { errors: scannerErrors })).filter(file => JS.test(file));
  for (const file of files) {
    let source; try { source = fs.readFileSync(file, 'utf8'); } catch (error) { scannerErrors.push({ path: rel(file), error: error.message }); continue; }
    findings.push(...occurrence(file, source, /\bexecuteLegacy\b/, 'LEGACY_RUNTIME_EXECUTOR_PRESENT'));
    findings.push(...occurrence(file, source, /desktop:lifecycle/, 'LEGACY_DESKTOP_LIFECYCLE_CHANNEL_PRESENT'));
    findings.push(...occurrence(file, source, /electron[\\/]core[\\/](?:coreRuntime|accountContext|securityGuard)|backend[\\/]core[\\/](?:coreRuntime|lifecycleManager|compositionRoot)/i, 'OLD_RUNTIME_DYNAMIC_PATH_PRESENT'));
    if (rel(file) === 'electron/preload.js') {
      findings.push(...occurrence(file, source, /executeControl|executeBusinessCommand|runtimeInternal|desktopCore|core-command/i, 'PRELOAD_GENERIC_RUNTIME_CONTROL_EXPOSED'));
    }
    if (rel(file) === 'electron/main.js') {
      if (!/new\s+ApiV2RuntimeClient\b/.test(source) || !/new\s+RuntimeProjectionCoordinator\b/.test(source)) findings.push({ file: rel(file), reasonCode: 'ELECTRON_API_V2_COORDINATOR_MISSING' });
      if (/function\s+launchBackend\b[\s\S]{0,1200}?startBackendProcessForCoordinator\(/.test(source) && !/WP6_DESKTOP_COORDINATOR_REQUIRED/.test(source)) findings.push({ file: rel(file), reasonCode: 'DIRECT_START_FALLBACK_REACHABLE' });
    }
  }
  const appRuntime = fs.readFileSync(path.join(root, 'backend/runtime/AppRuntime.js'), 'utf8');
  if (/\bexecute\s*\(input\)/.test(appRuntime)) findings.push({ file: 'backend/runtime/AppRuntime.js', reasonCode: 'GENERIC_RUNTIME_EXECUTOR_PRESENT' });
  if (!/RUNTIME_CONTROL_API_V2_REQUIRED/.test(appRuntime)) findings.push({ file: 'backend/runtime/AppRuntime.js', reasonCode: 'LEGACY_RUNTIME_COMMAND_REJECTION_MISSING' });
  const system = fs.readFileSync(path.join(root, 'backend/routes/system.js'), 'utf8');
  if (!/Object\.prototype\.hasOwnProperty\.call\(patch,\s*'safeMode'\)/.test(system) || !/OPERATING_MODE_API_V2_REQUIRED/.test(system)) findings.push({ file: 'backend/routes/system.js', reasonCode: 'POLICY_MODE_CONTROL_NOT_FAIL_CLOSED' });
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  if (/desktop:lifecycle/.test(server)) findings.push({ file: 'backend/server.js', reasonCode: 'BACKEND_CHILD_IPC_RUNTIME_CONTROL_PRESENT' });
  const status = scannerErrors.length ? 'FAIL' : findings.length ? 'FAIL' : 'PASS';
  return { schemaVersion: 1, status, scanComplete: scannerErrors.length === 0, roots: PRODUCTION_ROOTS, filesScanned: files.length, exactOldPaths: DELETED_PATHS, hitCount: findings.length, findings, scannerErrors };
}
if (require.main === module) { const report = scanSource(); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : 1; }
module.exports = { DELETED_PATHS, scanSource };
