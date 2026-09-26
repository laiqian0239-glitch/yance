'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PEOPLE = 'integration/element-module/src/product-experience/PeopleSurface.tsx';
const CSS = 'integration/element-module/src/product-experience/ProductExperienceShell.css';
const ELECTRON = 'electron/main.js';

test('Home keeps approved 1180x760 default and 960x680 minimum window contract', () => {
  const main = read(ELECTRON);
  assert.match(main, /width:\s*1180[\s\S]{0,80}height:\s*760/u);
  assert.match(main, /minWidth:\s*960[\s\S]{0,80}minHeight:\s*680/u);
  assert.doesNotMatch(main, /width:\s*1600[\s\S]{0,80}height:\s*900/u);
});

test('Home follows master platform filters and compact relationship-first hierarchy', () => {
  const people = read(PEOPLE);
  assert.match(people, /type PeopleFilter = "all" \| "facebook" \| "telegram" \| "whatsapp"/u);
  assert.match(people, /Facebook/u); assert.match(people, /Telegram/u); assert.match(people, /WhatsApp/u);
  assert.doesNotMatch(people, /\["unread"|\["favorite"|\["recent"/u);
  assert.match(people, /yance-v4-page-title--compact/u);
  assert.match(people, /\u4e0d\u662f\u770b\u6570\u636e\uff0c\u800c\u662f\u77e5\u9053\u73b0\u5728\u6700\u503c\u5f97\u5904\u7406\u54ea\u6bb5\u5173\u7cfb/u);
  assert.match(people, /loadPersonaEffective/u); assert.match(people, /\u5f53\u524d\u751f\u6548\u4eba\u683c/u); assert.match(people, /<dt>\u5f53\u524d\u4eba\u683c<\/dt>/u);
});

test('Home owns Premium Calm tokens and adapts without horizontal clipping at minimum width', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.notEqual(home.length, css.length);
  assert.match(home, /--yance-home-app:\s*#06111d/iu); assert.match(home, /--yance-home-panel:\s*#081a2a/iu);
  assert.match(home, /--yance-home-gold:\s*#d7ad4a/iu); assert.match(home, /--yance-home-teal:\s*#55c7b0/iu);
  assert.doesNotMatch(home, /yance-final-violet|yance-final-intimacy|#a78bfa|#ff8bc8/iu);
  assert.match(home, /\.yance-v4-filters\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/su);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-people-home-v4\s*\{[^}]*grid-template-columns:\s*minmax\(190px,\s*220px\)\s+minmax\(0,\s*1fr\)/su);
  assert.match(home, /@media\s*\(max-height:\s*700px\)[\s\S]*\.yance-v4-main\s*\{[^}]*padding:/su);
  assert.doesNotMatch(home, /overflow-x:\s*auto/u);
});

test('Home keeps 今日关系导航 visible at the approved 1180px default width', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /\.yance-v4-guide\s*\{[^}]*display:\s*block/su);
});

test('Home default density keeps three attention rows and four recent people like the master', () => {
  const people = read(PEOPLE);
  assert.match(people, /yance-v4-attention-list[\s\S]{0,260}visibleRelationships\.slice\(0, 3\)/u);
  assert.match(people, /yance-v4-recent[\s\S]{0,260}visibleRelationships\.slice\(0, 4\)/u);
});

test('Home minimum-width layout gives main and guide natural-height rows without overlap', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*grid-template-rows:\s*max-content\s+max-content/su);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto/su);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-v4-main\s*\{[^}]*height:\s*max-content[^}]*min-height:\s*max-content/su);
});

test('Home narrow contacts stay viewport-bound and do not stretch both content rows', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.doesNotMatch(home, /grid-row:\s*1\s*\/\s*span\s*2/u);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-v4-contacts\s*\{[^}]*grid-row:\s*1[^}]*height:\s*calc\(100vh\s*-\s*84px\)[^}]*overflow:\s*hidden/su);
});
