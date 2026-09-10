'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch27-handoff-v2-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  getSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `batch27-handoff-v2-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});
const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
const runtimeAuthorityStore = getSqliteConnectionBroker().open();
const appRuntime = AppRuntimeFactory.create({
  ownership: { guard: () => ({ ownerInstanceId: 'batch27-handoff-v2-owner', fencingToken: 1 }) },
  store: {
    db: runtimeAuthorityStore.db,
    snapshot: () => ({
      stateVersion: 1,
      lastEventSequence: 0,
      runtime: { operatingMode: 'normal', operatingModeRevision: 1 },
      capabilities: {},
      diagnosticsSummary: {}
    })
  },
  lifecycle: { state: 'runtime_state_ready' },
  buildId: 'batch27-handoff-v2-test',
  authorityWriteHostCapability: authorityWriteHost.capability,
  authorityStore: runtimeAuthorityStore
});
appRuntime.configureProductionServices();

const { R32SqliteStore, SCHEMA_VERSION } = require('../lib/r32SqliteStore');
const { ResilientLeaseClock } = require('../lib/resilientLeaseClock');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const asyncOperationLifecycleAuthority = require('../services/asyncOperationLifecycleAuthority');
const { executeWithDeadline } = require('../services/executionDeadline');
const telegramModule = require('../services/telegramAdapter');
const backgroundJobAuthority = require('../services/backgroundJobAuthority');
const messageStore = require('../services/messageStore');
const { WhatsAppAdapter } = require('../services/whatsappAdapter');
const { StoreManager } = require('../store/StoreManager');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { getStore, closeStore } = require('../repositories/storeProvider');

const { TelegramAdapter } = telegramModule;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function fixture(prefix = 'yance-b27-fixture-') {
  const root = temp(prefix);
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return { root, store, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}
function patch(t, object, key, value) {
  const original = object[key]; object[key] = value;
  t.after(() => { object[key] = original; });
}
function seedScope(store, suffix = '1', platform = 'facebook') {
  const accountId = `account-${suffix}`;
  const sessionKey = `${accountId}:peer-${suffix}`;
  const target = `peer-${suffix}`;
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform, state: 'online', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform, title: target, routeState: 'bound', chatJid: target, externalId: target });
  return { accountId, sessionKey, target, platform };
}
function routeAuthority(store) {
  return new OutboxRouteAuthority({ storeProvider: () => store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store }) });
}
function command(store, scope, id) {
  return {
    store,
    outboxRouteAuthority: routeAuthority(store),
    route: { conversationId: scope.sessionKey, accountId: scope.accountId, platform: scope.platform, routeTarget: scope.target, capabilitySnapshotId: 'cap-b27' },
    queue: { id, idempotencyKey: id, accountId: scope.accountId, sessionKey: scope.sessionKey, messageType: 'text', capabilitySnapshotId: 'cap-b27', payload: { platform: scope.platform, operation: 'text', text: id } },
    message: { id, dedupeKey: id, externalMessageId: id, accountId: scope.accountId, conversationId: scope.sessionKey, sessionKey: scope.sessionKey, chatJid: scope.target, platform: scope.platform, direction: 'outbound', fromMe: true, type: 'text', text: id }
  };
}
function persistedEgressAttempt(platform, accountId, idempotencyKey, suffix = '1') {
  return Object.freeze({
    executionId: `${platform}-execution-${suffix}`,
    intentId: `${platform}-intent-${suffix}`,
    attemptId: `${platform}-attempt-${suffix}`,
    claimId: `${platform}-claim-${suffix}`,
    ownerId: `${platform}-owner-${suffix}`,
    idempotencyKey,
    requestContentSha256: 'b'.repeat(64),
    generation: 3,
    hostGeneration: 7,
    fencingToken: 11,
    platform,
    accountReference: accountId,
    state: 'RUNNING'
  });
}
function spawnAndCollect(file, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: path.resolve(__dirname, '..', '..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}


test.after(() => {
  try { closeStore(); } catch (_) {}
  try { AppRuntimeFactory.resetForTests(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
});

test('current schema preserves Batch27 structured unknown, learning ledger, AI physical state and recovery metrics', () => {
  const f = fixture('yance-b27-current-schema-');
  try {
    assert.ok(SCHEMA_VERSION >= 23, 'current schema must include the historical Schema 23 layer');
    assert.equal(Number(f.store.getMeta('schema_version')), SCHEMA_VERSION);
    const tables = new Set(f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of ['learning_signal_ledger','ai_provider_physical_execution_state','durable_recovery_metrics']) assert.equal(tables.has(name), true, name);
    const queueColumns = new Set(f.store.db.prepare('PRAGMA table_info(r32_send_queue)').all().map(row => row.name));
    for (const name of ['unknown_scope','unknown_reason','unknown_lane','execution_generation','unknown_recorded_at']) assert.equal(queueColumns.has(name), true, name);
  } finally { f.close(); }
});

test('Batch27 live SQLite owner heartbeats beyond stale window and controlled takeover works after SIGKILL', async () => {
  const root = temp('yance-b27-owner-heartbeat-');
  const helper = path.join(root, 'owner.js');
  const storeModule = path.resolve(__dirname, '../lib/r32SqliteStore.js');
  const dbPath = path.join(root, 'same.db');
  fs.writeFileSync(helper, `
    'use strict';
    const { R32SqliteStore } = require(${JSON.stringify(storeModule)});
    try {
      const store = new R32SqliteStore({ dbPath: process.argv[2], ownershipStaleMs: 1000, ownershipHeartbeatMs: 200 });
      process.stdout.write(JSON.stringify({ok:true,pid:process.pid})+'\\n');
      const hold = Number(process.argv[3] || 0);
      if (hold > 0) setTimeout(() => { store.close(); process.exit(0); }, hold);
      else { store.close(); process.exit(0); }
    } catch (error) {
      process.stdout.write(JSON.stringify({ok:false,code:error.code||error.reasonCode||'',message:error.message})+'\\n');
      process.exit(2);
    }
  `, 'utf8');
  let owner;
  try {
    owner = spawn(process.execPath, [helper, dbPath, '10000'], { cwd: path.resolve(__dirname, '..', '..'), env: { ...process.env, YANCE_DATA_DIR: path.join(root, 'owner-data') }, stdio: ['ignore','pipe','pipe'] });
    const firstLine = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('owner ready timeout')), 10000);
      owner.stdout.on('data', chunk => { buffer += chunk; const index = buffer.indexOf('\n'); if (index >= 0) { clearTimeout(timer); resolve(buffer.slice(0, index)); } });
      owner.on('error', reject);
      owner.on('exit', code => { if (!buffer.includes('\n')) reject(new Error(`owner exited ${code}`)); });
    });
    assert.equal(JSON.parse(firstLine).ok, true);
    await delay(2200);
    const contender = spawnSync(process.execPath, [helper, dbPath, '0'], { cwd: path.resolve(__dirname, '..', '..'), env: { ...process.env, YANCE_DATA_DIR: path.join(root, 'contender-data') }, encoding: 'utf8', timeout: 15000 });
    assert.equal(contender.status, 2, contender.stderr || contender.stdout);
    assert.equal(JSON.parse(contender.stdout.trim()).code, 'SQLITE_OWNERSHIP_CONFLICT');
    owner.kill('SIGKILL');
    await new Promise(resolve => owner.once('exit', resolve));
    await delay(100);
    const successor = spawnSync(process.execPath, [helper, dbPath, '0'], { cwd: path.resolve(__dirname, '..', '..'), env: { ...process.env, YANCE_DATA_DIR: path.join(root, 'successor-data') }, encoding: 'utf8', timeout: 15000 });
    assert.equal(successor.status, 0, successor.stderr || successor.stdout);
    assert.equal(JSON.parse(successor.stdout.trim()).ok, true);
  } finally {
    try { owner?.kill('SIGKILL'); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Batch27 interrupted send preserves command scope and cannot become a global queue freeze', () => {
  const f = fixture('yance-b27-send-scope-');
  try {
    const scope = seedScope(f.store, 'scope', 'telegram');
    outboundCommandRepository.createAtomic(command(f.store, scope, 'send-scope-crash'));
    const claimed = f.store.claimNextSend();
    assert.equal(claimed.unknown_scope, 'command');
    assert.match(claimed.unknown_lane, /^telegram:/);
    assert.ok(claimed.execution_generation);
    assert.equal(f.store.recoverInterruptedSends(), 1);
    const recovered = f.store.getSendQueueItem(claimed.id);
    assert.equal(recovered.state, 'send_outcome_unknown');
    assert.equal(recovered.unknown_scope, 'command');
    assert.equal(recovered.unknown_reason, 'PROCESS_RESTART_RECOVERY');
    assert.equal(f.store.claimNextSend(), null, 'command-scoped unknown must not be reclaimed for automatic resend');
  } finally { f.close(); }
});

test('Batch27 external AbortSignal settles immediately even when the underlying operation ignores abort', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = executeWithDeadline(() => new Promise(() => {}), { timeoutMs: 5000, signal: controller.signal, operation: 'batch27-external-abort' });
  setTimeout(() => controller.abort(Object.assign(new Error('caller cancelled'), { code: 'CALLER_ABORTED' })), 20);
  await assert.rejects(pending, error => error.code === 'CALLER_ABORTED');
  assert.ok(Date.now() - started < 500, `abort took ${Date.now() - started}ms`);
});

test('Batch27 background job compatibility facade exposes only durable recovery state', () => {
  assert.equal(typeof backgroundJobAuthority.BackgroundJobAuthority, 'undefined');
  assert.equal(typeof backgroundJobAuthority.enqueue, 'undefined');
  assert.equal(typeof backgroundJobAuthority.snapshot, 'undefined');
  assert.equal(typeof backgroundJobAuthority.recoverDurableExecutions, 'function');
  assert.equal(backgroundJobAuthority.STATES.SUCCEEDED, 'SUCCEEDED');
});

test('Batch27 Learning V4 uses idempotent immutable signals instead of worker leases', () => { const service=require('../services/replyFeedbackLearningService');const a=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'same',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});const b=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'same',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});assert.equal(a.idempotencyKey,b.idempotencyKey);assert.equal(service.status().customProjectionScheduler,false); });

test('Batch27 resilient lease clock detects +1h/-1h wall jumps without moving live leases backward or forward', () => {
  let wall = 1_700_000_000_000; let mono = 10_000;
  const clock = new ResilientLeaseClock({ wall: () => wall, monotonic: () => mono, jumpThresholdMs: 1000 });
  assert.equal(clock.now(), wall);
  mono += 100; wall += 3_600_000;
  const forward = clock.sample();
  assert.equal(forward.jumped, true);
  assert.equal(forward.value, 1_700_000_000_100);
  mono += 100; wall -= 7_200_000;
  const backward = clock.sample();
  assert.equal(backward.jumped, true);
  assert.equal(backward.value, 1_700_000_000_200);
  assert.equal(clock.status().lastJump.direction, 'backward');
});

test('Batch27 Telegram enrichment recovery pages oldest-first and uses account-scoped dedupe keys', async t => {
  const adapter = new TelegramAdapter();
  const account = { id: 'tg-a', displayName: 'TG A' };
  const row = { client: { async getMessages() { return [{ id: 101, message: 'hello', out: false, senderId: '42', date: Date.now() / 1000 }]; } } };
  const pages = [
    { messages: [
      { conversationId: 'tg-a:42', chatJid: 'telegram:42', externalMessageId: '101', dedupeKey: 'tg-a:42:101', updatedAt: '2026-01-01T00:00:00.000Z' },
      { conversationId: 'tg-a:43', chatJid: 'telegram:43', externalMessageId: '101', dedupeKey: 'tg-a:43:101', updatedAt: '2026-01-01T00:00:00.000Z' }
    ], hasMore: true, nextCursor: { updatedAt: '2026-01-01T00:00:00.000Z', messageId: 'tg-a:43:101' } },
    { messages: [{ conversationId: 'tg-a:44', chatJid: 'telegram:44', externalMessageId: '102', dedupeKey: 'tg-a:44:102', updatedAt: '2026-01-01T00:00:01.000Z' }], hasMore: false, nextCursor: null }
  ];
  let snapshotCalls = 0; const lookupKeys = []; const enriched = [];
  patch(t, messageStore, 'listPendingTelegramEnrichment', (_accountId, filter = {}) => {
    if (filter.limit === 1) return { messages: [], hasMore: false, nextCursor: null };
    const page = pages[snapshotCalls++] || { jobs: [], hasMore: false, total: 0, nextCursor: null, oldestPendingAt: '' };
    if (snapshotCalls === 2) assert.deepEqual(filter.cursor, pages[0].nextCursor);
    return page;
  });
  patch(t, messageStore, 'getMessageByDedupeKey', key => { lookupKeys.push(key); return { id: key, dedupeKey: key, externalMessageId: key.split(':').pop(), conversationId: key.split(':').slice(0, 2).join(':'), chatJid: `telegram:${key.split(':')[1]}` }; });
  patch(t, adapter, 'enrichPersistedMessage', async (_account, _row, _msg, existing) => { enriched.push(existing.dedupeKey); });
  const result = await adapter.recoverMessageEnrichment(account, row, { pageSize: 2, maximumPages: 3, budgetMs: 5000 });
  assert.deepEqual(lookupKeys, ['tg-a:42:101','tg-a:43:101','tg-a:44:102']);
  assert.deepEqual(enriched, lookupKeys);
  assert.equal(result.scanned, 3);
  assert.equal(result.recovered, 3);
  assert.equal(result.pages, 2);
});

test('Batch27 WhatsApp late SDK success is quarantined before any local sent projection', async t => {
  const adapter = new WhatsAppAdapter();
  const controller = new AbortController();
  let resolveSend; let upserts = 0;
  const row = {
    state: 'online', databaseAccountId: 'wa-late', generation: 1, user: { name: 'Me' },
    socket: { sendMessage() { return new Promise(resolve => { resolveSend = resolve; }); }, end() {} }
  };
  adapter.accounts.set('wa-late', row);
  patch(t, messageStore, 'upsert', async () => { upserts += 1; });
  const pending = adapter.sendText({
    accountId: 'wa-late',
    chatJid: '491111111@s.whatsapp.net',
    text: 'late',
    localMessageId: 'local-late',
    sessionKey: 'wa-late:491111111@s.whatsapp.net',
    signal: controller.signal,
    executionGeneration: 'wa-gen-late',
    physicalAttemptContext: persistedEgressAttempt('whatsapp', 'wa-late', 'local-late', 'late')
  });
  await delay(5);
  controller.abort(Object.assign(new Error('deadline'), { code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED' }));
  resolveSend({ key: { id: 'remote-late-1' } });
  await assert.rejects(pending, error => error.platformAccepted === true && error.platformMessageId === 'remote-late-1' && error.automaticRetryBlocked === true);
  assert.equal(upserts, 0);
});

test('Batch27 Persona version/hash is rechecked inside candidate persistence transaction', async () => {
  const f = fixture('yance-b27-persona-cas-');
  try {
    const accountId = 'wa-persona'; const contactId = 'contact-persona'; const conversationId = 'conversation-persona';
    f.store.upsertAccount({ id: accountId, platform: 'whatsapp', adapterAccountId: accountId, displayName: 'Persona', canSend: true, canReceive: true });
    f.store.upsertContact({ id: contactId, platform: 'whatsapp', accountId, externalId: '491111111@s.whatsapp.net', displayName: 'Persona Contact', canonicalContactId: contactId });
    f.store.upsertConversation({ sessionKey: conversationId, platform: 'whatsapp', accountId, contactId, title: 'Persona Contact', routeState: 'ready', version: 1 });
    let version = 1; let hash = 'hash-v1';
    const personaAuthority = { resolveEffective() { return { profileId: 'owner', baseVersion: version, effectivePolicyHash: hash }; } };
    const manager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store: f.store }) });
    registerAiReplyCommands(manager, { personaAuthority });
    await manager.hydrate();
    const task = await manager.dispatch({ type: 'AI_REPLY_TASK_STARTED', source: 'batch27-test', payload: { contactId, conversationId, conversationRevision: 1, entityVersions: {}, source: 'openrouter' } });
    version = 2; hash = 'hash-v2';
    await assert.rejects(manager.dispatch({ type: 'AI_REPLY_CANDIDATE_READY', source: 'batch27-test', payload: {
      taskId: task.result.taskId, text: 'stale persona candidate', conversationId, conversationRevision: 1,
      expectedConversationRevision: 1, expectedEntityVersions: {}, personaProfileId: 'owner', personaVersionId: 1,
      personaPolicyHash: 'hash-v1', personaScopeContactId: contactId
    } }), error => error.code === 'STALE_PERSONA_PROFILE_AT_CANDIDATE_COMMIT');
    assert.equal(Object.keys(manager.snapshot().aiBrain.candidatesById).length, 0);
  } finally { f.close(); }
});


test('Batch27 async lifecycle compatibility facade exposes only durable recovery state', () => {
  assert.equal(typeof asyncOperationLifecycleAuthority.AsyncOperationLifecycleAuthority, 'undefined');
  assert.equal(typeof asyncOperationLifecycleAuthority.recoverDurableExecutions, 'function');
  assert.equal(asyncOperationLifecycleAuthority.STATES.RUNNING, 'RUNNING');
  assert.equal(asyncOperationLifecycleAuthority.TERMINAL.has('SUCCEEDED'), true);
});

test('Batch27 four processes racing the same fresh SQLite file allow exactly one migration owner', async () => {
  const root = temp('yance-b27-same-file-migration-race-');
  const helper = path.join(root, 'migration-racer.js');
  const dbPath = path.join(root, 'shared', 'yance.db');
  const trigger = path.join(root, 'go');
  const storeModule = path.resolve(__dirname, '../lib/r32SqliteStore.js');
  fs.writeFileSync(helper, `
    'use strict';
    const fs = require('node:fs');
    const { R32SqliteStore } = require(${JSON.stringify(storeModule)});
    process.stdout.write('READY\\n');
    const wait = setInterval(() => {
      if (!fs.existsSync(process.argv[3])) return;
      clearInterval(wait);
      try {
        const store = new R32SqliteStore({ dbPath: process.argv[2], ownershipStaleMs: 30000, ownershipHeartbeatMs: 500 });
        process.stdout.write(JSON.stringify({ok:true,schema:store.getMeta('schemaVersion',0),pid:process.pid})+'\\n');
        setTimeout(() => { store.close(); process.exit(0); }, 4000);
      } catch (error) {
        process.stdout.write(JSON.stringify({ok:false,code:error.code||error.reasonCode||'',message:error.message,pid:process.pid})+'\\n');
        process.exit(2);
      }
    }, 5);
  `, 'utf8');
  const children = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      children.push(spawn(process.execPath, [helper, dbPath, trigger], {
        cwd: path.resolve(__dirname, '..', '..'),
        env: { ...process.env, YANCE_DATA_DIR: path.join(root, `data-${index}`) },
        stdio: ['ignore','pipe','pipe']
      }));
    }
    await Promise.all(children.map(child => new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('migration racer ready timeout')), 10000);
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.includes('READY\n')) { clearTimeout(timer); resolve(); }
      });
      child.on('error', reject);
    })));
    fs.writeFileSync(trigger, 'go', 'utf8');
    const outcomes = await Promise.all(children.map(child => new Promise((resolve, reject) => {
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} reject(new Error(`migration racer timeout: ${stderr}`)); }, 15000);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', code => {
        clearTimeout(timer);
        const lines = stdout.trim().split(/\r?\n/).filter(line => line.startsWith('{'));
        resolve({ code, payload: lines.length ? JSON.parse(lines[lines.length - 1]) : null, stderr });
      });
    })));
    const winners = outcomes.filter(row => row.code === 0 && row.payload?.ok === true);
    const rejected = outcomes.filter(row => row.code === 2 && row.payload?.code === 'SQLITE_OWNERSHIP_CONFLICT');
    assert.equal(winners.length, 1, JSON.stringify(outcomes));
    assert.equal(winners[0].payload.schema, SCHEMA_VERSION);
    assert.equal(rejected.length, 3, JSON.stringify(outcomes));
  } finally {
    for (const child of children) { try { child.kill('SIGKILL'); } catch (_) {} }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
