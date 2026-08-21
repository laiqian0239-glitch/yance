'use strict';

// Static dependency gate for source files that are copied into resources/app.
// The packaging pipeline intentionally excludes tools/, tests/, evidence/ and
// governance/. Any production runtime dependency on those roots would pass a
// byte-for-byte source projection yet crash after installation.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RUNTIME_ROOTS = Object.freeze([
  'backend',
  'shared',
  'electron',
  'diagnostics',
  'release',
  'vendor/sillytavern/1.18.0'
]);
const RUNTIME_FILES = Object.freeze(['installer/installedIdentityReceipt.js', 'frontend/theme-catalog.json']);
const FORBIDDEN_TOP_LEVEL_ROOTS = Object.freeze(['tools', 'tests', 'evidence', 'implementation', 'governance']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const RESOLUTION_EXTENSIONS = Object.freeze(['', '.js', '.cjs', '.mjs', '.json', '.node']);

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function normalize(relativePath) {
  return String(relativePath || '').split(path.sep).join('/').normalize('NFC');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isPackagedRuntimePath(relativePath) {
  const normalized = normalize(relativePath);
  if (RUNTIME_FILES.includes(normalized)) return true;
  return RUNTIME_ROOTS.some(root => normalized === root || normalized.startsWith(`${root}/`))
    && !normalized.startsWith('backend/tests/');
}

function walkRuntimeSources(repoRoot) {
  const output = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = normalize(path.relative(repoRoot, fullPath));
      if (entry.isSymbolicLink()) fail('WP7_PRODUCTION_RUNTIME_DEPENDENCY_CLOSURE_INVALID', 'symbolic links are forbidden in production runtime source', { relativePath });
      if (entry.isDirectory()) {
        if (relativePath === 'backend/tests' || relativePath.startsWith('backend/tests/')) continue;
        visit(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push({ fullPath, relativePath });
      }
    }
  }
  for (const root of RUNTIME_ROOTS) visit(path.join(repoRoot, root));
  for (const file of RUNTIME_FILES) {
    const fullPath = path.join(repoRoot, ...file.split('/'));
    if (fs.existsSync(fullPath) && SOURCE_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) output.push({ fullPath, relativePath: file });
  }
  return output.sort((a, b) => Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath)));
}

function staticModuleSpecifiers(source) {
  const found = [];
  const patterns = [
    { kind: 'require', regex: /\brequire(?:\.resolve)?\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g },
    { kind: 'dynamic-import', regex: /\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g },
    { kind: 'import-export', regex: /\b(?:import|export)\s+(?:[^'"\r\n]*?\s+from\s+)?(['"])([^'"\r\n]+)\1/g }
  ];
  for (const { kind, regex } of patterns) {
    let match;
    while ((match = regex.exec(source)) !== null) {
      found.push({ kind, specifier: match[2], index: match.index });
    }
  }
  return found.sort((a, b) => a.index - b.index || a.specifier.localeCompare(b.specifier));
}

function resolveFileOrDirectory(basePath) {
  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {}
  }
  try {
    if (!fs.statSync(basePath).isDirectory()) return null;
  } catch {
    return null;
  }
  const packageJsonPath = path.join(basePath, 'package.json');
  try {
    const packageDocument = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (typeof packageDocument.main === 'string' && packageDocument.main.trim()) {
      const resolvedMain = resolveFileOrDirectory(path.resolve(basePath, packageDocument.main));
      if (resolvedMain) return resolvedMain;
    }
  } catch {}
  for (const extension of RESOLUTION_EXTENSIONS.slice(1)) {
    const candidate = path.join(basePath, `index${extension}`);
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {}
  }
  return null;
}

function dependencyTreeSha256(records) {
  const body = records.map(record => `${record.sourcePath}\0${record.kind}\0${record.specifier}\0${record.targetPath}\n`).join('');
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function validateProductionRuntimeSourceDependencies(options = {}) {
  const repoRoot = fs.realpathSync(path.resolve(options.repoRoot || path.resolve(__dirname, '..', '..')));
  const sources = walkRuntimeSources(repoRoot);
  const records = [];
  const violations = [];
  for (const source of sources) {
    const content = fs.readFileSync(source.fullPath, 'utf8');
    for (const dependency of staticModuleSpecifiers(content)) {
      if (!dependency.specifier.startsWith('.')) continue;
      const unresolvedPath = path.resolve(path.dirname(source.fullPath), dependency.specifier);
      if (!isInside(repoRoot, unresolvedPath)) {
        violations.push({
          reasonCode: 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_OUTSIDE_REPOSITORY',
          sourcePath: source.relativePath,
          kind: dependency.kind,
          specifier: dependency.specifier,
          targetPath: normalize(path.relative(repoRoot, unresolvedPath))
        });
        continue;
      }
      const target = resolveFileOrDirectory(unresolvedPath);
      if (!target) {
        violations.push({
          reasonCode: 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_MISSING',
          sourcePath: source.relativePath,
          kind: dependency.kind,
          specifier: dependency.specifier,
          targetPath: normalize(path.relative(repoRoot, unresolvedPath))
        });
        continue;
      }
      const targetPath = normalize(path.relative(repoRoot, target));
      const top = targetPath.split('/')[0];
      if (FORBIDDEN_TOP_LEVEL_ROOTS.includes(top) || !isPackagedRuntimePath(targetPath)) {
        violations.push({
          reasonCode: 'WP7_PRODUCTION_RUNTIME_DEPENDENCY_OUTSIDE_PAYLOAD',
          sourcePath: source.relativePath,
          kind: dependency.kind,
          specifier: dependency.specifier,
          targetPath
        });
        continue;
      }
      records.push({ sourcePath: source.relativePath, kind: dependency.kind, specifier: dependency.specifier, targetPath });
    }
  }
  if (violations.length) {
    fail('WP7_PRODUCTION_RUNTIME_DEPENDENCY_CLOSURE_INVALID', 'production runtime source has missing or unpackaged relative dependencies', {
      scannedFileCount: sources.length,
      violationCount: violations.length,
      violations
    });
  }
  records.sort((a, b) => Buffer.from(`${a.sourcePath}\0${a.specifier}`).compare(Buffer.from(`${b.sourcePath}\0${b.specifier}`)));
  return Object.freeze({
    status: 'PASS',
    scannedFileCount: sources.length,
    dependencyCount: records.length,
    dependencyTreeSha256: dependencyTreeSha256(records),
    records
  });
}

module.exports = {
  RUNTIME_ROOTS,
  RUNTIME_FILES,
  FORBIDDEN_TOP_LEVEL_ROOTS,
  staticModuleSpecifiers,
  validateProductionRuntimeSourceDependencies
};
