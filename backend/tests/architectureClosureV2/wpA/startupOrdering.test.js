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
  return text.indexOf('RUNTIME_COMPOSITION.commandSubmitter(');
}

test('server proves runtime authority readiness before any startup recovery or business mutation', () => {
  const text = source(serverPath);
  const authorityGate = text.indexOf('AppRuntimeFactory.assertAuthorityReady(');
  const firstMutation = firstMutationIndex(text);
  assert.ok(authorityGate >= 0, 'server must call AppRuntimeFactory.assertAuthorityReady');
  assert.ok(firstMutation >= 0, 'dedicated startup command boundary must remain observable');
  assert.ok(authorityGate < firstMutation, 'authority readiness must be proven before the first startup mutation');
});

test('startup recovery uses a dedicated versioned dispatcher and never replaces the core business command entrypoint', () => {
  const serverText = source(serverPath);
  const compositionText = source(compositionPath);
  const forbiddenDirectCalls = [
    /migrationService\.migrateAtStartup\s*\(/,
    /syncCheckpointService\.recoverInterrupted\s*\(/,
    /backgroundJobAuthority\.recoverInterrupted\s*\(/,
    /canonicalIdentityService\.canonicalizeWhatsAppAccounts\s*\(/,
    /cacheGcService\.purge\s*\(/,
    /runProductionDataGuard\s*\(/,
    /workspaceService\.initializeDataPipelines\s*\(/
  ];
  for (const pattern of forbiddenDirectCalls) assert.doesNotMatch(serverText, pattern);
  assert.match(serverText, /RUNTIME_COMPOSITION\.commandSubmitter\s*\(/);
  assert.doesNotMatch(serverText, /APP_RUNTIME\.executeBusinessCommand\s*\(/);
  assert.match(serverText, /contractVersion\s*:\s*2/);
  assert.match(serverText, /expectedStateVersion/);
  assert.doesNotMatch(compositionText, /runtime\.executeBusinessCommand\s*=/);
});

test('startup dispatcher is sealed before mutable production modules are loaded', () => {
  const text = source(serverPath);
  const seal = text.indexOf('RUNTIME_COMPOSITION.authorityCommandGateway.seal()');
  const mutableImports = [
    "require('./routes/messages')",
    "require('./routes/accounts')",
    "require('./services/sendQueueService')",
    "require('./services/runtimeRecoveryService')",
    "require('./services/aiReplyOutboxService')"
  ].map(marker => text.indexOf(marker)).filter(index => index >= 0);
  assert.ok(seal >= 0, 'startup dispatcher must be explicitly sealed');
  assert.ok(mutableImports.length > 0, 'mutable production import inventory must remain observable');
  assert.ok(mutableImports.every(index => seal < index), 'startup dispatcher must be sealed before mutable modules load');
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

test('readiness is fail-closed and revalidates the sealed write-host, ledger and identity graph', () => {
  const text = source(serverPath);
  const announceStart = text.indexOf('function announceReady()');
  const announceEnd = text.indexOf('\nconst app = express()', announceStart);
  assert.ok(announceStart >= 0 && announceEnd > announceStart, 'announceReady function must remain discoverable');
  const announceBody = text.slice(announceStart, announceEnd);
  assert.match(announceBody, /AppRuntimeFactory\.assertAuthorityReady\s*\(\s*\{\s*requireStartupGatewaySealed\s*:\s*true\s*\}\s*\)/);
  assert.match(announceBody, /canonicalLedgerReady/);
  assert.match(announceBody, /identityAuthorityReady/);
  assert.match(announceBody, /canonicalGraphBound/);
  assert.match(announceBody, /startupGatewaySealed/);
  assert.doesNotMatch(announceBody, /ready\s*:\s*true[\s\S]*catch\s*\([^)]*\)\s*\{\s*\}/);
});

test('recovery manager receives neither a raw write store nor an unused decorative startup gateway', () => {
  const text = source(compositionPath);
  const recoveryStart = text.indexOf('new RecoveryManager({');
  const recoveryEnd = text.indexOf('});', recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recoveryBody = text.slice(recoveryStart, recoveryEnd);
  assert.doesNotMatch(recoveryBody, /\b(?:db|store|repository)\s*[,}]/);
  assert.doesNotMatch(recoveryBody, /\b(?:authorityCommandGateway|commandSubmitter)\s*[,}]/);
});
