'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workspace = require('../services/workspaceService');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('workspace contact summary exposes original and Chinese translation from the latest message', () => {
  const result = workspace.latestMessageSnippet([
    { id: 'old', text: 'Alt', translatedZh: '旧消息', sentAt: '2026-07-25T00:00:00Z' },
    { id: 'latest', text: 'Ich komme aus Österreich', translatedZh: '我来自奥地利', translationStatus: 'success', sentAt: '2026-07-25T00:01:00Z' }
  ]);
  assert.equal(result.snippetOriginal, 'Ich komme aus Österreich');
  assert.equal(result.snippetZh, '我来自奥地利');
  assert.equal(result.snippetMessageId, 'latest');
  assert.equal(result.snippetTranslationStatus, 'success');
});

test('conversation production UI is wired to bilingual contact summaries', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /function contactSnippetText\(/);
  assert.match(source, /contactSearchText\(c\)/);
  assert.match(source, /snippetZh/);
  assert.match(source, /setTranslationMode\([\s\S]*renderContacts\(\)/);
  const translationHandler = source.slice(source.indexOf("if(event?.type==='message:translation-updated')"), source.indexOf("if(event?.type==='conversation:merged')"));
  assert.match(translationHandler, /platformRefreshCoordinator\?\.schedule/);
  assert.doesNotMatch(translationHandler, /refreshConversationSummaries/);
  assert.match(translationHandler, /mediaPatchReloadCoordinator\?\.schedule/);
  assert.doesNotMatch(translationHandler, /updateContactSnippetFromMessage/);
});

test('understanding state cannot complete without intent, need, evidence and strategy', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /function analysisCompleteness\(/);
  assert.match(source, /missing\.push\('核心意图'\)/);
  assert.match(source, /missing\.push\('隐含需求'\)/);
  assert.match(source, /missing\.push\('可追溯证据'\)/);
  assert.match(source, /missing\.push\('策略判断'\)/);
  assert.doesNotMatch(source, /\['策略判断',analysis\.strategy\?\.title\|\|analysis\.strategy\|\|'已完成'\]/);
  assert.match(source, /completeness\.strategy\|\|'未计算'/);
});

test('composer exposes automatic Chinese-to-contact-language send status', () => {
  const html = read('frontend/index.html');
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(html, /id="composerTranslationChip"/);
  assert.match(html, /id="composerTranslationTitle"/);
  assert.match(source, /outbound-language/);
  assert.match(source, /只向对方发送/);
  assert.match(source, /目标语言待确认/);
});

test('contact context menu is reduced to open, pin and archive', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  const start = source.indexOf('function showContactContextMenu(contact,event){');
  const end = source.indexOf('\nfunction updateOnlineFilterAvailability', start);
  const menu = source.slice(start, end);
  assert.match(menu, /data-contact-action="open"/);
  assert.match(menu, /data-contact-action="pin"/);
  assert.match(menu, /data-contact-action="archive"/);
  for (const forbidden of ['profile', 'identity', 'timeline', 'insights', 'unread', 'priority', 'mute', 'tag', 'note', 'copy']) {
    assert.doesNotMatch(menu, new RegExp(`data-contact-action="${forbidden}"`));
  }
});

test('AI workbench distinguishes enabled, configured and operational routes', () => {
  const source = read('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(source, /configuredRoutes/);
  assert.match(source, /operationalRoutes/);
  assert.match(source, /blockedRoutes/);
  assert.doesNotMatch(source, /operational=r\.operational===true\|\|\(requestedEnabled&&configured\)/);
});

test('reply brain cannot become candidate-ready without director and commercially qualified translation', () => {
  const source = read('backend/services/replyBrainModelAuthority.js');
  assert.match(source, /candidateGenerationReady = quick\.primaryUsable && quick\.fallbackUsable/u);
  assert.match(source, /director\.primaryUsable && director\.fallbackUsable/u);
  assert.match(source, /&& translation\.pass/u);
  assert.match(source, /qualifyingTasks\.includes\('translation'\)/);
  assert.match(source, /missing\.push\('导演备用模型'\)/);
});
