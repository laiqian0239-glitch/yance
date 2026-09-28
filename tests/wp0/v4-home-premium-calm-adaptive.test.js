'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PEOPLE = 'integration/element-module/src/product-experience/PeopleSurface.tsx';
const CSS = 'integration/element-module/src/product-experience/ProductExperienceShell.css';
const SHELL = 'integration/element-module/src/product-experience/ProductExperienceShell.tsx';

test('Home uses the owner-approved 920x620 default and 860x580 minimum window', () => {
  const schema = require('../../electron/desktopSettingsSchema');
  const policy = require('../../electron/windowBoundsPolicy');
  assert.equal(schema.DEFAULTS.windowWidth, 920);
  assert.equal(schema.DEFAULTS.windowHeight, 620);
  assert.equal(policy.MIN_WIDTH, 860);
  assert.equal(policy.MIN_HEIGHT, 580);
});

test('Home master keeps four primary rail entries and Pro anchored at the bottom', () => {
  const shell = read(SHELL); const css = read(CSS);
  for (const label of ['首页','对话','关系世界','设置']) assert.match(shell, new RegExp(`<strong>${label}<\\/strong>`, 'u'));
  assert.match(shell, /yance-desktop-rail__pro[\s\S]{0,180}Pro[\s\S]{0,100}专业版/u);
  assert.match(css, /yance-desktop-rail__pro[^}]*position:absolute[^}]*bottom:/su);
});

test('Home hero preserves the dusk visual master and compact 2x2 dashboard hierarchy', () => {
  const css = read(CSS); const people = read(PEOPLE);
  assert.match(people, /conversation-terrace-dusk\.png\?inline/u);
  assert.match(people, /className="yance-home-hero__image"\s+src=\{homeHeroImage\}/u);
  assert.match(css, /yance-home-grid[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)[^}]*grid-template-rows:minmax\(0,1fr\) minmax\(0,1fr\)/su);
  for (const label of ['平台连接','今天值得关注','最近对话','更多能力']) assert.match(people, new RegExp(label, 'u'));
  for (const label of ['WhatsApp','Telegram','Facebook','Facebook Page']) assert.match(people, new RegExp(label, 'u'));
});

test('Home compact authority preserves readable controls instead of horizontally scrolling', () => {
  const css = read(CSS);
  assert.match(css, /@media \(max-width:1000px\)[\s\S]{0,900}padding-left:68px/u);
  assert.match(css, /@media \(max-height:720px\)[\s\S]{0,1200}grid-template-rows:170px/u);
  assert.doesNotMatch(css, /\.yance-home-dashboard[^}]*overflow-x:\s*auto/su);
});

test('Home topbar keeps slogan, real intelligence state, search, and draggable brand/context', () => {
  const shell = read(SHELL); const css = read(CSS);
  assert.match(shell, /智能的会对话 · 专为成熟理性打造/u);
  assert.match(shell, /智能状态：\{intelligenceStateLabel\}/u);
  assert.match(shell, /yance-desktop-topbar__search/u);
  assert.match(css, /data-home-surface-active="true"[^\n]*\.yance-desktop-topbar__brand,[\s\S]{0,180}\.yance-desktop-topbar__context[^}]*-webkit-app-region:\s*drag/su);
});

test('Home capability panel reports runtime truth instead of a static all-online claim', () => {
  const people = read(PEOPLE);
  assert.match(people, /loadHomeCapabilityProjection/u);
  assert.match(people, /allCapabilitiesOnline/u);
  assert.match(people, /enabledCapabilityCount/u);
  assert.doesNotMatch(people, /const capabilityTiles = \[[\s\S]{0,700}"拜访提醒", "已启用"/u);
});


test('Home attention and recent panels only surface relationships with real conversations', () => {
  const people = read(PEOPLE);
  assert.match(people, /const homeConversationRelationships = useMemo\(\(\) => liveRelationships\.filter\(\(relationship\) => relationship\.conversations\.some\(\(row\) => !row\.archived\)\)/u);
  assert.match(people, /yance-home-attention[\s\S]{0,900}homeConversationRelationships\.slice\(0, 3\)/u);
  assert.match(people, /yance-home-recent[\s\S]{0,900}homeConversationRelationships\.slice\(0, 4\)/u);
});


test('People projection rejects conversations owned by a different canonical contact', () => {
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  assert.match(projection, /const conversationOwnerId = text\([\s\S]{0,80}conversationRow\.canonicalContactId[\s\S]{0,180}routeScope\.canonicalContactId/u);
  assert.match(projection, /if \(conversationOwnerId && conversationOwnerId !== stableContactId\) return false/u);
  assert.match(projection, /const ownedDirectConversationIds = directConversationIds\.filter/u);
  assert.match(projection, /ownedDirectConversationIds[\s\S]{0,220}normalizeConversationRef/u);
});


test('Matrix merge replaces raw remote identity labels with the live room contact name', () => {
  const shell = read(SHELL);
  assert.match(shell, /function mergedRelationshipName\([\s\S]{0,500}currentIdentity === currentName/u);
  assert.match(shell, /if \(!liveName \|\| liveName === currentName\) return currentName/u);
  assert.match(shell, /return currentIdentity === currentName \? liveName : currentName/u);
  assert.match(shell, /name: mergedRelationshipName\(current, live\)/u);
});


test('Conversation projection preserves Matrix room identity for stable live-room merging', () => {
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  assert.match(projection, /function normalizeConversationRef[\s\S]{0,1800}matrixRoomId: optionalText\(row\.matrixRoomId\)/u);
});
