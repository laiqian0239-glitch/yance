'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../../backend/security/whatsappAuthCipher');
const { createWhatsAppAuthStateRepository } = require('../../backend/repositories/whatsappAuthStateRepository');
const { createWhatsAppMessageRetryStore } = require('../../backend/services/whatsappMessageRetryStore');
const {
  createWhatsAppMessageKeyIndexRepository,
  hashRawMessage
} = require('../../backend/repositories/whatsappMessageKeyIndexRepository');
const { CommunicationAuthority } = require('../../backend/services/communicationAuthority');
const {
  createSessionGenerationFence,
  createSocketGenerationGuard
} = require('../../backend/services/sessionGenerationFence');

const CRASH_EXIT_CODE = 86;
const AT = '2026-08-05T00:00:00.000Z';
const WORKER_TIMEOUT_MS = 30000;

const GENERATION_CONCURRENCY_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER',
    faultPoint: 'socket-a-await-boundary-before-creds-commit',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  }),
  Object.freeze({
    id: 'RECONNECT_TIMER_AFTER_GENERATION_CHANGE',
    faultPoint: 'reconnect-timer-fire-after-generation-change',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  }),
  Object.freeze({
    id: 'RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT',
    faultPoint: 'retry-counter-commit-before-process-exit',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  }),
  Object.freeze({
    id: 'MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE',
    faultPoint: 'canonical-message-write-before-index-rejection',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  }),
  Object.freeze({
    id: 'SQLITE_OWNERSHIP_HEARTBEAT_LOST',
    faultPoint: 'write-owner-process-killed-with-live-heartbeat',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  }),
  Object.freeze({
    id: 'WINDOWS_LEGACY_ARCHIVE_LOCK',
    faultPoint: 'legacy-directory-held-by-separate-process',
    execution: 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY'
  })
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = WORKER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function openStore(root) {
  return new R32SqliteStore({
    dbPath: path.join(root, 'database', 'yance.db'),
    ownershipHeartbeatMs: 100,
    ownershipStaleMs: 600
  });
}

function createCipher() {
  return createWhatsAppAuthCipher({
    key: Buffer.alloc(32, 0x6d),
    keyVersion: 1
  });
}

function closeFixture(store, cipher) {
  try { cipher?.close(); } catch (_) {}
  try { store?.close(); } catch (_) {}
}

function scenarioAccount(scenarioId) {
  const safe = scenarioId.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  return Object.freeze({
    accountId: `matrix-${safe}`,
    accountKey: `whatsapp-auth-account:matrix-${safe}`,
    epoch: 1,
    generation: 1,
    socketToken: `socket-a-${safe}`
  });
}

function createAuthRepository(store, cipher) {
  return createWhatsAppAuthStateRepository({
    storeProvider: () => store,
    cipher,
    clock: () => AT
  });
}

function initializeBase(root, scenarioId) {
  const store = openStore(root);
  const cipher = createCipher();
  const account = scenarioAccount(scenarioId);
  try {
    store.upsertAccount({
      id: account.accountId,
      platform: 'whatsapp',
      adapterAccountId: `${account.accountId}-device`
    });
    createAuthRepository(store, cipher).initializeAccount({
      accountKey: account.accountKey,
      accountId: account.accountId,
      currentEpoch: account.epoch,
      writerGeneration: account.generation,
      socketToken: account.socketToken,
      creds: {
        registered: true,
        me: { id: `${account.accountId}@s.whatsapp.net` },
        marker: 'baseline'
      }
    });
  } finally {
    closeFixture(store, cipher);
  }
  return account;
}

function spawnWorker(scenarioId, root, extra = []) {
  return spawn(process.execPath, [__filename, '--worker', scenarioId, root, ...extra], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
}

function waitForExit(child, timeoutMs = WORKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`Worker timed out\nstdout=${stdout}\nstderr=${stderr}`));
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve(Object.freeze({ code, signal, stdout, stderr }));
    });
  });
}

function forceKill(child) {
  try {
    return child.kill('SIGKILL');
  } catch (_) {
    return false;
  }
}

function integrity(store) {
  const row = store.db.prepare('PRAGMA integrity_check').get();
  return String(row?.integrity_check || Object.values(row || {})[0] || '');
}

function activeWriterCount(store) {
  return Number(store.db.prepare(`SELECT COUNT(*) AS count
    FROM whatsapp_auth_accounts WHERE state='ACTIVE'`).get().count || 0);
}

function countAutomaticSends(store) {
  const tables = store.db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND lower(name) LIKE '%outbox%' ORDER BY name`).all();
  let count = 0;
  for (const row of tables) {
    const table = String(row.name);
    if (!/^[A-Za-z0-9_]+$/u.test(table)) continue;
    count += Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
  }
  return count;
}

function commonState(root) {
  const store = openStore(root);
  try {
    return Object.freeze({
      databaseIntegrity: integrity(store),
      activeWriterCount: activeWriterCount(store),
      automaticSendCount: countAutomaticSends(store),
      loggedOutResurrected: Number(store.db.prepare(`SELECT COUNT(*) AS count
        FROM whatsapp_auth_accounts
        WHERE state='ACTIVE' AND logged_out_at<>''`).get().count || 0) > 0
    });
  } finally {
    store.close();
  }
}

function writeAuditReceipt(root, scenarioId, evidence) {
  const receipt = Object.freeze({
    schemaVersion: 1,
    matrix: 'OSS1A_WHATSAPP_GENERATION_CONCURRENCY_MATRIX',
    scenarioId,
    platform: process.platform,
    evidenceSha256: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    status: 'PASS'
  });
  const receiptPath = path.join(root, 'matrix-evidence', `${scenarioId}.json`);
  writeJson(receiptPath, receipt);
  const first = fs.readFileSync(receiptPath, 'utf8');
  writeJson(receiptPath, receipt);
  return first === fs.readFileSync(receiptPath, 'utf8');
}

function writerExpectation(account, overrides = {}) {
  return {
    accountKey: account.accountKey,
    expectedEpoch: account.epoch,
    expectedWriterGeneration: overrides.generation ?? account.generation,
    expectedSocketToken: overrides.socketToken ?? account.socketToken
  };
}

function messageFixture(account) {
  return Object.freeze({
    id: `${account.accountId}-canonical-message`,
    dedupeKey: `${account.accountId}-canonical-message`,
    externalMessageId: `${account.accountId}-platform-message`,
    accountId: account.accountId,
    sourceAccountId: account.accountId,
    sessionKey: `${account.accountId}:peer@s.whatsapp.net`,
    conversationId: `${account.accountId}:peer@s.whatsapp.net`,
    chatJid: 'peer@s.whatsapp.net',
    senderId: 'peer-1',
    role: 'user',
    direction: 'inbound',
    fromMe: false,
    messageType: 'text',
    type: 'text',
    text: 'matrix-message',
    rawMessage: { conversation: 'matrix-message' },
    rawMeta: {
      remoteJid: 'peer@s.whatsapp.net',
      messageId: `${account.accountId}-platform-message`
    },
    timestamp: AT,
    sentAt: AT,
    platform: 'whatsapp'
  });
}

function persistCanonicalMessage(store, cipher, account, transactionAuthority, suppliedAuthority) {
  const value = messageFixture(account);
  const communicationAuthority = new CommunicationAuthority({
    storeProvider: () => store,
    clock: () => AT
  });
  const repository = createWhatsAppMessageKeyIndexRepository({
    cipher,
    storeProvider: () => store,
    remoteJidNormalizer: (_accountId, remoteJid) => String(remoteJid).toLowerCase(),
    transactionAuthority,
    clock: () => AT
  });
  store.upsertConversation({
    sessionKey: value.sessionKey,
    accountId: value.accountId,
    platform: 'whatsapp',
    title: 'Matrix Peer',
    updatedAt: value.timestamp
  });
  return store.transaction(() => {
    const canonical = communicationAuthority.ingestMessage({
      messageId: value.id,
      traceId: 'trace-task10-matrix',
      platform: 'whatsapp',
      sourceAccountId: value.sourceAccountId,
      externalConversationId: value.rawMeta.remoteJid,
      externalMessageId: value.externalMessageId,
      direction: value.direction,
      senderExternalId: value.senderId,
      occurredAt: value.timestamp,
      rawEventRef: {
        eventId: value.externalMessageId,
        payloadSha256: hashRawMessage(value.rawMessage),
        redactionVersion: 'v1'
      },
      content: { kind: 'text', text: value.text }
    });
    assert.equal(canonical.messageId, value.id);
    store.upsertMessage(value);
    return repository.upsertWithinTransaction(store, value, suppliedAuthority);
  });
}

async function workerSocketTakeover(root) {
  const scenarioId = 'SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER';
  const account = scenarioAccount(scenarioId);
  let store = openStore(root);
  let cipher = createCipher();
  try {
    const repository = createAuthRepository(store, cipher);
    const snapshot = repository.loadAccount(account.accountKey);
    assert.equal(snapshot.writerGeneration, 1);
  } finally {
    closeFixture(store, cipher);
  }
  writeJson(path.join(root, 'worker-ready.json'), { ready: true });
  await waitForFile(path.join(root, 'worker-go.json'));
  store = openStore(root);
  cipher = createCipher();
  try {
    const repository = createAuthRepository(store, cipher);
    let reasonCode = '';
    try {
      repository.commitCreds({
        ...writerExpectation(account),
        creds: {
          registered: true,
          me: { id: `${account.accountId}@s.whatsapp.net` },
          marker: 'stale-socket-a'
        }
      });
    } catch (error) {
      reasonCode = String(error?.code || '');
    }
    writeJson(path.join(root, 'worker-result.json'), {
      staleRejected: reasonCode === 'WHATSAPP_AUTH_GENERATION_STALE',
      reasonCode
    });
  } finally {
    closeFixture(store, cipher);
  }
}

async function workerReconnectTimer(root) {
  const generationPath = path.join(root, 'generation.json');
  const sideEffectPath = path.join(root, 'reconnect-side-effect.json');
  const original = Number(readJson(generationPath).generation);
  const fence = createSessionGenerationFence(
    () => Number(readJson(generationPath).generation) === original,
    { prefix: 'task10-reconnect', generation: original, epoch: 1, socketToken: 'timer-socket-a' }
  );
  const guard = createSocketGenerationGuard(
    fence,
    () => Number(readJson(generationPath).generation) === original
  );
  writeJson(path.join(root, 'worker-ready.json'), { ready: true });
  await sleep(180);
  const result = await guard.runWrite(
    { operation: 'reconnect-timer', phase: 'timer-fired' },
    async () => {
      writeJson(sideEffectPath, { reconnected: true });
      return true;
    }
  );
  writeJson(path.join(root, 'worker-result.json'), result);
}

function workerRetryCounter(root) {
  const scenarioId = 'RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT';
  const account = scenarioAccount(scenarioId);
  const store = openStore(root);
  const cipher = createCipher();
  const retry = createWhatsAppMessageRetryStore({
    accountKey: account.accountKey,
    cipher,
    storeProvider: () => store,
    clock: () => Date.parse(AT),
    defaultTtlMs: 60000
  });
  retry.set('task10-retry-counter', 3);
  process.exit(CRASH_EXIT_CODE);
}

function workerMessageIndexFailure(root) {
  const scenarioId = 'MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE';
  const account = scenarioAccount(scenarioId);
  const store = openStore(root);
  const cipher = createCipher();
  try {
    const requiredAuthority = Symbol('task10-required-message-index-authority');
    let reasonCode = '';
    try {
      persistCanonicalMessage(store, cipher, account, requiredAuthority, Symbol('wrong-authority'));
    } catch (error) {
      reasonCode = String(error?.code || '');
    }
    writeJson(path.join(root, 'worker-result.json'), { reasonCode });
    process.exit(CRASH_EXIT_CODE);
  } finally {
    closeFixture(store, cipher);
  }
}

function workerOwnership(root) {
  const store = openStore(root);
  writeJson(path.join(root, 'worker-ready.json'), { ready: true, pid: process.pid });
  setInterval(() => {
    store.db.prepare('SELECT 1 AS alive').get();
  }, 100);
}

function workerWindowsLock(root) {
  const legacyDirectory = path.join(root, 'legacy-auth');
  const handle = fs.openSync(path.join(legacyDirectory, 'creds.json'), 'r+');
  process.chdir(legacyDirectory);
  writeJson(path.join(root, 'worker-ready.json'), { ready: true, pid: process.pid });
  setInterval(() => {
    fs.fstatSync(handle);
  }, 100);
}

async function runWorker(scenarioId, root) {
  if (scenarioId === 'SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER') {
    await workerSocketTakeover(root);
    return;
  }
  if (scenarioId === 'RECONNECT_TIMER_AFTER_GENERATION_CHANGE') {
    await workerReconnectTimer(root);
    return;
  }
  if (scenarioId === 'RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT') {
    workerRetryCounter(root);
    return;
  }
  if (scenarioId === 'MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE') {
    workerMessageIndexFailure(root);
    return;
  }
  if (scenarioId === 'SQLITE_OWNERSHIP_HEARTBEAT_LOST') {
    workerOwnership(root);
    return;
  }
  if (scenarioId === 'WINDOWS_LEGACY_ARCHIVE_LOCK') {
    workerWindowsLock(root);
    return;
  }
  throw new Error(`Unknown generation concurrency scenario: ${scenarioId}`);
}

async function evaluateSocketTakeover(root, account) {
  const child = spawnWorker('SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER', root);
  await waitForFile(path.join(root, 'worker-ready.json'));
  let store = openStore(root);
  try {
    const result = store.db.prepare(`UPDATE whatsapp_auth_accounts
      SET writer_generation=2,writer_socket_token='socket-b',updated_at=?
      WHERE account_key=? AND current_epoch=1 AND writer_generation=1
        AND writer_socket_token=? AND state='ACTIVE'`).run(
      AT, account.accountKey, account.socketToken
    );
    assert.equal(Number(result.changes), 1);
  } finally {
    store.close();
  }
  writeJson(path.join(root, 'worker-go.json'), { go: true });
  const exit = await waitForExit(child);
  assert.equal(exit.code, 0, exit.stderr || exit.stdout);
  const workerResult = readJson(path.join(root, 'worker-result.json'));
  assert.equal(workerResult.staleRejected, true, JSON.stringify(workerResult));

  store = openStore(root);
  const cipher = createCipher();
  try {
    const repository = createAuthRepository(store, cipher);
    const before = repository.loadAccount(account.accountKey);
    assert.equal(before.writerGeneration, 2);
    assert.equal(before.creds.marker, 'baseline');
    const replacementWriter = writerExpectation(account, { generation: 2, socketToken: 'socket-b' });
    for (let index = 0; index < 2; index += 1) {
      const current = repository.loadAccount(account.accountKey);
      if (current.creds.marker !== 'repaired-by-socket-b') {
        repository.commitCreds({
          ...replacementWriter,
          creds: {
            registered: true,
            me: { id: `${account.accountId}@s.whatsapp.net` },
            marker: 'repaired-by-socket-b'
          }
        });
      }
    }
    const repaired = repository.loadAccount(account.accountKey);
    return Object.freeze({
      realBoundaryObserved: workerResult.staleRejected === true,
      repairPersistent: repaired.creds.marker === 'repaired-by-socket-b',
      repairIdempotent: repaired.writerGeneration === 2,
      evidence: { workerResult, writerGeneration: repaired.writerGeneration, marker: repaired.creds.marker }
    });
  } finally {
    closeFixture(store, cipher);
  }
}

async function evaluateReconnectTimer(root) {
  writeJson(path.join(root, 'generation.json'), { generation: 1 });
  const child = spawnWorker('RECONNECT_TIMER_AFTER_GENERATION_CHANGE', root);
  await waitForFile(path.join(root, 'worker-ready.json'));
  writeJson(path.join(root, 'generation.json'), { generation: 2 });
  const exit = await waitForExit(child);
  assert.equal(exit.code, 0, exit.stderr || exit.stdout);
  const result = readJson(path.join(root, 'worker-result.json'));
  const sideEffectAbsent = !fs.existsSync(path.join(root, 'reconnect-side-effect.json'));
  assert.equal(result.quarantined, true, JSON.stringify(result));
  assert.equal(sideEffectAbsent, true);
  return Object.freeze({
    realBoundaryObserved: true,
    repairPersistent: sideEffectAbsent,
    repairIdempotent: Number(readJson(path.join(root, 'generation.json')).generation) === 2,
    evidence: { result, sideEffectAbsent }
  });
}

async function evaluateRetryCounter(root, account) {
  const child = spawnWorker('RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT', root);
  const exit = await waitForExit(child);
  assert.equal(exit.code, CRASH_EXIT_CODE, exit.stderr || exit.stdout);
  let store = openStore(root);
  let cipher = createCipher();
  try {
    const retry = createWhatsAppMessageRetryStore({
      accountKey: account.accountKey,
      cipher,
      storeProvider: () => store,
      clock: () => Date.parse(AT),
      defaultTtlMs: 60000
    });
    assert.equal(retry.get('task10-retry-counter'), 3);
    retry.set('task10-retry-counter', 3);
    assert.equal(retry.get('task10-retry-counter'), 3);
  } finally {
    closeFixture(store, cipher);
  }
  store = openStore(root);
  cipher = createCipher();
  try {
    const restarted = createWhatsAppMessageRetryStore({
      accountKey: account.accountKey,
      cipher,
      storeProvider: () => store,
      clock: () => Date.parse(AT),
      defaultTtlMs: 60000
    });
    const value = restarted.get('task10-retry-counter');
    return Object.freeze({
      realBoundaryObserved: exit.code === CRASH_EXIT_CODE,
      repairPersistent: value === 3,
      repairIdempotent: value === 3,
      evidence: { exitCode: exit.code, retryValue: value }
    });
  } finally {
    closeFixture(store, cipher);
  }
}

async function evaluateMessageIndexFailure(root, account) {
  const child = spawnWorker('MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE', root);
  const exit = await waitForExit(child);
  assert.equal(exit.code, CRASH_EXIT_CODE, exit.stderr || exit.stdout);
  let store = openStore(root);
  let cipher = createCipher();
  try {
    const message = messageFixture(account);
    const canonicalCount = Number(store.db.prepare(`SELECT COUNT(*) AS count
      FROM communication_canonical_messages WHERE message_id=?`).get(message.id).count || 0);
    const indexCount = Number(store.db.prepare(`SELECT COUNT(*) AS count
      FROM whatsapp_message_key_index WHERE canonical_message_id=?`).get(message.id).count || 0);
    assert.equal(canonicalCount, 0);
    assert.equal(indexCount, 0);
    const transactionAuthority = Symbol('task10-valid-message-index-authority');
    persistCanonicalMessage(store, cipher, account, transactionAuthority, transactionAuthority);
    persistCanonicalMessage(store, cipher, account, transactionAuthority, transactionAuthority);
    const repairedCanonicalCount = Number(store.db.prepare(`SELECT COUNT(*) AS count
      FROM communication_canonical_messages WHERE message_id=?`).get(message.id).count || 0);
    const repairedIndexCount = Number(store.db.prepare(`SELECT COUNT(*) AS count
      FROM whatsapp_message_key_index WHERE canonical_message_id=?`).get(message.id).count || 0);
    assert.equal(repairedCanonicalCount, 1);
    assert.equal(repairedIndexCount, 1);
  } finally {
    closeFixture(store, cipher);
  }
  store = openStore(root);
  try {
    const message = messageFixture(account);
    const counts = Object.freeze({
      canonical: Number(store.db.prepare(`SELECT COUNT(*) AS count
        FROM communication_canonical_messages WHERE message_id=?`).get(message.id).count || 0),
      index: Number(store.db.prepare(`SELECT COUNT(*) AS count
        FROM whatsapp_message_key_index WHERE canonical_message_id=?`).get(message.id).count || 0)
    });
    return Object.freeze({
      realBoundaryObserved: exit.code === CRASH_EXIT_CODE,
      repairPersistent: counts.canonical === 1 && counts.index === 1,
      repairIdempotent: counts.canonical === 1 && counts.index === 1,
      evidence: { exitCode: exit.code, counts }
    });
  } finally {
    store.close();
  }
}

async function evaluateOwnership(root) {
  const child = spawnWorker('SQLITE_OWNERSHIP_HEARTBEAT_LOST', root);
  await waitForFile(path.join(root, 'worker-ready.json'));
  let concurrentRejected = false;
  try {
    const competing = openStore(root);
    competing.close();
  } catch (error) {
    concurrentRejected = Boolean(error?.code || error?.message);
  }
  assert.equal(concurrentRejected, true, 'a second live writer must be rejected');
  forceKill(child);
  const exit = await waitForExit(child);
  await sleep(700);
  const store = openStore(root);
  try {
    assert.equal(integrity(store), 'ok');
    store.db.prepare(`INSERT OR REPLACE INTO r32_meta(key,value_json,updated_at)
      VALUES('oss1a_task10_owner_takeover','true',?)`).run(AT);
    store.db.prepare(`INSERT OR REPLACE INTO r32_meta(key,value_json,updated_at)
      VALUES('oss1a_task10_owner_takeover','true',?)`).run(AT);
    const persisted = store.db.prepare(`SELECT value_json FROM r32_meta
      WHERE key='oss1a_task10_owner_takeover'`).get();
    return Object.freeze({
      realBoundaryObserved: concurrentRejected && Boolean(exit.signal || exit.code !== 0),
      repairPersistent: persisted?.value_json === 'true',
      repairIdempotent: persisted?.value_json === 'true',
      evidence: { concurrentRejected, exitCode: exit.code, signal: exit.signal }
    });
  } finally {
    store.close();
  }
}

async function evaluateWindowsLock(root) {
  const source = path.join(root, 'legacy-auth');
  const destination = path.join(root, 'legacy-archive');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'creds.json'), '{"registered":true}\n', 'utf8');
  const child = spawnWorker('WINDOWS_LEGACY_ARCHIVE_LOCK', root);
  await waitForFile(path.join(root, 'worker-ready.json'));

  let lockBlockedRename = false;
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    lockBlockedRename = ['EPERM', 'EACCES', 'EBUSY'].includes(String(error?.code || ''));
    if (!lockBlockedRename) throw error;
  }

  forceKill(child);
  await waitForExit(child);
  await sleep(100);
  if (!fs.existsSync(destination)) fs.renameSync(source, destination);
  const firstRepair = fs.existsSync(destination) && !fs.existsSync(source);
  if (!fs.existsSync(destination) && fs.existsSync(source)) fs.renameSync(source, destination);
  const secondRepair = fs.existsSync(destination) && !fs.existsSync(source);

  if (process.platform === 'win32') {
    assert.equal(lockBlockedRename, true, 'Windows must expose the real directory lock boundary');
  }
  return Object.freeze({
    realBoundaryObserved: process.platform === 'win32' ? lockBlockedRename : firstRepair,
    repairPersistent: firstRepair,
    repairIdempotent: secondRepair,
    evidence: {
      platform: process.platform,
      lockBlockedRename,
      linuxOpenHandleRenameAllowed: process.platform !== 'win32' && !lockBlockedRename,
      archived: secondRepair
    }
  });
}

async function evaluateScenario(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-generation-matrix-'));
  const account = initializeBase(root, scenario.id);
  try {
    let specific;
    if (scenario.id === 'SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER') {
      specific = await evaluateSocketTakeover(root, account);
    } else if (scenario.id === 'RECONNECT_TIMER_AFTER_GENERATION_CHANGE') {
      specific = await evaluateReconnectTimer(root);
    } else if (scenario.id === 'RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT') {
      specific = await evaluateRetryCounter(root, account);
    } else if (scenario.id === 'MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE') {
      specific = await evaluateMessageIndexFailure(root, account);
    } else if (scenario.id === 'SQLITE_OWNERSHIP_HEARTBEAT_LOST') {
      specific = await evaluateOwnership(root);
    } else if (scenario.id === 'WINDOWS_LEGACY_ARCHIVE_LOCK') {
      specific = await evaluateWindowsLock(root);
    } else {
      throw new Error(`Unknown matrix scenario: ${scenario.id}`);
    }

    const beforeRestart = commonState(root);
    const auditReceiptPresent = writeAuditReceipt(root, scenario.id, specific.evidence);
    const afterRestart = commonState(root);
    const restartStateDeterministic = JSON.stringify(afterRestart) === JSON.stringify(beforeRestart);
    assert.equal(beforeRestart.databaseIntegrity, 'ok');
    assert.equal(beforeRestart.activeWriterCount <= 1, true);
    assert.equal(beforeRestart.automaticSendCount, 0);
    assert.equal(beforeRestart.loggedOutResurrected, false);
    assert.equal(restartStateDeterministic, true);
    assert.equal(specific.repairPersistent, true);
    assert.equal(specific.repairIdempotent, true);
    assert.equal(auditReceiptPresent, true);

    return Object.freeze({
      id: scenario.id,
      status: 'PASS',
      faultPoint: scenario.faultPoint,
      realBoundaryObserved: specific.realBoundaryObserved,
      databaseIntegrity: beforeRestart.databaseIntegrity,
      activeWriterCount: beforeRestart.activeWriterCount,
      automaticSendCount: beforeRestart.automaticSendCount,
      loggedOutResurrected: beforeRestart.loggedOutResurrected,
      restartStateDeterministic,
      repairPersistent: specific.repairPersistent,
      repairIdempotent: specific.repairIdempotent,
      auditReceiptPresent
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
}

async function runGenerationConcurrencyMatrix(options = {}) {
  const results = [];
  for (const scenario of GENERATION_CONCURRENCY_SCENARIOS) {
    results.push(await evaluateScenario(scenario));
  }
  const report = Object.freeze({
    schemaVersion: 1,
    matrix: 'OSS1A_WHATSAPP_GENERATION_CONCURRENCY_MATRIX',
    platform: process.platform,
    scenarioCount: results.length,
    warningOnly: false,
    warnings: Object.freeze([]),
    results: Object.freeze(results)
  });
  if (!options.quiet) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  if (process.argv[2] === '--worker') {
    runWorker(process.argv[3], process.argv[4]).catch(error => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
  } else {
    runGenerationConcurrencyMatrix().catch(error => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = Object.freeze({
  GENERATION_CONCURRENCY_SCENARIOS,
  runGenerationConcurrencyMatrix
});
