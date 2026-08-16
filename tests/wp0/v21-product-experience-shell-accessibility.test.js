'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function readOrEmpty(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function source() {
  return [
    'PeopleSurface.tsx',
    'ProductComposerAccessory.tsx',
    'ProductExperienceShell.tsx',
    'RelationshipAssistant.tsx',
    'RelationshipOverlayHost.tsx',
    'RelationshipWorld.tsx',
    'RiveRelationshipCompanion.tsx',
    'experiencePreferences.ts',
    'experienceSound.ts'
  ].map((name) => readOrEmpty(`integration/element-module/src/product-experience/${name}`)).join('\n');
}

test('Base UI is the focus dismissal and popup primitive authority', () => {
  const product = source();
  assert.match(product, /@base-ui\/react/u);
  assert.match(product, /\bDialog\b|\bPopover\b|\bDrawer\b/u);
  assert.doesNotMatch(product, /addEventListener\s*\(\s*["']keydown["'][^)]*Escape/iu);
});

test('Reduced motion is explicit and keeps controls usable with Chinese visible Rive state labels', () => {
  const product = source();
  const css = readOrEmpty('integration/element-module/src/product-experience/ProductExperienceShell.css');
  const rive = readOrEmpty('integration/element-module/src/product-experience/RiveRelationshipCompanion.tsx');
  assert.match(product, /useReducedMotion|prefers-reduced-motion/u);
  assert.match(`${product}\n${css}`, /reduced[- ]motion|prefers-reduced-motion/iu);
  assert.doesNotMatch(product, /setInterval\s*\(/u);
  assert.match(rive, /RELATIONSHIP_STATE_LABELS/u);
  for (const label of ['静默', '唤醒', '倾听', '思考', '就绪', '表达', '异常']) {
    assert.match(rive, new RegExp(label, 'u'));
  }
  assert.match(rive, /RELATIONSHIP_STATE_LABELS\[state\]/u);
  assert.match(rive, /!reducedMotion\s*&&\s*!failed\s*\?\s*<RiveComponent/u);
});

test('Keyboard focus and screen-reader state feedback are visible', () => {
  const product = source();
  const css = readOrEmpty('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(css, /:focus-visible/u);
  assert.match(product, /aria-live/u);
  assert.match(product, /aria-label|aria-labelledby/u);
});

test('relationship universe keeps semantic buttons, explicit selected focus state and reduced-motion support', () => {
  const people = readOrEmpty('integration/element-module/src/product-experience/PeopleSurface.tsx');
  assert.match(people, /viewMode/u);
  assert.match(people, /onViewModeChange/u);
  assert.match(people, /focusedRelationshipId/u);
  assert.match(people, /<button|<motion\.button/u);
  assert.match(people, /aria-pressed/u);
  assert.match(people, /reducedMotion/u);
});

test('Product experience contains no relationship gamification vocabulary or color-only authority', () => {
  const product = source();
  assert.doesNotMatch(product, /\b(?:relationship\s*)?XP\b|affection\s*score|leaderboard|streak/iu);
  assert.match(product, /status|aria-live|role=/iu);
});
