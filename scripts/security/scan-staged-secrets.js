#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROVIDER_PATTERNS = Object.freeze([
  { type: 'AWS_ACCESS_KEY', regex: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g },
  { type: 'GITHUB_TOKEN', regex: /(?<![A-Za-z0-9_])(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})(?![A-Za-z0-9_])/g },
  { type: 'OPENAI_KEY', regex: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g },
  { type: 'SLACK_TOKEN', regex: /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/g },
  { type: 'PRIVATE_KEY', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
]);

const ASSIGNMENT_PATTERN = /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*(['"`])([^'"`\r\n]{8,})\2/gi;
const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.yml', '.yaml', '.md', '.txt', '.ini', '.toml', '.ps1', '.cmd', '.bat', '.sh', '.html', '.css', '.xml', '.properties', '.conf']);

function normalizePath(filePath) {
  return String(filePath || '').replaceAll('\\', '/');
}

function isTestPath(filePath) {
  const normalized = `/${normalizePath(filePath).toLowerCase()}`;
  return normalized.includes('/tests/') || normalized.includes('/test/') || normalized.includes('/fixtures/') || /\.test\.[cm]?[jt]sx?$/.test(normalized);
}

function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isObviousSynthetic(value) {
  const lower = String(value || '').toLowerCase();
  return /(^|[-_])(test|fixture|example|fake|dummy|mock|synthetic|never|normalized|legacy|fallback|recovered|direct|profile|flow)([-_]|$)/.test(lower)
    || lower.includes('not-persisted')
    || lower.includes('not-exported')
    || lower.includes('must-never')
    || /^[A-Z0-9_]+$/.test(value);
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) if (text.charCodeAt(offset) === 10) line += 1;
  return line;
}

function redact(value, type) {
  return `<REDACTED:${type}:${String(value).length}>`;
}

function scanText(filePath, text) {
  const critical = [];
  const advisory = [];
  const providerRanges = [];

  for (const pattern of PROVIDER_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      providerRanges.push([match.index, match.index + match[0].length]);
      critical.push({
        severity: 'critical',
        type: pattern.type,
        path: normalizePath(filePath),
        lineNumber: lineNumberAt(text, match.index),
        value: redact(match[0], pattern.type),
      });
    }
  }

  ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
    const valueStart = match.index + match[0].lastIndexOf(match[3]);
    const valueEnd = valueStart + match[3].length;
    if (providerRanges.some(([start, end]) => valueStart < end && valueEnd > start)) continue;

    const candidate = {
      type: 'SECRET_ASSIGNMENT',
      path: normalizePath(filePath),
      lineNumber: lineNumberAt(text, match.index),
      key: match[1],
      value: redact(match[3], 'ASSIGNMENT'),
      entropy: Number(shannonEntropy(match[3]).toFixed(2)),
    };

    const syntheticTestValue = isTestPath(filePath) && isObviousSynthetic(match[3]);
    const highEntropyTestValue = isTestPath(filePath) && match[3].length >= 24 && shannonEntropy(match[3]) >= 4.0 && !syntheticTestValue;

    if (!isTestPath(filePath) || highEntropyTestValue) critical.push({ severity: 'critical', ...candidate });
    else advisory.push({ severity: 'advisory', ...candidate, reason: syntheticTestValue ? 'synthetic-test-fixture' : 'test-fixture-review' });
  }

  return { critical, advisory };
}

function stagedFiles(repoRoot) {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: repoRoot });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function scanFiles(repoRoot, files) {
  const result = { critical: [], advisory: [] };
  for (const relativePath of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const scanned = scanText(relativePath, fs.readFileSync(absolutePath, 'utf8'));
    result.critical.push(...scanned.critical);
    result.advisory.push(...scanned.advisory);
  }
  return result;
}

function main() {
  const repoRoot = process.cwd();
  const files = process.argv.includes('--all')
    ? fs.readdirSync(repoRoot, { recursive: true }).filter(file => typeof file === 'string')
    : stagedFiles(repoRoot);
  const report = scanFiles(repoRoot, files);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.critical.length > 0) {
    process.stderr.write(`SECRET_SCAN_FAILED critical=${report.critical.length} advisory=${report.advisory.length}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`SECRET_SCAN_PASS critical=0 advisory=${report.advisory.length}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  isObviousSynthetic,
  isTestPath,
  scanText,
  shannonEntropy,
};
