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
  assert.doesNotMatch(home, /\.yance-v4-contacts\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2/su);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-v4-contacts\s*\{[^}]*grid-row:\s*1[^}]*height:\s*calc\(100vh\s*-\s*84px\)[^}]*overflow:\s*hidden/su);
});

test('Home default window never truncates platform filters or contact names', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /@media\s*\(max-width:\s*1280px\)[\s\S]*\.yance-v4-filters\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/su);
  assert.doesNotMatch(home, /\.yance-v4-filters button\s*\{[^}]*text-overflow:\s*ellipsis/su);
  assert.match(home, /\.yance-v4-contact__copy strong\s*\{[^}]*white-space:\s*normal[^}]*text-overflow:\s*clip/su);
});

test('Home default window uses two-by-two recent people cards and a readable guide header', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /@media\s*\(max-width:\s*1280px\)[\s\S]*\.yance-v4-recent > div\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/su);
  assert.match(home, /\.yance-v4-guide > header h2\s*\{[^}]*white-space:\s*nowrap/su);
  assert.match(home, /\.yance-v4-guide > header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su);
});

test('Home chrome inherits Premium Calm instead of purple navigation styling', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /\.yance-product-shell:has\(\.yance-people-home-v4\) > \.yance-desktop-topbar\s*\{[^}]*background:\s*#06111d/su);
  assert.match(home, /\.yance-product-shell:has\(\.yance-people-home-v4\) > \.yance-desktop-rail\s*\{[^}]*background:\s*#081a2a/su);
  assert.match(home, /\.yance-product-shell:has\(\.yance-people-home-v4\) > \.yance-desktop-rail button\[aria-current="page"\][\s\S]*var\(--yance-home-gold\)/su);
  assert.match(home, /\.yance-product-shell:has\(\.yance-people-home-v4\) \.yance-desktop-topbar__intelligence\s*\{[^}]*display:\s*inline-flex/su);
});

test('Home focus card projects recent relationship context separately from intelligence summary', () => {
  const people = read(PEOPLE);
  assert.match(people, /yance-v4-focus-card__message/u);
  assert.match(people, /focusedRecentMessage \? <blockquote className="yance-v4-focus-card__message">/u);
});

test('Home contact rows grow with wrapped names instead of overlapping the next contact', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /\.yance-v4-contact\s*\{[^}]*min-height:\s*76px[^}]*height:\s*auto/su);
});

test('Home recent context rejects platform labels and only quotes real message-like text', () => {
  const people = read(PEOPLE);
  assert.match(people, /function relationshipRecentMessage\(/u);
  assert.match(people, /conversation\.lastMessage/u);
  assert.match(people, /blocked\.has\(candidate\.toLocaleLowerCase\(\)\)/u);
  assert.match(people, /const focusedRecentMessage = focusedRelationship \? relationshipRecentMessage\(focusedRelationship\) : ""/u);
  assert.match(people, /focusedRecentMessage \? <blockquote className="yance-v4-focus-card__message">/u);
});

test('Home minimum width frees contact copy from decorative action text', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-v4-contact__action\s*\{[^}]*display:\s*none/su);
  assert.match(home, /@media\s*\(max-width:\s*1120px\)[\s\S]*\.yance-v4-contact\s*\{[^}]*min-height:\s*82px/su);
});

test('Home default recent people use compact horizontal tiles so the first screen stays complete', () => {
  const css = read(CSS); const home = css.slice(css.indexOf('/* Home v4 Premium Calm authority */'));
  assert.match(home, /@media\s*\(max-width:\s*1280px\)[\s\S]*\.yance-v4-recent button\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*34px\s+minmax\(0,\s*1fr\)[^}]*min-height:\s*66px/su);
  assert.match(home, /@media\s*\(max-width:\s*1280px\)[\s\S]*\.yance-v4-recent \.yance-v4-contact__avatar\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2[^}]*width:\s*34px[^}]*height:\s*34px/su);
});
