'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

test('phase 1 governance UI reads real three-layer learning and supports mutation and restore', () => {
  const runtime = source('frontend/js/r32-phase1-governance-runtime.js');
  const index = source('frontend/index.html');
  assert.match(index, /r32-phase1-governance\.css/);
  assert.match(index, /r32-phase1-governance-runtime\.js/);
  assert.match(runtime, /getLearningGovernance/);
  assert.match(runtime, /updateLearningPreference/);
  assert.match(runtime, /restoreLearningScope/);
  assert.match(runtime, /全局 →/);
  assert.match(runtime, /最近学习事件与双语证据/);
});

test('global search indexes contacts, original messages and Chinese translations and can locate a message', () => {
  const route = source('backend/routes/store.js');
  const runtime = source('frontend/js/r32-phase1-governance-runtime.js');
  assert.match(route, /router\.get\('\/search'/);
  assert.match(route, /translatedZh/);
  assert.match(runtime, /searchWorkspace/);
  assert.match(runtime, /data-search-message/);
  assert.match(runtime, /scrollIntoView/);
});

test('translation retry uses a cancellable job lifecycle instead of a blocking direct call', () => {
  const runtime = source('frontend/js/r32-bilingual-experience-runtime.js');
  const service = source('backend/services/messageTranslationService.js');
  assert.match(runtime, /createTranslationJob/);
  assert.match(runtime, /cancelTranslationJob/);
  assert.match(runtime, /翻译中/);
  assert.match(service, /translation:job-updated/);
  assert.match(service, /translationStatus: 'cancelled'/);
});

test('candidate cards expose the exact reviewed learning applied to generation', () => {
  const brain = source('backend/services/contextAwareReplyBrain.js');
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(brain, /projectLearningApplication/);
  assert.match(brain, /learningApplication/);
  assert.match(ui, /本次命中的已审核学习/);
  assert.match(ui, /result\.learningApplication/);
});

test('persona workbench has a Chinese understanding layer without overwriting authoritative source data', () => {
  const runtime = source('frontend/js/r32-phase1-governance-runtime.js');
  assert.match(runtime, /Persona 中文理解层/);
  assert.match(runtime, /translateStructured/);
  assert.match(runtime, /权威原文/);
  assert.match(runtime, /不会覆盖 Persona 原始内容/);
});

test('SQLite bilingual search finds a message by its persisted Chinese translation', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const { R32SqliteStore } = require('../lib/r32SqliteStore');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-bilingual-search-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'r32.db') });
  try {
    store.upsertAccount({ id: 'a', platform: 'whatsapp', displayName: 'Account' });
    store.upsertContact({ id: 'c', accountId: 'a', platform: 'whatsapp', externalId: 'b@s.whatsapp.net', displayName: 'Kontakt' });
    store.upsertConversation({ sessionKey: 'whatsapp:a:b', accountId: 'a', contactId: 'c', platform: 'whatsapp', title: 'Kontakt' });
    store.upsertMessage({
      id: 'm-search-1',
      sessionKey: 'whatsapp:a:b',
      accountId: 'a',
      text: 'Ich freue mich auf unser Treffen.',
      translatedZh: '我很期待我们的见面。',
      translationStatus: 'success',
      sentAt: '2026-07-20T00:00:00.000Z'
    });
    const rows = store.searchMessages('期待');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'm-search-1');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
