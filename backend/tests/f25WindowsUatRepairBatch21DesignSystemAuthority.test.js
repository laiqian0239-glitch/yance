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
  assert.match(css, /--yance-font-body:var\(--ws-body\)/u);
  assert.match(css, /--yance-control-height:max\(var\(--ws-control-h\),var\(--ui-density-row/u);
  assert.match(css, /\[data-production-component\]/u);
  assert.match(css, /\[data-production-control\]/u);
  assert.match(css, /html\[data-reading="large"\][\s\S]*white-space:normal/u);
  assert.match(css, /html\[data-contrast="high"\][\s\S]*focus-visible/u);
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
