'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, PRODUCTION_ROOTS, rel, tempRoot, walk } = require('./common');
const { DELETED_PATHS } = require('./source-scan');

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to); else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}
function buildInstalledFixture(root = ROOT) {
  const parent = tempRoot('yance-wp6-installed-');
  const appRoot = path.join(parent, 'resources', 'app.asar.unpacked');
  for (const name of PRODUCTION_ROOTS) copyTree(path.join(root, name), path.join(appRoot, name));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(appRoot, 'package.json'));
  return { root: parent, appRoot, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
function scanInstalledTree(installedRoot, options = {}) {
  const findings = [], scannerErrors = [];
  if (!installedRoot || !fs.existsSync(installedRoot)) return { schemaVersion: 1, status: 'FAIL', scanComplete: false, hitCount: 0, findings: [], scannerErrors: [{ path: installedRoot || '', error: 'installed root missing' }] };
  const files = walk(installedRoot, { errors: scannerErrors });
  const normalized = files.map(file => path.relative(installedRoot, file).split(path.sep).join('/').toLowerCase());
  for (const old of DELETED_PATHS) {
    const suffix = old.toLowerCase();
    const hit = normalized.find(name => name.endsWith(suffix));
    if (hit) findings.push({ file: hit, reasonCode: 'OLD_RUNTIME_INSTALLED_PATH_PRESENT' });
  }
  for (const file of files.filter(file => /\.(?:js|cjs|mjs)$/i.test(file))) {
    let source; try { source = fs.readFileSync(file, 'utf8'); } catch (error) { scannerErrors.push({ path: file, error: error.message }); continue; }
    if (/\bexecuteLegacy\b/.test(source)) findings.push({ file: path.relative(installedRoot, file).split(path.sep).join('/'), reasonCode: 'INSTALLED_LEGACY_RUNTIME_EXECUTOR_PRESENT' });
    if (/desktop:lifecycle/.test(source)) findings.push({ file: path.relative(installedRoot, file).split(path.sep).join('/'), reasonCode: 'INSTALLED_LEGACY_LIFECYCLE_CHANNEL_PRESENT' });
  }
  return { schemaVersion: 1, status: scannerErrors.length || findings.length ? 'FAIL' : 'PASS', evidenceClass: options.evidenceClass || 'INSTALLED_RUNTIME_TREE', platform: process.platform, rootKind: path.basename(installedRoot), scanComplete: scannerErrors.length === 0, filesScanned: files.length, archivesExpanded: ['app.asar.unpacked-fixture'], symlinkPolicy: 'NO_SYMLINKS_IN_FIXTURE', caseInsensitiveComparison: true, hitCount: findings.length, findings, scannerErrors };
}
if (require.main === module) {
  const target = process.argv[2]; let fixture;
  try { const root = target || (fixture = buildInstalledFixture()).root; const report = scanInstalledTree(root, { evidenceClass: target ? 'SUPPLIED_INSTALLED_TREE' : 'DETERMINISTIC_INSTALLED_TREE_FIXTURE' }); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : 1; } finally { fixture?.cleanup(); }
}
module.exports = { buildInstalledFixture, scanInstalledTree };
