'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const serverPath = path.join(repoRoot, 'backend', 'server.js');
const compositionPath = path.join(repoRoot, 'backend', 'runtime', 'AppRuntimeComposition.js');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function firstMutationIndex(text) {
  const markers = [
    'migrationService.migrateAtStartup(',
    'syncCheckpointService.recoverInterrupted(',
    'backgroundJobAuthority.recoverInterrupted(',
    'canonicalIdentityService.canonicalizeWhatsAppAccounts(',
    'cacheGcService.purge(',
    'runProductionDataGuard(',
    'workspaceService.initializeDataPipelines('
  ];
  const indexes = markers.map(marker => text.indexOf(marker)).filter(index => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

test('server proves runtime authority readiness before any startup recovery or business mutation', () => {
  const text = source(serverPath);
  const authorityGate = text.indexOf('AppRuntimeFactory.assertAuthorityReady(');
  const firstMutation = firstMutationIndex(text);
  assert.ok(authorityGate >= 0, 'server must call AppRuntimeFactory.assertAuthorityReady');
  assert.ok(firstMutation >= 0, 'startup mutation inventory must remain observable');
  assert.ok(authorityGate < firstMutation, 'authority readiness must be proven before the first startup mutation');
});

test('startup recovery uses versioned runtime commands and contains no direct legacy writer calls', () => {
  const text = source(serverPath);
  const forbiddenDirectCalls = [
    /migrationService\.migrateAtStartup\s*\(/,
    /syncCheckpointService\.recoverInterrupted\s*\(/,
    /backgroundJobAuthority\.recoverInterrupted\s*\(/,
    /canonicalIdentityService\.canonicalizeWhatsAppAccounts\s*\(/,
    /cacheGcService\.purge\s*\(/,
    /runProductionDataGuard\s*\(/,
    /workspaceService\.initializeDataPipelines\s*\(/
  ];
  for (const pattern of forbiddenDirectCalls) assert.doesNotMatch(text, pattern);
  assert.match(text, /APP_RUNTIME\.(?:executeBusinessCommand|executeCommand)\s*\(/);
  assert.match(text, /contractVersion\s*:\s*2/);
  assert.match(text, /expectedStateVersion/);
});

test('production composition is enabled before mutable routes, queues and recovery services are loaded', () => {
  const text = source(serverPath);
  const configure = text.indexOf('APP_RUNTIME.configureProductionServices()');
  const mutableImports = [
    "require('./routes/messages')",
    "require('./routes/accounts')",
    "require('./services/sendQueueService')",
    "require('./services/runtimeRecoveryService')",
    "require('./services/aiReplyOutboxService')"
  ].map(marker => text.indexOf(marker)).filter(index => index >= 0);
  assert.ok(configure >= 0, 'production composition must be explicitly configured');
  assert.ok(mutableImports.length > 0, 'mutable production import inventory must remain observable');
  assert.ok(mutableImports.every(index => configure < index), 'authority composition must precede mutable production service loading');
});

test('readiness is fail-closed and revalidates write-host, ledger and identity authority state', () => {
  const text = source(serverPath);
  const announceStart = text.indexOf('function announceReady()');
  const announceEnd = text.indexOf('\nconst app = express()', announceStart);
  assert.ok(announceStart >= 0 && announceEnd > announceStart, 'announceReady function must remain discoverable');
  const announceBody = text.slice(announceStart, announceEnd);
  assert.match(announceBody, /AppRuntimeFactory\.assertAuthorityReady\s*\(/);
  assert.match(announceBody, /canonicalLedgerReady/);
  assert.match(announceBody, /identityAuthorityReady/);
  assert.doesNotMatch(announceBody, /ready\s*:\s*true[\s\S]*catch\s*\([^)]*\)\s*\{\s*\}/);
});

test('recovery manager is composed behind the canonical authority boundary rather than receiving a raw write store', () => {
  const text = source(compositionPath);
  const recoveryStart = text.indexOf('new RecoveryManager({');
  const recoveryEnd = text.indexOf('});', recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recoveryBody = text.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBody, /commandSubmitter|authorityCommandGateway/);
  assert.doesNotMatch(recoveryBody, /\b(?:db|store|repository)\s*[,}]/);
});
