'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  scanRegisteredSources
} = require('../../../../tools/architecture-closure-v2/source-closure-scan');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const baselinePath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-source-closure-baseline.json'
);
const inventoryPath = path.join(
  repoRoot,
  'governance',
  'architecture-closure-v2',
  'wp-b-operation-inventory.json'
);
const PRODUCTION_ROOTS = Object.freeze([
  'backend',
  'electron',
  'services',
  'shared/release'
]);
const EXCLUDED_PREFIXES = Object.freeze([
  'backend/tests/',
  'services/facebook-gateway/tests/',
  'services/facebook-worker/tests/'
]);
const LEGACY_FACADES = Object.freeze([
  'backend/services/asyncOperationLifecycleAuthority.js',
  'backend/services/backgroundJobAuthority.js',
  'backend/services/jobQueue.js'
]);
const CORE_TO_FACADE = Object.freeze({
  'backend/services/asyncOperationLifecycleAuthorityCore.js': 'backend/services/asyncOperationLifecycleAuthority.js',
  'backend/services/backgroundJobAuthorityCore.js': 'backend/services/backgroundJobAuthority.js',
  'backend/services/jobQueueCore.js': 'backend/services/jobQueue.js'
});
const FORBIDDEN_LEGACY_EXPORTS = Object.freeze([
  'authority',
  'AsyncOperationLifecycleAuthority',
  'BackgroundJobAuthority',
  'JobQueue',
  'create',
  'enqueue',
  'begin',
  'start',
  'progress',
  'settle',
  'succeed',
  'fail',
  'cancel',
  'retry'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function report() {
  return scanRegisteredSources({ wp: 'B' });
}

function normalize(relativePath) {
  return String(relativePath || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function walkJavaScript(relativeRoot) {
  const output = [];
  const pending = [path.join(repoRoot, relativeRoot)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = normalize(path.relative(repoRoot, absolute));
      if (EXCLUDED_PREFIXES.some(prefix => relative.startsWith(prefix))) continue;
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && /\.(?:c?js|mjs)$/u.test(entry.name)) output.push(relative);
    }
  }
  return output.sort();
}

function resolveLocalModule(importerPath, request) {
  if (!String(request || '').startsWith('.')) return '';
  const importerDirectory = path.dirname(path.join(repoRoot, importerPath));
  const candidate = path.resolve(importerDirectory, request);
  for (const absolute of [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]) {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return normalize(path.relative(repoRoot, absolute));
    }
  }
  return '';
}

function productionImportGraph() {
  const graph = new Map();
  const files = PRODUCTION_ROOTS.flatMap(walkJavaScript);
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const importer of files) {
    const source = fs.readFileSync(path.join(repoRoot, importer), 'utf8');
    for (const match of source.matchAll(requirePattern)) {
      const target = resolveLocalModule(importer, match[1]);
      if (!target) continue;
      if (!graph.has(target)) graph.set(target, new Set());
      graph.get(target).add(importer);
    }
  }
  return new Map(
    [...graph.entries()].map(([target, importers]) => [target, [...importers].sort()])
  );
}

function exactImporterReport(graph, targets) {
  return Object.fromEntries(targets.map(target => [target, graph.get(target) || []]));
}

test('M3-SC-DIAG-001 report declares the stable WP-B diagnostic schema', () => {
  const value = report();
  assert.equal(value.diagnosticsSchemaVersion, 1, 'M3-SC-DIAG-001');
  assert.equal(value.diagnosticRecordType, 'YANCE_ACV2_WP_B_SOURCE_CLOSURE_VIOLATION', 'M3-SC-DIAG-001');
});

test('M3-SC-DIAG-002 classified violation count is explicit and matches the record set', () => {
  const value = report();
  assert.equal(Number.isSafeInteger(value.classifiedViolationCount), true, 'M3-SC-DIAG-002:INTEGER_REQUIRED');
  assert.equal(value.classifiedViolationCount, value.violations.length, 'M3-SC-DIAG-002:COUNT_MISMATCH');
  assert.ok(value.classifiedViolationCount > 0, 'M3-SC-DIAG-002:CREDIBLE_RED_REQUIRED');
});

test('M3-SC-DIAG-003 every nonterminal inventory row has an exact classified violation', () => {
  const baseline = readJson(baselinePath);
  const inventory = readJson(inventoryPath);
  const value = report();
  const productionTerminal = new Set(baseline.productionTerminalStates);
  const nonProductionTerminal = new Set(baseline.nonProductionTerminalStates);
  const openRows = inventory.entries.filter(entry => {
    if (entry.classification === 'NON_PRODUCTION_HARNESS') {
      return !nonProductionTerminal.has(entry.closureState);
    }
    return !productionTerminal.has(entry.closureState);
  });
  assert.ok(openRows.length > 0, 'M3-SC-DIAG-003:OPEN_INVENTORY_REQUIRED');
  for (const entry of openRows) {
    const matches = value.violations.filter(violation => (
      violation.inventoryId === entry.id && violation.path === entry.path
    ));
    assert.equal(matches.length, 1, `M3-SC-DIAG-003:${entry.id}:${entry.path}`);
  }
});

test('M3-SC-DIAG-004 each violation contains exact path, capability, reason and callable facts', () => {
  const baseline = readJson(baselinePath);
  const value = report();
  assert.ok(value.violations.length > 0, 'M3-SC-DIAG-004:CREDIBLE_RED_REQUIRED');
  for (const [index, violation] of value.violations.entries()) {
    for (const field of baseline.requiredDiagnosticFields) {
      assert.equal(Object.hasOwn(violation, field), true, `M3-SC-DIAG-004:${index}:${field}`);
    }
    assert.match(violation.inventoryId, /^WPB-[A-Z0-9-]+$/u, `M3-SC-DIAG-004:${index}:inventoryId`);
    assert.equal(typeof violation.path, 'string', `M3-SC-DIAG-004:${index}:path`);
    assert.equal(violation.path.startsWith('/'), false, `M3-SC-DIAG-004:${index}:path`);
    assert.equal(violation.path.includes('*'), false, `M3-SC-DIAG-004:${index}:path`);
    assert.match(violation.capabilityClass, /^[A-Z][A-Z0-9_]+$/u, `M3-SC-DIAG-004:${index}:capabilityClass`);
    assert.match(violation.reasonCode, /^WP_B_SOURCE_CLOSURE_[A-Z0-9_]+$/u, `M3-SC-DIAG-004:${index}:reasonCode`);
    assert.equal(typeof violation.callable, 'boolean', `M3-SC-DIAG-004:${index}:callable`);
  }
});

test('M3-SC-DIAG-005 legacy lifecycle and job facades have zero production importers', () => {
  const graph = productionImportGraph();
  const actual = exactImporterReport(graph, LEGACY_FACADES);
  const expected = Object.fromEntries(LEGACY_FACADES.map(facade => [facade, []]));
  assert.deepEqual(actual, expected, `M3-SC-DIAG-005:${JSON.stringify(actual)}`);
});

test('M3-SC-DIAG-006 legacy Core modules are reachable only from their exact transitional facade', () => {
  const graph = productionImportGraph();
  const corePaths = Object.keys(CORE_TO_FACADE);
  const actual = exactImporterReport(graph, corePaths);
  const expected = Object.fromEntries(
    Object.entries(CORE_TO_FACADE).map(([corePath, facadePath]) => [corePath, [facadePath]])
  );
  assert.deepEqual(actual, expected, `M3-SC-DIAG-006:${JSON.stringify(actual)}`);
});

test('M3-SC-DIAG-007 transitional facades do not re-export legacy Core writer surfaces', () => {
  const violations = {};
  for (const facade of LEGACY_FACADES) {
    const source = fs.readFileSync(path.join(repoRoot, facade), 'utf8');
    delete require.cache[require.resolve(path.join(repoRoot, facade))];
    const exported = require(path.join(repoRoot, facade));
    violations[facade] = {
      spreadsCore: source.includes('...core'),
      forbiddenExports: FORBIDDEN_LEGACY_EXPORTS.filter(field => Object.hasOwn(exported, field))
    };
  }
  const expected = Object.fromEntries(
    LEGACY_FACADES.map(facade => [facade, { spreadsCore: false, forbiddenExports: [] }])
  );
  assert.deepEqual(violations, expected, `M3-SC-DIAG-007:${JSON.stringify(violations)}`);
});
