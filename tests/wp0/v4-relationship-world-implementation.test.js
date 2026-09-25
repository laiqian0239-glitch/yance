'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORLD = path.join(ROOT, 'integration/element-module/src/product-experience/RelationshipWorld.tsx');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css');
const read = (file) => fs.readFileSync(file, 'utf8');

test('Relationship World v4 is the approved real-data three-column workspace', () => {
  const world = read(WORLD);
  assert.match(world, /yance-relationship-world-v4/u);
  assert.match(world, /relationships:\s*readonly RelationshipProjection\[\]/u);
  assert.match(world, /onSelectRelationship:\s*\(relationshipId:\s*string\)\s*=>\s*void/u);
  assert.match(world, /yance-rw-v4__objects/u);
  assert.match(world, /yance-rw-v4__main/u);
  assert.match(world, /yance-rw-v4__person/u);
  assert.doesNotMatch(world, /Hermes|Sophia Chen|James Carter|Emma Wilson|Daniel Brooks/u);
});

test('Relationship World v4 tabs and relationship-object buttons are real handlers, never dead controls', () => {
  const world = read(WORLD);
  assert.match(world, /type WorldTab = "overview" \| "moments" \| "journey" \| "history" \| "insights"/u);
  assert.match(world, /setWorldTab\(/u);
  assert.match(world, /onSelectRelationship\(row\.id\)/u);
  assert.match(world, /进入真实对话/u);
  assert.match(world, /onOpenConversation\(/u);
  assert.doesNotMatch(world, /<button[^>]*disabled[^>]*>\s*(?:总览|共同时刻|关系图|历史|洞察)/u);
});

test('Relationship World v4 keeps journey, shared moments, goal, signals and mature owner seams', () => {
  const world = read(WORLD);
  for (const marker of [
    'yance-rw-v4__journey', 'yance-rw-v4__moments', 'yance-rw-v4__goal', 'yance-rw-v4__signals',
    'loadDailyChatGoal', 'upsertDailyChatGoal', 'setPersonaScope', 'correctInference', 'markRelationshipKeyNode',
    'requestRelationshipOverlay("photo")', 'requestRelationshipOverlay("voice")', 'requestRelationshipOverlay("live")',
  ]) assert.ok(world.includes(marker), `missing Relationship World v4 capability: ${marker}`);
  assert.doesNotMatch(world, /localStorage\.setItem\([^\n]*(?:relationship|moment|journey|goal)/iu);
});

test('Product shell supplies the existing relationship projection and selection owner to Relationship World', () => {
  const shell = read(SHELL);
  const mount = shell.match(/<RelationshipWorld[\s\S]*?\/>/u)?.[0] || '';
  assert.match(mount, /relationships=\{relationships\}/u);
  assert.match(mount, /onSelectRelationship=\{chooseRelationship\}/u);
  assert.match(mount, /onRefresh=\{refreshRelationships\}/u);
});

test('Relationship World v4 CSS owns the approved dense desktop layout without a second primary rail', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-relationship-world-v4\s*\{/u);
  assert.match(css, /\.yance-rw-v4__workspace\s*\{/u);
  assert.match(css, /grid-template-columns:/u);
  assert.doesNotMatch(read(WORLD), /yance-desktop-rail/u);
});
