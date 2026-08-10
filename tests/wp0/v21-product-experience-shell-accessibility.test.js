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

test('Reduced motion is explicit and keeps controls usable', () => {
  const product = source();
  const css = readOrEmpty('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(product, /useReducedMotion|prefers-reduced-motion/u);
  assert.match(`${product}\n${css}`, /reduced[- ]motion|prefers-reduced-motion/iu);
  assert.doesNotMatch(product, /setInterval\s*\(/u);
});

test('Keyboard focus and screen-reader state feedback are visible', () => {
  const product = source();
  const css = readOrEmpty('integration/element-module/src/product-experience/ProductExperienceShell.css');
  assert.match(css, /:focus-visible/u);
  assert.match(product, /aria-live/u);
  assert.match(product, /aria-label|aria-labelledby/u);
});

test('Product experience contains no relationship gamification vocabulary or color-only authority', () => {
  const product = source();
  assert.doesNotMatch(product, /\b(?:relationship\s*)?XP\b|affection\s*score|leaderboard|streak/iu);
  assert.match(product, /status|aria-live|role=/iu);
});
