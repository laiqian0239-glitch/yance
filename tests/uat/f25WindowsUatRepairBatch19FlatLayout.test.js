const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'r32-flat-document-flow.css'), 'utf8');
const routes = [
  'contact-page-open','profile-page-open','timeline-page-open','insights-page-open',
  'aiwork-page-open','account-center-open','system-center-open','settings-recovery-open','theme-workspace-open'
];

const workspaces = [
  'contacts-workspace','profiles-workspace','timeline-workspace','insights-workspace',
  'aiwork-workspace','account-center-workspace','system-center-workspace','settings-recovery-workspace','theme-workspace'
];

test('Batch 19 compatibility stylesheet remains loaded after production layout authority', () => {
  const flatIndex = html.indexOf('/r32-flat-document-flow.css');
  assert.ok(flatIndex > html.indexOf('/r32-production-workspace-layout.css'));
  assert.match(css, /Narrow-screen document-flow compatibility/);
  assert.match(css, /--ui-routed-desktop-layout:viewport-grid/);
});

test('document flow is scoped to mobile and cannot override desktop routed workspaces', () => {
  assert.match(css, /@media\(max-width:820px\)/);
  const beforeMobile = css.slice(0, css.indexOf('@media(max-width:820px)'));
  assert.doesNotMatch(beforeMobile, /overflow-y:auto!important/);
  assert.doesNotMatch(beforeMobile, /height:auto!important/);
  for (const route of routes) assert.match(css, new RegExp(`\\.${route}`));
  for (const workspace of workspaces) assert.match(css, new RegExp(`\\.${workspace}`));
  assert.match(css, /grid-auto-rows:max-content!important/);
});


