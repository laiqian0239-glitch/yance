'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const CSS = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('Settings v4 uses the approved unified information architecture and opens on General', () => {
  const shell = read(SHELL);
  assert.match(shell, /type SettingsSectionV4/u);
  assert.match(shell, /useState<SettingsSectionV4>\("general"\)/u);
  for (const label of ['常规','外观与氛围','人格管理','输入与真人打字','语言与翻译','模型与路由','平台连接','语音与媒体','数据、隐私与学习','同步与备份','高级诊断']) {
    assert.match(shell, new RegExp(label, 'u'));
  }
});

test('Settings v4 General is a real owner-backed dashboard rather than a launcher-only page', () => {
  const shell = read(SHELL);
  for (const label of ['对话默认','真人打字','人格管理','外观与关系氛围','隐私与学习边界','其他设置']) {
    assert.match(shell, new RegExp(label, 'u'));
  }
  assert.match(shell, /preferences\.setAtmosphere/u);
  assert.match(shell, /preferences\.setMotionMode/u);
  assert.match(shell, /data-settings-section=\{settingsSection\}/u);
});

test('Settings v4 deep routes mount existing mature capability surfaces', () => {
  const shell = read(SHELL);
  assert.match(shell, /<ProductModelRuntimeSupportSurface\s*\/>/u);
  assert.match(shell, /<PlatformAccountsSurface/u);
  assert.match(shell, /<LearningWorkspace\s*\/>/u);
  assert.match(shell, /<VoiceWorkspace/u);
  assert.match(shell, /<MediaWorkspace/u);
  for (const category of ['appearance','desktop','notifications','data','security','about']) {
    assert.match(shell, new RegExp(`ProductSystemSettingsSurface[^>]*category=["']${category}["']`, 'u'));
  }
});

test('Settings v4 keeps human typing and translation on their mature owners without shadow settings', () => {
  const shell = read(SHELL);
  assert.match(shell, /真人打字由统一发送层/u);
  assert.match(shell, /翻译在真实对话内联/u);
  assert.doesNotMatch(shell, /setHumanTyping|updateHumanTyping|updateTranslationSettings|setTranslationPolicy/u);
});

test('Settings v4 CSS owns the final dense desktop navigation and content layout', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-settings-v4\s*\{/u);
  assert.match(css, /\.yance-settings-v4__nav/u);
  assert.match(css, /\.yance-settings-v4__general-grid/u);
  assert.match(css, /grid-template-columns:\s*minmax\(220px,\s*280px\)\s+minmax\(0,\s*1fr\)/u);
  assert.match(css, /\.yance-settings-v4__general-card/u);
});
