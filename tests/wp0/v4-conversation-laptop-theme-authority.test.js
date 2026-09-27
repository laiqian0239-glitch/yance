'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const main = () => fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const styles = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

test('desktop defaults to the canonical 1060x720 non-fullscreen work window with the approved ink background', () => {
  const source = main();
  const createWindow = source.slice(source.indexOf('function createWindow()'), source.indexOf('function createWindow()') + 2200);
  const schema = require('../../electron/desktopSettingsSchema');
  assert.equal(schema.DEFAULTS.windowWidth, 1060);
  assert.equal(schema.DEFAULTS.windowHeight, 720);
  assert.match(createWindow, /resolveInitialWindowBounds/u);
  assert.match(createWindow, /width:\s*initialBounds\.width/u);
  assert.match(createWindow, /height:\s*initialBounds\.height/u);
  assert.match(createWindow, /backgroundColor:\s*'#06111D'/u);
});

test('Conversation v4 locks the formal navy-gold authority instead of inheriting a persisted violet theme', () => {
  const css = styles();
  const marker = '/* YANCE_CONVERSATION_LAPTOP_AUTHORITY_20260927 */';
  const authority = css.slice(css.indexOf(marker));
  assert.notEqual(css.indexOf(marker), -1, 'missing laptop authority marker');
  assert.match(authority, /\.yance-product-shell\[data-conversation-active\][\s\S]{0,120}--yance-theme-app:\s*#06111d/u);
  assert.match(authority, /--yance-theme-panel:\s*#081a2a/u);
  assert.match(authority, /--yance-theme-accent:\s*#d7ad4a/u);
  assert.match(authority, /--yance-theme-text:\s*#f4f0e6/u);
});

test('Conversation v4 prioritizes a 14-inch 1186x758 window over the 2048 desktop pane widths', () => {
  const css = styles();
  const marker = '/* YANCE_CONVERSATION_LAPTOP_AUTHORITY_20260927 */';
  const authority = css.slice(css.indexOf(marker));
  assert.match(authority, /@media\s*\(max-width:\s*1280px\),\s*\(max-height:\s*800px\)/u);
  assert.match(authority, /--yance-conversation-v4-contacts:\s*230px/u);
  assert.match(authority, /--yance-conversation-v4-insight:\s*250px/u);
  assert.match(authority, /--yance-conversation-v4-topbar:\s*54px/u);
  assert.match(authority, /\.yance-conversation-workspace-v4 \.yance-product-conversation__people-list > button\s*\{[\s\S]{0,160}min-height:\s*56px/u);
  assert.match(authority, /\.yance-conversation-workspace-v4 \.yance-product-conversation__chat-header\s*\{[\s\S]{0,180}min-height:\s*60px/u);
  assert.match(authority, /@media\s*\(max-height:\s*800px\)[\s\S]{0,360}\.yance-conversation-workspace-v4 \.yance-action-dock\s*\{[\s\S]{0,120}max-height:\s*220px/u);
});
