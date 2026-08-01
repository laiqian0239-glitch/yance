'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

test('one global display authority owns typography, density and contrast for production components', () => {
  const html = read('frontend/index.html');
  const css = read('frontend/r32-global-reading.css');
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const stylesheetOrder = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/gu)].map(match => match[1]);
  assert.ok(stylesheetOrder.includes('/r32-global-reading.css'));
  assert.ok(stylesheetOrder.indexOf('/r32-global-reading.css') > stylesheetOrder.indexOf('/r32-conversation-center-v2.css'));
  for (const token of ['--type-page-title','--type-section-title','--type-card-title','--type-body','--type-caption','--type-meta','--type-control','--type-badge','--type-data-value']) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(css, /html\[data-reading="standard"\]/u);
  assert.match(css, /html\[data-reading="comfortable"\]/u);
  assert.match(css, /html\[data-reading="large"\]/u);
  assert.match(css, /html\[data-density="compact"\]/u);
  assert.doesNotMatch(css, /--ws-/u);
  assert.doesNotMatch(css, /\[data-production-(?:component|control)\]/u);
  assert.match(runtime, /dataset\.displayAuthority='batch21-semantic-v1'/u);
  assert.match(runtime, /yance:display-authority-changed/u);
});

test('desktop routed layout has one viewport-grid authority and mobile document flow is scoped', () => {
  const flat = read('frontend/r32-flat-document-flow.css');
  const production = read('frontend/r32-production-workspace-layout.css');
  assert.match(flat, /--ui-routed-desktop-layout:viewport-grid/u);
  assert.match(flat, /@media\(max-width:820px\)/u);
  assert.match(production, /height:100%/u);
  assert.match(production, /grid-template-rows:auto[\s\S]*minmax\(0,1fr\)/u);
});
