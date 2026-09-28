'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PRODUCT = path.join(ROOT, 'integration/element-module/src/product-experience/ProductConversationProjection.tsx');
const INDEX = path.join(ROOT, 'integration/element-module/src/index.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css');
const OWNER = path.join(ROOT, 'backend/services/outboundTranslationAuthority.js');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('M05 exposes approved send-language hint and expandable translation preview states', () => {
  const source = read(PRODUCT);
  for (const marker of [
    '发送语言', '查看预览', '翻译预览', '原文', '检查并继续',
    '目标语言已确认', '完整性校验已通过',
  ]) assert.ok(source.includes(marker), `missing M05 UI marker: ${marker}`);
  assert.match(source, /targetLanguage/u);
  assert.match(source, /translationApplied/u);
  assert.match(source, /setPreviewExpanded/u);
});

test('M05 preview is powered by mature outbound prepare and fail-closed errors remain visible', () => {
  const source = read(PRODUCT), owner = read(OWNER);
  assert.match(source, /prepareOutboundMessage/u);
  assert.match(source, /发送已阻止/u);
  assert.match(source, /reasonCode|error\.code|error instanceof Error/u);
  assert.match(owner, /integrityResult/u);
  assert.match(owner, /OUTBOUND_TRANSLATION_LANGUAGE_MISMATCH/u);
  assert.match(owner, /OUTBOUND_TRANSLATION_INTEGRITY_FAILED/u);
  assert.match(owner, /已阻止发送/u);
  assert.doesNotMatch(source, /sendMessage\(|sendEvent\(/u);
});

test('M05 actual send still re-enters canonical Element outbound prepare before physical send', () => {
  const source = read(INDEX);
  assert.match(source, /registerOutgoingMessagePrepare/u);
  assert.match(source, /desktop\.prepareOutboundMessage/u);
  assert.match(source, /PRODUCT_OUTBOUND_PREPARE_FAILED/u);
  assert.match(source, /prepared\.translationApplied === true/u);
  assert.doesNotMatch(source, /matrixClient\.send|sendEvent\(/u);
});

test('M05 styling provides compact hint plus modal-like preview without hiding the composer', () => {
  const css = read(CSS);
  for (const marker of [
    '.yance-translation-hint', '.yance-translation-preview',
    '.yance-translation-preview__body', '.yance-translation-preview__checks',
  ]) assert.ok(css.includes(marker), `missing M05 CSS marker: ${marker}`);
});
