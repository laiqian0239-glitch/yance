#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASELINE_PATH = 'governance/architecture-closure-v2/wp-b-baseline.json';
const INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const DETECTORS = Object.freeze([
  Object.freeze({ id: 'CHILD_PROCESS_EXTERNAL_EXECUTION', expression: /\b(?:fork|spawn|execFile)\s*\(/u }),
  Object.freeze({
    id: 'NETWORK_CLIENT_CALL',
    expression: /(?:\b(?:fetch|request)\s*\(|\bhttps?\s*(?:\.|\?\.)\s*(?:get|request)\s*\(|\baxios\s*(?:\.|\?\.)\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\()/u
  }),
  Object.freeze({
    id: 'PLATFORM_OR_PROVIDER_CALL',
    expression: /(?:(?:\.|\?\.)\s*|\b)(?:sendMessage|sendMedia|invokeProvider|executeModel|restoreSession|fetchHistory|downloadMedia|uploadMedia|callProvider|createChatCompletion)\s*\(/u
  }),
  Object.freeze({
    id: 'RECOVERY_ENTRYPOINT',
    expression: /(?:(?:\.|\?\.)\s*|\b)(?:recover|resume|restore|reconcile|repair)[A-Za-z0-9_$]*\s*\(/u
  })
]);
const TIMER_PATTERN = /\b(?:setTimeout|setInterval)\s*\(/u;
const OPERATIONAL_TIMER_CONTEXT = /\b(?:retry[A-Za-z0-9_$]*|[A-Za-z0-9_$]*Retry|backoff[A-Za-z0-9_$]*|[A-Za-z0-9_$]*Backoff|heartbeat[A-Za-z0-9_$]*|lease[A-Za-z0-9_$]*|queue[A-Za-z0-9_$]*|sync[A-Za-z0-9_$]*|execution[A-Za-z0-9_$]*|session[A-Za-z0-9_$]*|message[A-Za-z0-9_$]*|media[A-Za-z0-9_$]*|provider[A-Za-z0-9_$]*|platform[A-Za-z0-9_$]*|reconnect[A-Za-z0-9_$]*|recovery[A-Za-z0-9_$]*)\b/iu;
const OPERATIONAL_RETRY_CALL = /(?:(?:\.|\?\.)\s*|\b)(?:retry[A-Za-z0-9_$]*|[A-Za-z0-9_$]*Retry|backoff[A-Za-z0-9_$]*|[A-Za-z0-9_$]*Backoff)\s*\(/u;
const STRONG_CAPABILITIES = new Set([
  'CHILD_PROCESS_EXTERNAL_EXECUTION',
  'NETWORK_CLIENT_CALL',
  'PLATFORM_OR_PROVIDER_CALL',
  'RECOVERY_ENTRYPOINT',
  'OPERATIONAL_RETRY_OR_TIMER'
]);
const WP_B_IO_PATH_SCOPE = /(?:modelExecution|modelExecutor|provider|ollama|openAi|aiGateway|transcription|facebook|telegram|whatsapp|communication|channelAdapter|platformMessaging|platformAdapter|platformDriver|mediaPipeline|BackendProcessHost)/iu;
const WP_B_STATEFUL_PATH_SCOPE = /(?:executionDeadline|asyncOperation|backgroundJob|jobQueue|sendQueue|messageRepository|syncCheckpoint|durableChannelOperation|runtimeRecovery|ownerRecovery|accountManager|mediaPipeline|whatsappAccountReconciliation|whatsappHistoryMediaRecovery|routes\/models|facebook-gateway\/gateway)/iu;

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

function blankCharacter(output, source, index) {
  if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
}

function stripComments(source) {
  const text = String(source || '');
  const output = [...text];
  const templateStack = [];
  let mode = 'code';
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];

    if (mode === 'line-comment') {
      blankCharacter(output, text, index);
      if (character === '\n' || character === '\r') mode = 'code';
      index += 1;
      continue;
    }
    if (mode === 'block-comment') {
      blankCharacter(output, text, index);
      if (character === '*' && next === '/') {
        blankCharacter(output, text, index + 1);
        index += 2;
        mode = 'code';
      } else {
        index += 1;
      }
      continue;
    }
    if (mode === 'single-quote' || mode === 'double-quote') {
      blankCharacter(output, text, index);
      if (character === '\\') {
        if (index + 1 < text.length) blankCharacter(output, text, index + 1);
        index += 2;
        continue;
      }
      if ((mode === 'single-quote' && character === "'") || (mode === 'double-quote' && character === '"')) {
        mode = 'code';
      }
      index += 1;
      continue;
    }

    const template = templateStack[templateStack.length - 1];
    if (template && !template.inExpression) {
      blankCharacter(output, text, index);
      if (character === '\\') {
        if (index + 1 < text.length) blankCharacter(output, text, index + 1);
        index += 2;
        continue;
      }
      if (character === '`') {
        templateStack.pop();
        index += 1;
        continue;
      }
      if (character === '$' && next === '{') {
        blankCharacter(output, text, index + 1);
        template.inExpression = true;
        template.braceDepth = 1;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (character === '/' && next === '/') {
      blankCharacter(output, text, index);
      blankCharacter(output, text, index + 1);
      mode = 'line-comment';
      index += 2;
      continue;
    }
    if (character === '/' && next === '*') {
      blankCharacter(output, text, index);
      blankCharacter(output, text, index + 1);
      mode = 'block-comment';
      index += 2;
      continue;
    }
    if (character === "'") {
      blankCharacter(output, text, index);
      mode = 'single-quote';
      index += 1;
      continue;
    }
    if (character === '"') {
      blankCharacter(output, text, index);
      mode = 'double-quote';
      index += 1;
      continue;
    }
    if (character === '`') {
      blankCharacter(output, text, index);
      templateStack.push({ inExpression: false, braceDepth: 0 });
      index += 1;
      continue;
    }
    if (template && template.inExpression) {
      if (character === '{') template.braceDepth += 1;
      else if (character === '}') {
        template.braceDepth -= 1;
        if (template.braceDepth === 0) {
          blankCharacter(output, text, index);
          template.inExpression = false;
        }
      }
    }
    index += 1;
  }
  return output.join('');
}

function findClosingParenthesis(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function maskCallLikeDeclarations(source) {
  const text = String(source || '');
  const output = [...text];
  const expression = /\b[A-Za-z_$][A-Za-z0-9_$]*\s*\(/gu;
  for (const match of text.matchAll(expression)) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    const closeIndex = findClosingParenthesis(text, openIndex);
    if (closeIndex < 0) continue;
    let nextIndex = closeIndex + 1;
    while (/\s/u.test(text[nextIndex] || '')) nextIndex += 1;
    if (text[nextIndex] !== '{') continue;
    const nameEnd = match.index + match[0].search(/\s*\(/u);
    for (let index = match.index; index < nameEnd; index += 1) {
      blankCharacter(output, text, index);
    }
  }
  return output.join('');
}

function executableSource(source) {
  return maskCallLikeDeclarations(stripComments(source));
}

function detectCapabilities(source) {
  const text = executableSource(source);
  const capabilities = [];
  for (const detector of DETECTORS) {
    if (detector.expression.test(text)) capabilities.push(detector.id);
  }
  if (OPERATIONAL_RETRY_CALL.test(text) || (TIMER_PATTERN.test(text) && OPERATIONAL_TIMER_CONTEXT.test(text))) {
    capabilities.push('OPERATIONAL_RETRY_OR_TIMER');
  }
  return [...new Set(capabilities)];
}

function discoveryClass(relativePath, capabilities, registeredPaths = new Set()) {
  const normalized = normalizePath(relativePath);
  if (normalized.startsWith('tools/')) return 'NON_PRODUCTION_HARNESS';
  if (registeredPaths.has(normalized) && capabilities.length !== 0) return 'WP_B_PRODUCTION_SCOPE';
  const hasStrongCapability = capabilities.some(capability => STRONG_CAPABILITIES.has(capability));
  if (hasStrongCapability && WP_B_IO_PATH_SCOPE.test(normalized)) return 'WP_B_PRODUCTION_SCOPE';
  if (!hasStrongCapability && WP_B_STATEFUL_PATH_SCOPE.test(normalized)) return 'WP_B_PRODUCTION_SCOPE';
  if (hasStrongCapability && WP_B_STATEFUL_PATH_SCOPE.test(normalized)) return 'WP_B_PRODUCTION_SCOPE';
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
        discoveryClass: discoveryClass(relativePath, capabilities, registeredPaths)
      }));
    }
  }

  const discovered = allDetected.filter(row => row.discoveryClass === 'WP_B_PRODUCTION_SCOPE');
  const harnessDetected = allDetected.filter(row => row.discoveryClass === 'NON_PRODUCTION_HARNESS');
  const outsideScopeDetected = allDetected.filter(row => row.discoveryClass === 'OUTSIDE_WP_B_OPERATION_SCOPE');
  const unregistered = discovered.filter(row => !registeredPaths.has(row.path));
  const registered = discovered.filter(row => registeredPaths.has(row.path));
  return Object.freeze({
    schemaVersion: 4,
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
  OPERATIONAL_RETRY_CALL,
  STRONG_CAPABILITIES,
  WP_B_IO_PATH_SCOPE,
  WP_B_STATEFUL_PATH_SCOPE,
  detectCapabilities,
  discoverCallSites,
  discoveryClass,
  executableSource,
  maskCallLikeDeclarations,
  normalizePath,
  stripComments,
  walkSourceFiles
};
