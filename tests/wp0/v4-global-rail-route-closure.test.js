'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PEOPLE = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/PeopleSurface.tsx'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

function desktopRailSource() {
  return SHELL.match(/<nav className="yance-desktop-rail"[\s\S]*?<\/nav>/u)?.[0] || '';
}

function railButton(label) {
  return [...desktopRailSource().matchAll(/<button[\s\S]*?<\/button>/gu)]
    .map((match) => match[0])
    .find((button) => button.includes(`<strong>${label}</strong>`)) || '';
}

test('v4 owns exactly one Global Rail with only Home, Relationship World, and Settings', () => {
  const rail = desktopRailSource();
  assert.ok(rail, 'ProductExperienceShell must own the persistent Global Rail');
  assert.doesNotMatch(PEOPLE, /className="yance-v4-rail"/u, 'Home must not create a second primary rail');
  for (const label of ['首页', '关系世界', '设置']) assert.match(rail, new RegExp(`>${label}<`, 'u'));
  for (const retired of ['关系宇宙', '对话', 'AI 助手']) assert.doesNotMatch(rail, new RegExp(`>${retired}<`, 'u'));
});

test('Global Rail Relationship World enters the focused deep Relationship World, never universe mode', () => {
  const relationshipButton = railButton('关系世界');
  assert.match(relationshipButton, /chooseRelationship\(homeRelationship\.id\)/u);
  assert.doesNotMatch(relationshipButton, /setPeopleHomeView\("universe"\)|onViewModeChange\("universe"\)/u);
});

test('Global Rail Settings remains an enabled Product handler', () => {
  const settingsButton = railButton('设置');
  assert.match(settingsButton, /setSettingsVisible\(true\)/u);
  assert.match(settingsButton, /setSettingsSection\("general"\)/u);
  assert.doesNotMatch(settingsButton, /\bdisabled\b/u);
});

test('Home layout reserves no second rail column and never hides the persistent Global Rail', () => {
  assert.doesNotMatch(CSS, /\.yance-product-shell:has\(\.yance-people-home-v4\)\s*>\s*\.yance-desktop-rail[\s\S]{0,160}display:\s*none/u);
  assert.match(CSS, /\.yance-people-home-v4\s*\{[\s\S]{0,260}grid-template-columns:\s*minmax\(284px,\s*404px\)\s+minmax\(440px,\s*1fr\)\s+minmax\(286px,\s*420px\)/u);
});
test('Conversation keeps the same persistent Global Rail instead of mounting a competing rail', () => {
  assert.equal((SHELL.match(/<nav className="yance-(?:desktop|conversation)-rail"/gu) || []).length, 1);
  assert.doesNotMatch(SHELL, /className="yance-conversation-rail"/u);
  assert.doesNotMatch(SHELL, /!conversationSurfaceActive\s*\|\|\s*settingsVisible/u);
  assert.doesNotMatch(CSS, /\.yance-product-shell\[data-conversation-(?:active|surface-active)\]\s*>\s*\.yance-desktop-rail\s*\{[\s\S]{0,100}display:\s*none/u);
});


test('Conversation keeps Global Rail narrow while only the workspace fills the remaining client area', () => {
  assert.match(CSS, /\.yance-product-shell\s*>\s*\.yance-desktop-rail\s*\{\s*width:\s*82px;/u);
  assert.match(
    CSS,
    /YANCE_FINAL_CONVERSATION_AUTHORITY_V3[\s\S]*?\.yance-product-shell\[data-conversation-active\]\s*\{[\s\S]{0,180}padding-left:\s*102px;/u,
  );
  assert.match(
    CSS,
    /\.yance-product-shell\[data-conversation-active\]\s*>\s*\.yance-shell-scene--conversation\s*\{[\s\S]{0,180}width:\s*100%;[\s\S]{0,120}min-width:\s*0;/u,
  );
  assert.doesNotMatch(
    CSS,
    /\.yance-product-shell\[data-conversation-active\]\s*>\s*\*\s*\{[\s\S]{0,180}width:\s*100%/u,
    'Conversation must never stretch every direct child because that turns the Global Rail into a fullscreen hit-test overlay',
  );
});
