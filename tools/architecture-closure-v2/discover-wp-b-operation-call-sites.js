#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASELINE_PATH = 'governance/architecture-closure-v2/wp-b-baseline.json';
const INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const DETECTORS = Object.freeze([
  Object.freeze({ id: 'CHILD_PROCESS_EXTERNAL_EXECUTION', expression: /\b(?:fork|spawn|execFile)\s*\(/u }),
  Object.freeze({ id: 'NETWORK_CLIENT_CALL', expression: /\b(?:fetch\s*\(|https?\.(?:get|request)\s*\(|axios\.[a-z]+\s*\()/u }),
  Object.freeze({ id: 'PLATFORM_OR_PROVIDER_CALL', expression: /\b(?:sendMessage|sendMedia|invokeProvider|executeModel|restoreSession|fetchHistory|downloadMedia|uploadMedia|callProvider|createChatCompletion)\s*\(/u }),
  Object.freeze({ id: 'RECOVERY_ENTRYPOINT', expression: /\b(?:recover|resume|restore|reconcile|repair)[A-Za-z0-9_]*\s*\(/u })
]);
const TIMER_PATTERN = /\b(?:setTimeout|setInterval)\s*\(/u;
const OPERATIONAL_TIMER_CONTEXT = /\b(?:retry[A-Za-z0-9_]*|backoff[A-Za-z0-9_]*|heartbeat[A-Za-z0-9_]*|lease[A-Za-z0-9_]*|queue[A-Za-z0-9_]*|sync[A-Za-z0-9_]*|execution[A-Za-z0-9_]*|session[A-Za-z0-9_]*|message[A-Za-z0-9_]*|media[A-Za-z0-9_]*|provider[A-Za-z0-9_]*|platform[A-Za-z0-9_]*|reconnect[A-Za-z0-9_]*|recovery[A-Za-z0-9_]*)\b/iu;
const WP_B_PATH_SCOPE = /(?:model|provider|ollama|openai|aigateway|execution|asyncoperation|backgroundjob|jobqueue|sendqueue|message|communication|channel|adapter|platform|facebook|telegram|whatsapp|media|history|sync|session|ownerrecovery|runtimerecovery|durablechanneloperation|accountmanager|gateway|relay|backendprocesshost|backendstartupsupervisor)/iu;

function normalizePath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//u, '');
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function isExcluded(relativePath, excludes) {
  const normalized = normalizePath(relativePath);
  return excludes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function walkSourceFiles(root, relativeRoot, excludes) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const output = [];
  const pending = [absoluteRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = normalizePath(path.relative(root, absolute));
      if (isExcluded(relative, excludes)) continue;
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) output.push(relative);
    }
  }
  return output.sort();
}

function stripComments(source) {
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

function detectCapabilities(source) {
  const text = stripComments(source);
  const capabilities = [];
  for (const detector of DETECTORS) {
    if (detector.expression.test(text)) capabilities.push(detector.id);
  }
  if (TIMER_PATTERN.test(text) && OPERATIONAL_TIMER_CONTEXT.test(text)) {
    capabilities.push('OPERATIONAL_RETRY_OR_TIMER');
  }
  return [...new Set(capabilities)];
}

function discoveryClass(relativePath) {
  const normalized = normalizePath(relativePath);
  if (normalized.startsWith('tools/')) return 'NON_PRODUCTION_HARNESS';
  if (WP_B_PATH_SCOPE.test(normalized)) return 'WP_B_PRODUCTION_SCOPE';
  return 'OUTSIDE_WP_B_OPERATION_SCOPE';
}

function discoverCallSites(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  const baseline = readJson(repositoryRoot, BASELINE_PATH);
  const inventory = readJson(repositoryRoot, INVENTORY_PATH);
  const config = baseline.sourceDiscovery || {};
  const roots = Array.isArray(config.roots) ? config.roots.map(normalizePath) : [];
  const excludes = Array.isArray(config.excludes) ? config.excludes.map(normalizePath) : [];
  const registeredPaths = new Set((inventory.entries || []).map(entry => normalizePath(entry.path)));
  const allDetected = [];
  const missingInventoryPaths = [];
  let scannedFileCount = 0;

  for (const entry of inventory.entries || []) {
    const relativePath = normalizePath(entry.path);
    if (!fs.existsSync(path.join(repositoryRoot, relativePath))) missingInventoryPaths.push(relativePath);
  }

  for (const root of roots) {
    const files = walkSourceFiles(repositoryRoot, root, excludes);
    scannedFileCount += files.length;
    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
      const capabilities = detectCapabilities(source);
      if (!capabilities.length) continue;
      allDetected.push(Object.freeze({
        path: relativePath,
        capabilities,
        discoveryClass: discoveryClass(relativePath)
      }));
    }
  }

  const discovered = allDetected.filter(row => row.discoveryClass === 'WP_B_PRODUCTION_SCOPE');
  const harnessDetected = allDetected.filter(row => row.discoveryClass === 'NON_PRODUCTION_HARNESS');
  const outsideScopeDetected = allDetected.filter(row => row.discoveryClass === 'OUTSIDE_WP_B_OPERATION_SCOPE');
  const unregistered = discovered.filter(row => !registeredPaths.has(row.path));
  const registered = discovered.filter(row => registeredPaths.has(row.path));
  return Object.freeze({
    schemaVersion: 2,
    documentType: 'YANCE_ACV2_WP_B_OPERATION_CALL_SITE_DISCOVERY',
    workPackage: 'WP-B',
    branch: baseline.authorizedBranch,
    roots,
    excludes,
    scannedFileCount,
    allDetectedCount: allDetected.length,
    discoveredCount: discovered.length,
    harnessDetectedCount: harnessDetected.length,
    outsideScopeDetectedCount: outsideScopeDetected.length,
    registeredCount: registered.length,
    unregisteredCount: unregistered.length,
    missingInventoryPathCount: missingInventoryPaths.length,
    discovered,
    registered,
    unregistered,
    harnessDetected,
    outsideScopeDetected,
    missingInventoryPaths,
    ok: unregistered.length === 0 && missingInventoryPaths.length === 0
  });
}

if (require.main === module) {
  try {
    const report = discoverCallSites();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_OPERATION_CALL_SITE_DISCOVERY_FAILURE',
      ok: false,
      code: error.code || 'WP_B_OPERATION_DISCOVERY_FAILED',
      message: error.message
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BASELINE_PATH,
  DETECTORS,
  INVENTORY_PATH,
  WP_B_PATH_SCOPE,
  detectCapabilities,
  discoverCallSites,
  discoveryClass,
  normalizePath,
  stripComments,
  walkSourceFiles
};
