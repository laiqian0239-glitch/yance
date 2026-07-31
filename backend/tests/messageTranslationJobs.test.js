'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageTranslationService } = require('../services/messageTranslationService');

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

function fakeStore(message) {
  const rows = new Map([[message.id, { ...message }]]);
  return {
    getMessage(id) { return rows.get(id) || null; },
    upsertMessage(input) { rows.set(input.id, { ...input }); return input.id; },
    rows
  };
}

test('translation jobs expose progress and persist a successful bilingual result', async () => {
  const store = fakeStore({ id: 'm1', sessionKey: 'conv1', contactId: 'c1', text: 'Guten Morgen', language: 'de' });
  const service = new MessageTranslationService({
    storeProvider: () => store,
    contactLanguageAuthority: { observeMessage() {} },
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
    },
    logger: { warn() {} }
  });
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
});

test('a running translation job can be cancelled without deleting the source text', async () => {
  const store = fakeStore({ id: 'm2', sessionKey: 'conv2', contactId: 'c2', text: 'Wie geht es dir?', language: 'de' });
  const service = new MessageTranslationService({
    storeProvider: () => store,
    contactLanguageAuthority: { observeMessage() {} },
    bilingualUnderstandingService: {
      translateToChinese(input) {
        return new Promise(resolve => {
          input.signal.addEventListener('abort', () => resolve({ translationStatus: 'failed', translationErrorCode: 'ABORTED', translationError: 'aborted' }), { once: true });
        });
      }
    },
    logger: { warn() {} }
  });
  const job = service.createJob('m2', { force: true });
  await waitFor(() => service.getJob(job.id)?.status === 'running');
  const cancelled = service.cancelJob(job.id);
  assert.equal(cancelled.status, 'cancelled');
  await waitFor(() => store.getMessage('m2').translationStatus === 'cancelled');
  assert.equal(store.getMessage('m2').text, 'Wie geht es dir?');
  assert.equal(store.getMessage('m2').translationErrorCode, 'TRANSLATION_CANCELLED');
  service.close();
});

test('an unavailable translation model finishes as failed and remains retryable', async () => {
  const store = fakeStore({ id: 'm3', sessionKey: 'conv3', contactId: 'c3', text: 'Hello', language: 'en' });
  const service = new MessageTranslationService({
    storeProvider: () => store,
    contactLanguageAuthority: { observeMessage() {} },
    bilingualUnderstandingService: {
      async translateToChinese() {
        return { translationStatus: 'unavailable', translationError: 'no route' };
      }
    },
    logger: { warn() {} }
  });
  const job = service.createJob('m3', { force: true });
  const completed = await waitFor(() => {
    const row = service.getJob(job.id);
    return row && !['queued', 'running'].includes(row.status) ? row : null;
  });
  assert.equal(completed.status, 'failed');
  assert.equal(completed.errorCode, 'TRANSLATION_MODEL_UNAVAILABLE');
  assert.equal(store.getMessage('m3').translationStatus, 'failed');
  service.close();
});

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
