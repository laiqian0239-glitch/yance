'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../../../migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyArchitectureClosureV2WpA
} = require('../../../migrations/architectureClosureV2WpA');
const {
  applyArchitectureClosureV2WpB
} = require('../../../migrations/architectureClosureV2WpB');
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
const internalAuthorityPath = path.join(
  repoRoot,
  'backend',
  'services',
  'durableInternalOperationAuthority.js'
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
const INTERNAL_OPERATION_KIND_CASES = Object.freeze([
  ['platform.auth.workflow', 'SESSION_RESTORE'],
  ['translation.message', 'AI_PROVIDER_EXECUTION'],
  ['openrouter.onboarding.adaptive-independent-smoke', 'AI_PROVIDER_EXECUTION'],
  ['ai.reply.candidates', 'AI_PROVIDER_EXECUTION'],
  ['avatar.contact.refresh', 'MEDIA_TRANSFER'],
  ['media.transcription', 'MEDIA_TRANSFER'],
  ['history.conversation.sync', 'HISTORY_SYNCHRONIZATION'],
  ['projection.domain.events', 'HISTORY_SYNCHRONIZATION'],
  ['outbound.message.send', 'OUTBOUND_MESSAGE_SEND'],
  ['delivery.receipt.reconcile', 'DELIVERY_RECEIPT_RECONCILIATION']
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCombinedInventory() {
  const baseline = readJson(baselinePath);
  const base = readJson(inventoryPath);
  const entries = [...(base.entries || [])];
  for (const relativePath of baseline.operationInventoryExtensionPaths || []) {
    const extension = readJson(path.join(repoRoot, relativePath));
    entries.push(...(extension.entries || []));
  }
  return { ...base, entries };
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
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const importer of PRODUCTION_ROOTS.flatMap(walkJavaScript)) {
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

function withSchema23(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-internal-operation-'));
  const db = new DatabaseSync(path.join(root, 'authority.db'));
  let transactionDepth = 0;
  const store = Object.freeze({
    db,
    transaction(callback) {
      if (transactionDepth > 0) return callback();
      db.exec('BEGIN IMMEDIATE');
      transactionDepth += 1;
      try {
        const value = callback();
        if (value && typeof value.then === 'function') {
          throw Object.assign(new Error('async transaction forbidden'), {
            code: 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN'
          });
        }
        db.exec('COMMIT');
        return value;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    }
  });
  try {
    db.exec(`CREATE TABLE r32_meta(
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`);
    applyBatch41Fix6MArchitectureReferenceClosure(db);
    applyArchitectureClosureV2WpA(db);
    applyArchitectureClosureV2WpB(db, { at: '2026-08-04T08:00:00.000Z' });
    db.prepare(`INSERT INTO authority_write_host_lease(
      singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
      host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
      acquired_at,heartbeat_at,updated_at
    ) VALUES(1,'internal-operation-host',1234,'internal-operation-test','nonce',7,19,
      'ACTIVE',?,?,?,?,?)
    ON CONFLICT(singleton_id) DO UPDATE SET
      owner_instance_id=excluded.owner_instance_id,
      owner_pid=excluded.owner_pid,
      owner_process_identity=excluded.owner_process_identity,
      startup_nonce=excluded.startup_nonce,
      host_generation=excluded.host_generation,
      fencing_token=excluded.fencing_token,
      state=excluded.state,
      acquired_at_ms=excluded.acquired_at_ms,
      heartbeat_at_ms=excluded.heartbeat_at_ms,
      acquired_at=excluded.acquired_at,
      heartbeat_at=excluded.heartbeat_at,
      updated_at=excluded.updated_at`).run(
      Date.parse('2026-08-04T08:00:00.000Z'),
      Date.parse('2026-08-04T08:00:00.000Z'),
      '2026-08-04T08:00:00.000Z',
      '2026-08-04T08:00:00.000Z',
      '2026-08-04T08:00:00.000Z'
    );
    const cleanup = () => {
      try { db.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    };
    try {
      const result = work({ db, store });
      if (result && typeof result.then === 'function') return result.finally(cleanup);
      cleanup();
      return result;
    } catch (error) {
      cleanup();
      throw error;
    }
  } catch (error) {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    throw error;
  }
}

function loadInternalAuthorityModule(testId) {
  assert.equal(fs.existsSync(internalAuthorityPath), true, `${testId}:MODULE_REQUIRED`);
  delete require.cache[require.resolve(internalAuthorityPath)];
  return require(internalAuthorityPath);
}

function createInternalAuthority(module, store) {
  let sequence = 0;
  return new module.DurableInternalOperationAuthority({
    storeProvider: () => store,
    tokenProvider: () => Object.freeze({
      instanceId: 'internal-operation-host',
      hostGeneration: 7,
      fencingToken: 19
    }),
    clock: () => new Date(Date.parse('2026-08-04T08:01:00.000Z') + (sequence++ * 1000)).toISOString(),
    idFactory: prefix => `${prefix}-fixed-${sequence}`,
    leaseMs: 120000
  });
}


function waitForValue(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('M3-SC-DIAG wait timed out'));
      setTimeout(check, 5);
    };
    check();
  });
}

function schema23TranslationStore(store, initialMessage) {
  const rows = new Map([[initialMessage.id, { ...initialMessage }]]);
  return Object.freeze({
    db: store.db,
    transaction: callback => store.transaction(callback),
    getMessage(id) { return rows.get(String(id || '').trim()) || null; },
    upsertMessage(input) { rows.set(input.id, { ...input }); return input.id; }
  });
}

test('M3-SC-DIAG-001 report declares the stable WP-B diagnostic schema', () => {
  const value = report();
  assert.equal(value.diagnosticsSchemaVersion, 1, 'M3-SC-DIAG-001');
  assert.equal(value.diagnosticRecordType, 'YANCE_ACV2_WP_B_SOURCE_CLOSURE_VIOLATION', 'M3-SC-DIAG-001');
});

test('M3-SC-DIAG-002 classified violation count matches the exact record set', () => {
  const value = report();
  assert.equal(Number.isSafeInteger(value.classifiedViolationCount), true, 'M3-SC-DIAG-002:INTEGER_REQUIRED');
  assert.equal(value.classifiedViolationCount, value.violations.length, 'M3-SC-DIAG-002:COUNT_MISMATCH');
});

test('M3-SC-DIAG-003 every nonterminal inventory row has one exact classified violation', () => {
  const baseline = readJson(baselinePath);
  const inventory = readCombinedInventory();
  const value = report();
  const productionTerminal = new Set(baseline.productionTerminalStates);
  const nonProductionTerminal = new Set(baseline.nonProductionTerminalStates);
  const openRows = inventory.entries.filter(entry => (
    entry.classification === 'NON_PRODUCTION_HARNESS'
      ? !nonProductionTerminal.has(entry.closureState)
      : !productionTerminal.has(entry.closureState)
  ));
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

test('M3-SC-DIAG-008 internal operation types map only to the sealed six operation kinds', () => {
  const module = loadInternalAuthorityModule('M3-SC-DIAG-008');
  assert.equal(typeof module.internalOperationKindFor, 'function', 'M3-SC-DIAG-008:FUNCTION_REQUIRED');
  for (const [operationType, expectedKind] of INTERNAL_OPERATION_KIND_CASES) {
    assert.equal(module.internalOperationKindFor(operationType), expectedKind, `M3-SC-DIAG-008:${operationType}`);
  }
  assert.throws(
    () => module.internalOperationKindFor('unregistered.internal.operation'),
    error => error?.code === 'WP_B_INTERNAL_OPERATION_KIND_UNREGISTERED',
    'M3-SC-DIAG-008:UNKNOWN_FAIL_CLOSED'
  );
});

test('M3-SC-DIAG-009 canonical internal lifecycle uses Schema 23 claim and terminal CAS', () => withSchema23(({ db, store }) => {
  const module = loadInternalAuthorityModule('M3-SC-DIAG-009');
  assert.equal(typeof module.DurableInternalOperationAuthority, 'function', 'M3-SC-DIAG-009:CLASS_REQUIRED');
  const authority = createInternalAuthority(module, store);
  const created = authority.create({
    operationId: 'translation-operation-1',
    operationType: 'translation.message',
    scopeKey: 'message-1',
    objectFingerprint: 'translation-source-hash-1',
    metadata: { messageId: 'message-ref-1', progress: 0 }
  });
  assert.equal(created.created, true, 'M3-SC-DIAG-009:CREATE');
  assert.equal(created.operation.operationKind, 'AI_PROVIDER_EXECUTION', 'M3-SC-DIAG-009:KIND');
  assert.equal(created.operation.state, 'SCHEDULED', 'M3-SC-DIAG-009:SCHEDULED');

  const started = authority.start(created.operation.operationId, { progress: 5 });
  assert.equal(started.updated, true, 'M3-SC-DIAG-009:START');
  assert.equal(started.operation.state, 'RUNNING', 'M3-SC-DIAG-009:RUNNING');
  assert.equal(started.operation.ownerId, 'internal-operation-host', 'M3-SC-DIAG-009:OWNER');
  assert.ok(started.operation.claimId, 'M3-SC-DIAG-009:CLAIM');
  assert.equal(started.operation.hostGeneration, 7, 'M3-SC-DIAG-009:HOST_GENERATION');
  assert.equal(started.operation.fencingToken, 19, 'M3-SC-DIAG-009:FENCING');

  const progress = authority.progress(created.operation.operationId, 55);
  assert.equal(progress.updated, true, 'M3-SC-DIAG-009:PROGRESS');
  assert.equal(progress.operation.state, 'RUNNING', 'M3-SC-DIAG-009:PROGRESS_STATE');
  assert.equal(progress.operation.progress, 55, 'M3-SC-DIAG-009:PROGRESS_VALUE');

  const succeeded = authority.succeed(
    created.operation.operationId,
    { status: 'translated', messageId: 'message-ref-1' },
    { generation: started.operation.generation, objectFingerprint: 'translation-source-hash-1' }
  );
  assert.equal(succeeded.updated, true, 'M3-SC-DIAG-009:SUCCEED');
  assert.equal(succeeded.operation.state, 'SUCCEEDED', 'M3-SC-DIAG-009:TERMINAL');
  assert.equal(succeeded.operation.progress, 100, 'M3-SC-DIAG-009:TERMINAL_PROGRESS');

  const events = db.prepare(`SELECT event_type,to_state,payload_json
    FROM durable_execution_events WHERE execution_id=? ORDER BY sequence`).all(created.operation.operationId);
  assert.ok(events.some(row => row.event_type === 'internal-operation-progress'), 'M3-SC-DIAG-009:PROGRESS_EVENT');
  assert.ok(events.some(row => row.to_state === 'SUCCEEDED'), 'M3-SC-DIAG-009:TERMINAL_EVENT');

  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const legacyTable of [
    'async_operation_state',
    'background_job_state',
    'ai_provider_physical_execution_state'
  ]) assert.equal(names.has(legacyTable), false, `M3-SC-DIAG-009:${legacyTable}`);
}));

test('M3-SC-DIAG-010 stale Host fencing rejects internal operation start', () => withSchema23(({ db, store }) => {
  const module = loadInternalAuthorityModule('M3-SC-DIAG-010');
  const authority = createInternalAuthority(module, store);
  const created = authority.create({
    operationId: 'fenced-operation-1',
    operationType: 'history.conversation.sync',
    scopeKey: 'conversation-1',
    objectFingerprint: 'history-source-hash-1'
  });
  db.prepare(`UPDATE authority_write_host_lease
    SET host_generation=8,fencing_token=20 WHERE singleton_id=1`).run();
  assert.throws(
    () => authority.start(created.operation.operationId),
    error => error?.code === 'WP_B_EXECUTION_CLAIM_CAS_REJECTED',
    'M3-SC-DIAG-010'
  );
  assert.equal(authority.read(created.operation.operationId).state, 'SCHEDULED', 'M3-SC-DIAG-010:NO_MUTATION');
}));

test('M3-SC-DIAG-011 canonical internal retry lifecycle owns heartbeat and retry scheduling in Schema 23', () => withSchema23(({ db, store }) => {
  const module = loadInternalAuthorityModule('M3-SC-DIAG-011');
  const authority = createInternalAuthority(module, store);
  const created = authority.create({
    operationId: 'avatar-operation-retry-1',
    operationType: 'avatar.contact.refresh',
    scopeKey: 'whatsapp:account-1:conversation-1',
    objectFingerprint: 'avatar-source-hash-1',
    maxAttempts: 4,
    metadata: { accountId: 'account-1', progress: 0 }
  });
  const started = authority.start(created.operation.operationId, { progress: 10 });
  const firstLeaseExpiresAt = started.operation.leaseExpiresAt;
  const heartbeat = authority.heartbeat(created.operation.operationId);
  assert.equal(heartbeat.updated, true, 'M3-SC-DIAG-011:HEARTBEAT_UPDATED');
  assert.equal(heartbeat.operation.state, 'RUNNING', 'M3-SC-DIAG-011:HEARTBEAT_STATE');
  assert.ok(Date.parse(heartbeat.operation.leaseExpiresAt) > Date.parse(firstLeaseExpiresAt), 'M3-SC-DIAG-011:LEASE_EXTENDED');

  const failed = authority.fail(
    created.operation.operationId,
    { code: 'AVATAR_FETCH_TIMEOUT' },
    {
      retryable: true,
      maxAttempts: 4,
      retryDelayMs: 15000,
      generation: started.operation.generation,
      objectFingerprint: 'avatar-source-hash-1'
    }
  );
  assert.equal(failed.updated, true, 'M3-SC-DIAG-011:FAIL_UPDATED');
  assert.equal(failed.retryable, true, 'M3-SC-DIAG-011:RETRYABLE');
  assert.equal(failed.operation.state, 'RETRY_SCHEDULED', 'M3-SC-DIAG-011:RETRY_STATE');
  assert.equal(failed.operation.retryCount, 1, 'M3-SC-DIAG-011:RETRY_COUNT');
  assert.ok(Date.parse(failed.operation.nextAttemptAt) > Date.parse(failed.operation.updatedAt), 'M3-SC-DIAG-011:NEXT_ATTEMPT');
  assert.equal(failed.operation.ownerId, '', 'M3-SC-DIAG-011:OWNER_CLEARED');
  assert.equal(failed.operation.claimId, '', 'M3-SC-DIAG-011:CLAIM_CLEARED');

  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  assert.equal(names.has('background_job_state'), false, 'M3-SC-DIAG-011:NO_LEGACY_BACKGROUND_TABLE');
}));

test('M3-SC-DIAG-012A translation job lifecycle is owned by Schema 23 across service instances', () => withSchema23(async ({ store }) => {
  const module = loadInternalAuthorityModule('M3-SC-DIAG-012A');
  const authority = createInternalAuthority(module, store);
  const translationStore = schema23TranslationStore(store, {
    id: 'translation-message-durable-1',
    sessionKey: 'translation-conversation-durable-1',
    contactId: 'translation-contact-durable-1',
    direction: 'incoming',
    text: 'Guten Morgen',
    language: 'de'
  });
  const { MessageTranslationService } = require(path.join(repoRoot, 'backend', 'services', 'messageTranslationService.js'));
  let finishFirstTranslation;
  const firstTranslation = new Promise(resolve => { finishFirstTranslation = resolve; });
  const common = {
    storeProvider: () => translationStore,
    internalOperationAuthorityProvider: () => authority,
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {}, info() {} }
  };
  const first = new MessageTranslationService({
    ...common,
    bilingualUnderstandingService: {
      async translateToChinese() { return firstTranslation; }
    }
  });

  const created = first.createJob('translation-message-durable-1', { force: true });
  assert.equal(created.lifecyclePersisted, true, 'M3-SC-DIAG-012A:CREATE_MUST_PERSIST');
  assert.equal(created.durableState, 'SCHEDULED', 'M3-SC-DIAG-012A:CREATE_SCHEDULED');
  const running = await waitForValue(() => {
    const snapshot = first.getJob(created.id);
    return snapshot?.durableState === 'RUNNING' ? snapshot : null;
  });
  assert.equal(running.status, 'running', 'M3-SC-DIAG-012A:RUNNING_PROJECTION');

  const second = new MessageTranslationService({
    ...common,
    bilingualUnderstandingService: {
      async translateToChinese(input) {
        return {
          sourceText: input.text,
          sourceLanguage: 'de',
          translatedZh: '早上好',
          translationStatus: 'success',
          translationModel: 'durable-test-model',
          translatedAt: '2026-08-04T08:10:00.000Z'
        };
      }
    }
  });
  const restartedRead = second.getJob(created.id);
  assert.equal(restartedRead?.durableState, 'RUNNING', 'M3-SC-DIAG-012A:RESTART_READS_SCHEMA23');
  assert.equal(restartedRead?.lifecyclePersisted, true, 'M3-SC-DIAG-012A:RESTART_PERSISTED');

  const retried = second.retryJob(created.id);
  assert.notEqual(retried.id, created.id, 'M3-SC-DIAG-012A:RETRY_NEW_OPERATION');
  assert.equal(second.getJob(created.id)?.durableState, 'CANCELLED', 'M3-SC-DIAG-012A:RETRY_SUPERSEDES_RUNNING');
  assert.equal(second.getJob(created.id)?.errorCode, 'TRANSLATION_SUPERSEDED', 'M3-SC-DIAG-012A:SUPERSEDE_REASON');

  finishFirstTranslation({
    sourceText: 'Guten Morgen',
    sourceLanguage: 'de',
    translatedZh: '旧结果不得提交',
    translationStatus: 'success',
    translationModel: 'stale-model',
    translatedAt: '2026-08-04T08:09:00.000Z'
  });
  await waitForValue(() => first.active === 0);
  assert.notEqual(translationStore.getMessage('translation-message-durable-1')?.translatedZh, '旧结果不得提交', 'M3-SC-DIAG-012A:STALE_RESULT_REJECTED');

  const succeeded = await waitForValue(() => {
    const snapshot = second.getJob(retried.id);
    return snapshot?.durableState === 'SUCCEEDED' ? snapshot : null;
  });
  assert.equal(succeeded.status, 'success', 'M3-SC-DIAG-012A:RETRY_SUCCEEDED');
  const third = new MessageTranslationService({ ...common });
  assert.equal(third.getJob(retried.id)?.durableState, 'SUCCEEDED', 'M3-SC-DIAG-012A:TERMINAL_SURVIVES_RESTART');
  assert.equal(third.listJobs({ messageId: 'translation-message-durable-1', limit: 10 }).length, 2, 'M3-SC-DIAG-012A:LIST_FROM_SCHEMA23');

  first.close();
  second.close();
  third.close();
}));

test('M3-SC-DIAG-012B WhatsApp history media enqueue acquires canonical durability before transient queueing', () => {
  const { WhatsAppHistoryMediaRecoveryQueue } = require('../../../services/whatsappHistoryMediaRecovery');
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    store: { listConversations() { return []; }, listMessages() { return []; }, async upsert() {} },
    media: {}, events: { publish() {} }, log: { info() {}, warn() {} }
  });
  const calls = [];
  queue.beginDurableMedia = job => {
    calls.push(job);
    return { acquired: false, reason: 'retry-wait', lease: null, job: { state: 'RETRY_SCHEDULED', nextAttemptAt: '2026-08-18T00:00:00.000Z' } };
  };
  const result = queue.enqueue({
    accountId: 'wa-durable-1', conversationId: 'conv-durable-1', messageId: 'msg-durable-1',
    info: { key: { id: 'msg-durable-1' }, message: { imageMessage: {} } },
    socket: {}, descriptor: { kind: 'image', downloadStatus: 'pending' }, message: { id: 'msg-durable-1' }
  });
  assert.equal(calls.length, 1, 'M3-SC-DIAG-012B:DURABLE_ACQUIRE_REQUIRED');
  assert.equal(result.queued, false, 'M3-SC-DIAG-012B:TRANSIENT_QUEUE_MUST_NOT_BYPASS_DURABLE_DECISION');
  assert.equal(result.reason, 'retry-wait', 'M3-SC-DIAG-012B:DURABLE_DECISION_MUST_WIN');
});

test('M3-SC-DIAG-012C canonical WhatsApp recovery worklist treats attachment retry fields as projection only', () => {
  const { WhatsAppHistoryMediaRecoveryQueue } = require('../../../services/whatsappHistoryMediaRecovery');
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const message = {
    id: 'msg-durable-projection-1', conversationId: 'conv-durable-projection-1', sentAt: new Date().toISOString(),
    attachments: [{ kind: 'image', downloadStatus: 'failed', retryable: false, retryCount: 999, nextRetryAt: future }]
  };
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    store: {
      listConversations() { return [{ id: message.conversationId, accountId: 'wa-durable-projection-1', platform: 'whatsapp' }]; },
      listMessages() { return [message]; }, async upsert() {}
    },
    media: {}, events: { publish() {} }, log: { info() {}, warn() {} }
  });
  queue.useCanonicalDurability = true;
  const rows = queue.recoverableMessages('wa-durable-projection-1');
  assert.equal(rows.length, 1, 'M3-SC-DIAG-012C:SCHEMA23_MUST_OWN_RETRY_ELIGIBILITY');
});

test('M3-SC-DIAG-012D transient WhatsApp dedupe cannot preempt canonical durable retry authority', () => {
  const { WhatsAppHistoryMediaRecoveryQueue } = require('../../../services/whatsappHistoryMediaRecovery');
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    store: { listConversations() { return []; }, listMessages() { return []; }, async upsert() {} },
    media: {}, events: { publish() {} }, log: { info() {}, warn() {} }
  });
  queue.useCanonicalDurability = true;
  const key = 'wa-durable-2:conv-durable-2:msg-durable-2';
  queue.known.set(key, { state: 'settled', at: Date.now(), nextRetryAt: new Date(Date.now() + 60_000).toISOString() });
  let acquisitions = 0;
  queue.beginDurableMedia = () => {
    acquisitions += 1;
    return { acquired: false, reason: 'retry-wait', lease: null, operation: { state: 'RETRY_SCHEDULED', nextAttemptAt: '2026-08-18T00:00:00.000Z' } };
  };
  const result = queue.enqueue({
    accountId: 'wa-durable-2', conversationId: 'conv-durable-2', messageId: 'msg-durable-2',
    info: { key: { id: 'msg-durable-2' }, message: { imageMessage: {} } }, socket: {},
    descriptor: { kind: 'image', downloadStatus: 'failed' }, message: { id: 'msg-durable-2' }
  });
  assert.equal(acquisitions, 1, 'M3-SC-DIAG-012D:DURABLE_AUTHORITY_MUST_RUN_BEFORE_TRANSIENT_DEDUPE');
  assert.equal(result.reason, 'retry-wait', 'M3-SC-DIAG-012D:DURABLE_DECISION_MUST_OVERRIDE_TRANSIENT_STATE');
});

test('M3-SC-DIAG-012 AI gateway generic scheduling is pinned behind the p-queue adapter boundary', () => {
  const aiGatewayPath = path.join(repoRoot, 'backend', 'services', 'aiGateway.js');
  const source = fs.readFileSync(aiGatewayPath, 'utf8');
  const manifest = readJson(path.join(repoRoot, 'package.json'));

  assert.doesNotMatch(
    source,
    /require\(['"]\.\/jobQueue['"]\)/u,
    'M3-SC-DIAG-012:LEGACY_JOB_QUEUE_IMPORT_FORBIDDEN'
  );
  assert.equal(
    manifest.dependencies?.['p-queue'],
    '9.3.1',
    'M3-SC-DIAG-012:P_QUEUE_DIRECT_DEPENDENCY_MUST_BE_EXACT'
  );
  assert.match(
    source,
    /class\s+PQueueSchedulerAdapter\b/u,
    'M3-SC-DIAG-012:YANCE_ADAPTER_BOUNDARY_REQUIRED'
  );
  assert.match(
    source,
    /import\(['"]p-queue['"]\)/u,
    'M3-SC-DIAG-012:NATIVE_ESM_MUST_LOAD_BEHIND_ADAPTER'
  );
  for (const forbidden of [
    /ai_provider_physical_execution_state/u,
    /durable_executions/u,
    /background_job_state/u,
    /storeProvider/u
  ]) {
    assert.doesNotMatch(source, forbidden, `M3-SC-DIAG-012:OSS_SCHEDULER_AUTHORITY_BOUNDARY:${forbidden.source}`);
  }
});
