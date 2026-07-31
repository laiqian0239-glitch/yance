'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-ai-translation-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
const workspaceRepository = require('../repositories/workspaceRepository');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { closeStore } = require('../repositories/storeProvider');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`condition not met within ${timeoutMs}ms`);
    await delay(5);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function translatedBundle() {
  return {
    modelId: 'translation-model',
    model: 'Translation Model',
    structured: {
      analysis: { summary: '客户希望下周见面。' },
      profile: { facts: { city: 'Berlin' } },
      insights: { nextAction: '确认合适日期。' }
    }
  };
}

function insertConversation(store) {
  const at = '2026-07-30T00:00:00.000Z';
  store.upsertAccount({
    id: 'account-analysis',
    accountId: 'account-analysis',
    adapterAccountId: 'account-analysis',
    platform: 'facebook',
    state: 'online',
    canSend: true,
    canReceive: true
  });
  store.upsertContact({
    id: 'contact-analysis',
    accountId: 'account-analysis',
    platform: 'facebook',
    externalId: 'peer-analysis',
    canonicalContactId: 'contact-analysis',
    displayName: 'Analysis Contact'
  });
  store.upsertConversation({
    sessionKey: 'conversation-analysis',
    accountId: 'account-analysis',
    contactId: 'contact-analysis',
    platform: 'facebook',
    title: 'Analysis Contact',
    routeState: 'ready',
    version: 1
  });
  store.upsertMessage({
    id: 'message-analysis-1',
    sessionKey: 'conversation-analysis',
    conversationId: 'conversation-analysis',
    accountId: 'account-analysis',
    contactId: 'contact-analysis',
    senderId: 'peer-analysis',
    role: 'contact',
    direction: 'inbound',
    messageType: 'text',
    text: 'Ich möchte dich nächste Woche treffen.',
    sentAt: at
  });
}

function analysisResult() {
  return {
    modelId: 'understanding-model',
    model: 'Understanding Model',
    structured: {
      analysis: {
        summary: '对方希望下周见面。',
        evidence: [{
          messageId: 'message-analysis-1',
          quote: 'Ich möchte dich nächste Woche treffen.',
          translatedZh: '我想下周见你。'
        }]
      },
      profile: { confirmedFacts: [], inferredFacts: [] },
      insights: {
        summary: '对方提出见面。',
        relationshipStage: '初识',
        evidence: [{
          messageId: 'message-analysis-1',
          quote: 'Ich möchte dich nächste Woche treffen.'
        }]
      }
    }
  };
}

function fixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  insertConversation(store);
  return {
    store,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('translation rejects a result that resolves after its AbortSignal is cancelled', async () => {
  const call = deferred();
  let started = false;
  const controller = new AbortController();
  const pending = socialChineseUnderstandingService.translateBundle({
    analysis: { summary: 'The customer wants to meet next week.' },
    profile: { facts: { city: 'Berlin' } },
    insights: { nextAction: 'Confirm a suitable day.' },
    signal: controller.signal
  }, {
    aiGateway: {
      execute: async input => {
        started = true;
        assert.equal(input.signal, controller.signal);
        return call.promise;
      }
    }
  });

  await waitFor(() => started);
  controller.abort(Object.assign(new Error('analysis cancelled'), {
    code: 'AI_ANALYSIS_CANCELLED'
  }));
  call.resolve(translatedBundle());

  await assert.rejects(pending, error => error.code === 'AI_ANALYSIS_CANCELLED');
});

test('translation rejects a result from a superseded generation', async () => {
  const call = deferred();
  let current = true;
  let started = false;
  const pending = socialChineseUnderstandingService.translateBundle({
    analysis: { summary: 'The customer wants to meet next week.' },
    profile: {},
    insights: {},
    assertCurrent() {
      if (!current) {
        throw Object.assign(new Error('analysis generation is stale'), {
          code: 'AI_STALE_RESULT'
        });
      }
    }
  }, {
    aiGateway: {
      execute: async () => {
        started = true;
        return call.promise;
      }
    }
  });

  await waitFor(() => started);
  current = false;
  call.resolve(translatedBundle());

  await assert.rejects(pending, error => error.code === 'AI_STALE_RESULT');
});

test('workspace abort during Chinese translation cannot commit a completed analysis', async () => {
  const f = fixture('yance-b39-workspace-translation-abort-');
  const controller = new AbortController();
  const originalTranslate = socialChineseUnderstandingService.translateBundle;
  socialChineseUnderstandingService.translateBundle = async payload => {
    controller.abort(Object.assign(new Error('analysis cancelled during translation'), {
      code: 'AI_ANALYSIS_CANCELLED'
    }));
    return {
      translated: {
        analysis: payload.analysis,
        profile: payload.profile,
        insights: payload.insights
      },
      translationStatus: 'success',
      translationModel: 'test-translator',
      translatedAt: '2026-07-30T00:01:00.000Z'
    };
  };
  try {
    await assert.rejects(
      workspaceRepository.analyzeConversation('conversation-analysis', {
        store: f.store,
        signal: controller.signal,
        deterministicFacts: { facts: [], profileFacts: {}, recurringInterests: [], persisted: false },
        executor: async () => analysisResult()
      }),
      error => error.code === 'AI_ANALYSIS_CANCELLED'
    );
    const run = f.store.db.prepare(
      'SELECT status FROM ai_analysis_runs ORDER BY started_at DESC LIMIT 1'
    ).get();
    assert.notEqual(run.status, 'completed');
    assert.equal(
      Number(f.store.db.prepare('SELECT COUNT(*) AS count FROM relationship_insights').get().count),
      0
    );
  } finally {
    socialChineseUnderstandingService.translateBundle = originalTranslate;
    f.close();
  }
});

test('workspace rechecks source generation inside the final persistence transaction', async () => {
  const f = fixture('yance-b39-workspace-final-transaction-');
  const originalTranslate = socialChineseUnderstandingService.translateBundle;
  const originalTransaction = f.store.transaction.bind(f.store);
  let injectBeforeNextTransaction = false;
  socialChineseUnderstandingService.translateBundle = async payload => {
    injectBeforeNextTransaction = true;
    return {
      translated: {
        analysis: payload.analysis,
        profile: payload.profile,
        insights: payload.insights
      },
      translationStatus: 'success',
      translationModel: 'test-translator',
      translatedAt: '2026-07-30T00:01:00.000Z'
    };
  };
  f.store.transaction = callback => {
    if (injectBeforeNextTransaction) {
      injectBeforeNextTransaction = false;
      f.store.upsertMessage({
        id: 'message-analysis-2',
        sessionKey: 'conversation-analysis',
        conversationId: 'conversation-analysis',
        accountId: 'account-analysis',
        contactId: 'contact-analysis',
        senderId: 'peer-analysis',
        role: 'contact',
        direction: 'inbound',
        messageType: 'text',
        text: 'Ich habe den Termin geändert.',
        sentAt: '2026-07-30T00:02:00.000Z'
      });
    }
    return originalTransaction(callback);
  };
  try {
    await assert.rejects(
      workspaceRepository.analyzeConversation('conversation-analysis', {
        store: f.store,
        deterministicFacts: { facts: [], profileFacts: {}, recurringInterests: [], persisted: false },
        executor: async () => analysisResult()
      }),
      error => error.code === 'AI_STALE_RESULT' && error.reason === 'MESSAGE_COUNT_CHANGED'
    );
    const run = f.store.db.prepare(
      'SELECT status FROM ai_analysis_runs ORDER BY started_at DESC LIMIT 1'
    ).get();
    assert.equal(run.status, 'superseded');
    assert.equal(
      Number(f.store.db.prepare('SELECT COUNT(*) AS count FROM relationship_insights').get().count),
      0
    );
  } finally {
    f.store.transaction = originalTransaction;
    socialChineseUnderstandingService.translateBundle = originalTranslate;
    f.close();
  }
});
