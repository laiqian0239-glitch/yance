'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const main = () => fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const styles = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

test('desktop preserves the owner-approved 1186x758 non-fullscreen work window with the approved ink background', () => {
  const source = main();
  const createWindow = source.slice(source.indexOf('function createWindow()'), source.indexOf('function createWindow()') + 2200);
  const schema = require('../../electron/desktopSettingsSchema');
  assert.equal(schema.DEFAULTS.windowWidth, 1186);
  assert.equal(schema.DEFAULTS.windowHeight, 758);
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

test('Conversation v4 prioritizes the compact 1186x758 authority over 2048 desktop pane widths', () => {
  const css = styles();
  const marker = '/* YANCE_COMPACT_CONVERSATION_WORKSPACE_20260927 */';
  const authority = css.slice(css.indexOf(marker));
  assert.notEqual(css.indexOf(marker), -1, 'missing compact Conversation authority marker');
  assert.match(authority, /--yance-conversation-v4-contacts:\s*220px/u);
  assert.match(authority, /--yance-conversation-v4-insight-summary:\s*210px/u);
  assert.match(authority, /--yance-conversation-v4-insight-expanded:\s*270px/u);
  assert.match(authority, /--yance-conversation-v4-topbar:\s*46px/u);
  assert.match(authority, /@media \(max-width:\s*1000px\)[\s\S]{0,320}--yance-conversation-v4-contacts:\s*210px/u);
  assert.match(authority, /@media \(max-height:\s*760px\)[\s\S]{0,220}--yance-conversation-v4-topbar:\s*44px/u);
});
