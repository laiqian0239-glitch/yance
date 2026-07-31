#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, 'governance', 'branding', 'yance-legacy-brand-whitelist.json');
const MAX_TEXT_FILE_BYTES = 64 * 1024 * 1024;
const SOURCE_FILESYSTEM_EXCLUDES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', 'release-output', '.tmp', '.cache']);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const outputPath = argumentValue('--output') ? path.resolve(argumentValue('--output')) : null;
const scanRootArg = argumentValue('--scan-root');
const scanRoot = scanRootArg ? path.resolve(scanRootArg) : ROOT;
const scope = String(argumentValue('--scope') || (scanRootArg ? 'PACKAGED' : 'SOURCE')).trim().toUpperCase();
const policyPath = argumentValue('--policy') ? path.resolve(argumentValue('--policy')) : DEFAULT_POLICY_PATH;

if (!['SOURCE', 'PACKAGED', 'INSTALLED'].includes(scope)) {
  throw new Error(`Unsupported brand audit scope: ${scope}`);
}
if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
  throw new Error(`Brand audit root is not a directory: ${scanRoot}`);
}

const tokenRegex = /(?:言策[\s_-]*29(?!\.\d)|Yance[\s_-]*29(?!\.\d)|\bY[\s_-]*29(?!\.\d)\b)/gi;

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function policyRelativePath(relativePath) {
  let normalized = normalizeRelative(relativePath);
  if (normalized.startsWith('resources/app/')) normalized = normalized.slice('resources/app/'.length);
  if (normalized.startsWith('application-payload/')) normalized = normalized.slice('application-payload/'.length);
  if (normalized.startsWith('electron_runtime/')) normalized = `electron/${normalized.slice('electron_runtime/'.length)}`;
  return normalized;
}

function trackedAndUntrackedFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  return [...new Set(result.stdout.toString('utf8').split('\0').filter(Boolean))].sort();
}

function filesystemFiles(root, options = {}) {
  const results = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (options.excludeDirectoryNames?.has(entry.name) && entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        results.push({ relativePath: normalizeRelative(path.relative(root, full)), fullPath: full, symbolicLink: true });
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) results.push({ relativePath: normalizeRelative(path.relative(root, full)), fullPath: full, symbolicLink: false });
    }
  };
  walk(root);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function scanFiles() {
  if (scope === 'SOURCE' && scanRoot === ROOT) {
    const gitFiles = trackedAndUntrackedFiles();
    if (gitFiles) return gitFiles.map(relativePath => ({
      relativePath: normalizeRelative(relativePath),
      fullPath: path.join(ROOT, relativePath),
      symbolicLink: false
    }));
    return filesystemFiles(ROOT, { excludeDirectoryNames: SOURCE_FILESYSTEM_EXCLUDES });
  }
  return filesystemFiles(scanRoot);
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function lineText(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const endRaw = text.indexOf('\n', index);
  const end = endRaw === -1 ? text.length : endRaw;
  return text.slice(start, end).trim().slice(0, 500);
}

function allowanceFor(policy, file, value) {
  const policyPathValue = policyRelativePath(file);
  for (const entry of policy.exactAllowances || []) {
    const pathMatches = entry.path ? policyPathValue === entry.path : policyPathValue.startsWith(entry.pathPrefix || '\0');
    if (!pathMatches) continue;
    if (new RegExp(entry.match, 'i').test(value)) return entry;
  }
  if (scope === 'SOURCE') {
    for (const entry of policy.historicalRoots || []) {
      if (policyPathValue.startsWith(entry.pathPrefix)) {
        return { ...entry, userVisible: false, sunsetAfterBrandingEpoch: null, coveredBy: 'historical path classification' };
      }
    }
  }
  return null;
}

function createFinding(policy, file, token, detail = {}) {
  const allowance = allowanceFor(policy, file, token);
  return {
    path: file,
    policyPath: policyRelativePath(file),
    line: detail.line ?? null,
    token,
    findingKind: detail.findingKind || 'CONTENT',
    excerpt: detail.excerpt || '',
    status: allowance ? 'CLASSIFIED' : 'UNEXPLAINED',
    category: allowance?.category || 'UNEXPLAINED_ACTIVE_LEGACY_BRAND',
    reason: allowance?.reason || 'No exact migration, regression, or historical classification exists.',
    userVisible: allowance?.userVisible ?? null,
    sunsetAfterBrandingEpoch: allowance?.sunsetAfterBrandingEpoch ?? null,
    coveredBy: allowance?.coveredBy || null
  };
}

function main() {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const selfFiles = new Set([...(policy.selfFiles || []), 'scripts/branding/audit-yance-brand.js']);
  const files = scanFiles();
  const findings = [];
  const binaryFilesSkipped = [];
  const oversizedFilesSkipped = [];
  const symbolicLinks = [];

  for (const item of files) {
    const file = item.relativePath;
    if (scope === 'SOURCE' && selfFiles.has(file)) continue;

    tokenRegex.lastIndex = 0;
    for (let match = tokenRegex.exec(file); match; match = tokenRegex.exec(file)) {
      findings.push(createFinding(policy, file, match[0], {
        findingKind: 'PATH',
        excerpt: file
      }));
    }

    if (item.symbolicLink) {
      symbolicLinks.push(file);
      continue;
    }

    let stat;
    try { stat = fs.statSync(item.fullPath); } catch (_) { continue; }
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      oversizedFilesSkipped.push({ path: file, bytes: stat.size });
      continue;
    }

    let buffer;
    try { buffer = fs.readFileSync(item.fullPath); } catch (_) { continue; }
    if (isBinary(buffer)) {
      binaryFilesSkipped.push(file);
      continue;
    }
    const text = buffer.toString('utf8');
    tokenRegex.lastIndex = 0;
    for (let match = tokenRegex.exec(text); match; match = tokenRegex.exec(text)) {
      findings.push(createFinding(policy, file, match[0], {
        line: lineNumber(text, match.index),
        findingKind: 'CONTENT',
        excerpt: lineText(text, match.index)
      }));
    }
  }

  const unexplained = findings.filter(item => item.status === 'UNEXPLAINED');
  const visibleAllowances = findings.filter(item => item.userVisible === true);
  const packagedHistoricalAllowances = scope === 'SOURCE'
    ? []
    : findings.filter(item => String(item.category).startsWith('HISTORICAL_'));
  const report = {
    schemaVersion: 2,
    documentType: 'YANCE_LEGACY_BRAND_AUDIT',
    scope,
    brandingVersion: policy.brandingVersion,
    generatedAtUtc: new Date().toISOString(),
    scanRoot,
    policyPath: path.relative(ROOT, policyPath).split(path.sep).join('/'),
    scannedFileCount: files.length - (scope === 'SOURCE' ? selfFiles.size : 0),
    binaryFilesSkippedCount: binaryFilesSkipped.length,
    oversizedFilesSkippedCount: oversizedFilesSkipped.length,
    symbolicLinkCount: symbolicLinks.length,
    findingCount: findings.length,
    pathFindingCount: findings.filter(item => item.findingKind === 'PATH').length,
    contentFindingCount: findings.filter(item => item.findingKind === 'CONTENT').length,
    classifiedCount: findings.length - unexplained.length,
    unexplainedCount: unexplained.length,
    visibleAllowanceCount: visibleAllowances.length,
    packagedHistoricalAllowanceCount: packagedHistoricalAllowances.length,
    status: unexplained.length === 0 && visibleAllowances.length === 0 && packagedHistoricalAllowances.length === 0 ? 'PASS' : 'FAIL',
    findings,
    binaryFilesSkipped,
    oversizedFilesSkipped,
    symbolicLinks
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.status === 'PASS' ? 0 : 1);
}

main();
