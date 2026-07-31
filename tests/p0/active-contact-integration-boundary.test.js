'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('ActiveContactStore loads before all contact-consuming runtimes', () => {
  const html = read('frontend/index.html');
  const store = html.indexOf('/js/r32-active-contact-store.js');
  const ui = html.indexOf('/js/r32-ui-runtime.js');
  const insights = html.indexOf('/js/r32-insights-runtime.js');
  const workbench = html.indexOf('/js/r32-ai-workbench-runtime.js');
  assert.ok(store > 0);
  assert.ok(store < ui && ui < insights && insights < workbench);
});

test('conversation, insights and AI workbench use the same authority without deleting legacy compatibility', () => {
  const ui = read('frontend/js/r32-ui-runtime.js');
  const insights = read('frontend/js/r32-insights-runtime.js');
  const workbench = read('frontend/js/r32-ai-workbench-runtime.js');
  const conversation = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(ui, /YanceActiveContactStore/);
  assert.match(ui, /activeContactStore\.announceLegacy/);
  assert.match(insights, /publishInsightSelection/);
  assert.match(workbench, /publishWorkbenchSelection/);
  assert.match(conversation, /yance:r32-contact-selected/);
});

test('canonical selection follows the current contact link, primary navigation and conversation menu contract', () => {
  const html = read('frontend/index.html');
  const ui = read('frontend/js/r32-ui-runtime.js');
  const insights = read('frontend/js/r32-insights-runtime.js');
  const conversation = read('frontend/js/r32-conversation-capabilities.js');

  for (const id of ['chatIdentityLink','navContacts','navProfiles','navTimeline','navInsights','moreBtn']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1);
  }

  assert.match(ui, /\$\('chatIdentityLink'\)\.onclick=\(\)=>openContactsPage\(activeId\)/);
  assert.match(ui, /\$\('navContacts'\)\.onclick=\(\)=>openContactsPage\(activeId\)/);
  assert.match(ui, /\$\('navProfiles'\)\.onclick=\(\)=>openProfilesPage\(activeId\)/);
  assert.match(ui, /\$\('navTimeline'\)\.onclick=\(\)=>openTimelinePage\(activeId\)/);
  assert.match(insights, /bind\('navInsights','onclick',\(\)=>openInsightsPage\(/);
  assert.match(conversation, /\$\('moreBtn'\)\.onclick=/);
  assert.match(conversation, /menu\.setAttribute\('role','menu'\)/);
});
