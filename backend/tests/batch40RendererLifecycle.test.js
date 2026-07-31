'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('history streams own abort controllers and inactive media uses the shared coordinator', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /historyRequestControllers=new Map\(\)/);
  assert.match(source, /previousController\.abort\(/);
  assert.match(source, /fetch\(url,\{headers:\{accept:'application\/x-ndjson'\},signal\}\)/);
  assert.doesNotMatch(source, /else refreshConversationSummaries\(\{retainMissing:true,forceRender:true,eventTypes:\[event\.type\]\}/);
});

test('theme runtime exposes disposal for its store, timer, and media-query listener', () => {
  const source = read('frontend/r32-theme-motion.js');
  assert.match(source, /const dispose = \(\) => \{/);
  assert.match(source, /removeEventListener\?\.\('change', handleSystemColorScheme\)/);
  assert.match(source, /unsubscribeThemeStore\?\.\(\)/);
  assert.match(source, /removeEventListener\('click', handleDocumentClick\)/);
  assert.match(source, /removeEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(source, /removeEventListener\('focus', handleWindowFocus\)/);
  assert.match(source, /historyMutationObserver\?\.disconnect\?\.\(\)/);
  assert.match(source, /clearTimeout\(window\.__yanceThemeTitlebarRetry\)/);
  assert.match(source, /clearTimeout\(notify\.timer\)/);
  assert.match(source, /savePreset, dispose/);
});
