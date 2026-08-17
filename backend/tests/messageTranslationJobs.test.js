'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MessageTranslationService } = require('../services/messageTranslationService');
const { DurableInternalOperationAuthority } = require('../services/durableInternalOperationAuthority');
const { applyBatch41Fix6MArchitectureReferenceClosure } = require('../migrations/batch41Fix6MArchitectureReferenceClosure');
const { applyArchitectureClosureV2WpA } = require('../migrations/architectureClosureV2WpA');
const { applyArchitectureClosureV2WpB } = require('../migrations/architectureClosureV2WpB');

function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function withDurableStore(message, work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-translation-job-schema23-'));
  const db = new DatabaseSync(path.join(root, 'authority.db'));
  let transactionDepth = 0;
  const rows = new Map([[message.id, { ...message }]]);
  const store = {
    db,
    transaction(callback) {
      if (transactionDepth > 0) return callback();
      db.exec('BEGIN IMMEDIATE');
      transactionDepth += 1;
      try {
        const value = callback();
        if (value && typeof value.then === 'function') throw new Error('async transaction forbidden');
        db.exec('COMMIT');
        return value;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    getMessage(id) { return rows.get(id) || null; },
    upsertMessage(input) { rows.set(input.id, { ...input }); return input.id; },
    rows
  };
  db.exec(`CREATE TABLE r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  applyBatch41Fix6MArchitectureReferenceClosure(db);
  applyArchitectureClosureV2WpA(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-17T12:00:00.000Z' });
  db.prepare(`INSERT INTO authority_write_host_lease(
    singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
    host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
    acquired_at,heartbeat_at,updated_at
  ) VALUES(1,'translation-test-host',1234,'translation-test','nonce',7,19,
    'ACTIVE',?,?,?,?,?)`).run(
    Date.parse('2026-08-17T12:00:00.000Z'),
    Date.parse('2026-08-17T12:00:00.000Z'),
    '2026-08-17T12:00:00.000Z',
    '2026-08-17T12:00:00.000Z',
    '2026-08-17T12:00:00.000Z'
  );
  let sequence = 0;
  const authority = new DurableInternalOperationAuthority({
    storeProvider: () => store,
    tokenProvider: () => Object.freeze({
      instanceId: 'translation-test-host',
      hostGeneration: 7,
      fencingToken: 19
    }),
    clock: () => new Date(Date.parse('2026-08-17T12:01:00.000Z') + (sequence++ * 1000)).toISOString(),
    idFactory: prefix => `${prefix}-translation-test-${sequence}`,
    leaseMs: 120000
  });
  const cleanup = () => {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  try {
    const value = work({ store, authority });
    return value && typeof value.then === 'function' ? value.finally(cleanup) : (cleanup(), value);
  } catch (error) {
    cleanup();
    throw error;
  }
}

function serviceOptions(store, authority, extra = {}) {
  return {
    storeProvider: () => store,
    internalOperationAuthorityProvider: () => authority,
    contactLanguageAuthority: { observeMessage() {} },
    logger: { warn() {} },
    ...extra
  };
}

function fakeStore(message) {
  const rows = new Map([[message.id, { ...message }]]);
  return {
    getMessage(id) { return rows.get(id) || null; },
    upsertMessage(input) { rows.set(input.id, { ...input }); return input.id; },
    rows
  };
}

test('translation jobs expose progress and persist a successful bilingual result', () => withDurableStore(
  { id: 'm1', sessionKey: 'conv1', contactId: 'c1', text: 'Guten Morgen', language: 'de' },
  async ({ store, authority }) => {
  const service = new MessageTranslationService(serviceOptions(store, authority, {
    bilingualUnderstandingService: {
      async translateToChinese(input) {
        assert.equal(input.text, 'Guten Morgen');
        assert.ok(input.signal);
        await new Promise(resolve => setTimeout(resolve, 20));
        return {
          sourceText: input.text,
          sourceLanguage: 'de',
          translatedZh: '早上好',
          translationStatus: 'success',
          translationModel: 'translategemma:4b',
          translatedAt: '2026-07-20T00:00:00.000Z',
          translationErrorCode: '',
          translationError: ''
        };
      }
    }
  }));
  const job = service.createJob('m1', { force: true });
  assert.equal(job.status, 'queued');
  const completed = await waitFor(() => {
    const row = service.getJob(job.id);
    return row && !['queued', 'running'].includes(row.status) ? row : null;
  });
  assert.equal(completed.status, 'success');
  assert.equal(completed.progress, 100);
  assert.equal(store.getMessage('m1').translatedZh, '早上好');
  assert.equal(store.getMessage('m1').translationStatus, 'success');
  service.close();
}));

test('a running translation job can be cancelled without deleting the source text', () => withDurableStore(
  { id: 'm2', sessionKey: 'conv2', contactId: 'c2', text: 'Wie geht es dir?', language: 'de' },
  async ({ store, authority }) => {
  const service = new MessageTranslationService(serviceOptions(store, authority, {
    bilingualUnderstandingService: {
      translateToChinese(input) {
        return new Promise(resolve => {
          input.signal.addEventListener('abort', () => resolve({ translationStatus: 'failed', translationErrorCode: 'ABORTED', translationError: 'aborted' }), { once: true });
        });
      }
    }
  }));
  const job = service.createJob('m2', { force: true });
  await waitFor(() => service.getJob(job.id)?.status === 'running');
  const cancelled = service.cancelJob(job.id);
  assert.equal(cancelled.status, 'cancelled');
  await waitFor(() => store.getMessage('m2').translationStatus === 'cancelled');
  assert.equal(store.getMessage('m2').text, 'Wie geht es dir?');
  assert.equal(store.getMessage('m2').translationErrorCode, 'TRANSLATION_CANCELLED');
  service.close();
}));

test('an unavailable translation model finishes as failed and remains retryable', () => withDurableStore(
  { id: 'm3', sessionKey: 'conv3', contactId: 'c3', text: 'Hello', language: 'en' },
  async ({ store, authority }) => {
  const service = new MessageTranslationService(serviceOptions(store, authority, {
    bilingualUnderstandingService: {
      async translateToChinese() {
        return { translationStatus: 'unavailable', translationError: 'no route' };
      }
    }
  }));
  const job = service.createJob('m3', { force: true });
  const completed = await waitFor(() => {
    const row = service.getJob(job.id);
    return row && !['queued', 'running'].includes(row.status) ? row : null;
  });
  assert.equal(completed.status, 'failed');
  assert.equal(completed.errorCode, 'TRANSLATION_MODEL_UNAVAILABLE');
  assert.equal(store.getMessage('m3').translationStatus, 'failed');
  service.close();
}));

test('a failed forced refresh preserves the last successful Chinese translation', async () => {
  const store = fakeStore({
    id: 'm4', sessionKey: 'conv4', contactId: 'c4', text: 'Hallo', language: 'de',
    sourceText: 'Hallo', translatedZh: '你好', translationStatus: 'success',
    translationModel: 'old-model', translatedAt: '2026-07-20T00:00:00.000Z'
  });
  const service = new MessageTranslationService({
    storeProvider: () => store,
    contactLanguageAuthority: { observeMessage() {} },
    bilingualUnderstandingService: {
      async translateToChinese() {
        return { translationStatus: 'failed', translationErrorCode: 'OFFLINE', translationError: 'offline' };
      }
    },
    logger: { warn() {} }
  });
  const result = await service.translateMessage('m4', { force: true });
  assert.equal(result.status, 'failed');
  assert.equal(store.getMessage('m4').translatedZh, '');
  assert.equal(store.getMessage('m4').lastSuccessfulTranslatedZh, '你好');
  assert.equal(store.getMessage('m4').lastSuccessfulTranslationModel, 'old-model');
  assert.equal(store.getMessage('m4').lastSuccessfulTranslatedAt, '2026-07-20T00:00:00.000Z');
  service.close();
});

test('a new create request after a terminal job gets a new durable operation identity', () => withDurableStore(
  { id: 'm5', sessionKey: 'conv5', contactId: 'c5', text: 'Bonjour', language: 'fr' },
  async ({ store, authority }) => {
    const service = new MessageTranslationService(serviceOptions(store, authority, {
      bilingualUnderstandingService: {
        async translateToChinese(input) {
          return {
            sourceText: input.text,
            sourceLanguage: 'fr',
            translatedZh: '你好',
            translationStatus: 'success',
            translationModel: 'translation-test',
            translatedAt: '2026-08-17T12:10:00.000Z'
          };
        }
      }
    }));
    const first = service.createJob('m5');
    const completed = await waitFor(() => service.getJob(first.id)?.durableState === 'SUCCEEDED' ? service.getJob(first.id) : null);
    assert.equal(completed.status, 'success');
    const second = service.createJob('m5');
    assert.notEqual(second.id, first.id);
    assert.equal(second.durableState, 'SUCCEEDED');
    assert.equal(second.status, 'success');
    service.close();
  }
));
