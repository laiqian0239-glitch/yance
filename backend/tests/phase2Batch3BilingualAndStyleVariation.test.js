'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../../frontend/js/r32-bilingual-presentation-runtime.js');
const root = path.resolve(__dirname, '../..');

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('localizedPair keeps Chinese primary and foreign original together', () => {
  const pair = runtime.localizedPair({
    summary: 'Respond warmly and keep the meeting plan concrete.',
    chineseUnderstanding: { summary: '温暖回应，并把见面计划说得具体。' },
    translationStatus: 'success',
    translationModel: 'translategemma:4b'
  }, 'summary');
  assert.equal(pair.primaryZh, '温暖回应，并把见面计划说得具体。');
  assert.equal(pair.original, 'Respond warmly and keep the meeting plan concrete.');
  assert.equal(pair.hasTranslation, true);
  assert.equal(pair.model, 'translategemma:4b');
});

test('style variation comparison rejects identical output and accepts real rewrites', () => {
  const original = 'Das klingt schön. Ich würde dich auch gern besser kennenlernen.';
  assert.equal(runtime.isMeaningfullyDifferent(original, original), false);
  assert.ok(runtime.textSimilarity(original, original) > 0.99);
  const rewritten = 'Oh, das macht mich neugierig – erzähl mir mehr, wann wir uns sehen könnten 😉';
  assert.equal(runtime.isMeaningfullyDifferent(original, rewritten), true);
});

test('sources expose bilingual insight originals and verified style tuning', () => {
  const insights = source('frontend/js/r32-insights-runtime.js');
  const ui = source('frontend/js/r32-ui-runtime.js');
  const index = source('frontend/index.html');
  assert.match(index, /r32-bilingual-presentation-runtime\.js/);
  assert.match(insights, /rawT/);
  assert.match(insights, /insight29-original/);
  assert.match(ui, /STYLE_VARIATION_NOT_APPLIED/);
  assert.match(ui, /严格重写要求/);
  assert.match(ui, /candidate-style-proof/);
  assert.match(ui, /中文回译正在生成|中文回译失败/);
});
