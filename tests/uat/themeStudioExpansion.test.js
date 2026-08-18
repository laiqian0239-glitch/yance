'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StoreManager } = require('../../backend/store/StoreManager');
const { registerRuntimeStateCommands } = require('../../backend/store/commands/registerRuntimeStateCommands');
const policy = require('../../backend/store/themeAppearancePolicy');
const catalog = require('../../frontend/theme-catalog.json');

const ROOT = path.join(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function memoryPersistence(seed = {}) {
  const uiWrites = [];
  return {
    uiWrites,
    async loadSnapshot() { return seed; },
    async transaction(run) {
      return run({
        upsertUiState(row) { uiWrites.push(JSON.parse(JSON.stringify(row))); },
        appendStoreEvents() {},
        persistStoreMeta() {}
      });
    }
  };
}

test('theme catalog expands the matrix with distinct brightness, style, scene and accessibility lanes', () => {
  assert.equal(catalog.version, 2);
  assert.equal(catalog.themes.length, 29);
  const ids = catalog.themes.map(theme => theme.id);
  assert.equal(new Set(ids).size, ids.length);

  const required = [
    'jade-paper', 'mist-atelier', 'pure-black-code', 'white-paper-reading',
    'wabi-earth', 'cyber-pulse', 'morandi-cloud', 'data-operations',
    'service-warm', 'creative-pop', 'high-contrast-dark', 'high-contrast-light',
    'colorblind-signal', 'eye-care-paper'
  ];
  for (const id of required) assert.ok(ids.includes(id), `missing theme ${id}`);

  const light = catalog.themes.filter(theme => theme.brightness === '浅色');
  const dark = catalog.themes.filter(theme => theme.brightness === '深色');
  assert.ok(light.length >= 8, `expected at least 8 light themes, got ${light.length}`);
  assert.ok(dark.length >= 15, `expected at least 15 dark themes, got ${dark.length}`);

  const styles = new Set(catalog.themes.map(theme => theme.style));
  for (const style of ['商务', '科技', '人文', '时尚']) assert.ok(styles.has(style), `missing style ${style}`);

  const scenes = new Set(catalog.themes.flatMap(theme => theme.scenes || []));
  for (const scene of ['办公', '阅读', '监控', '客服', '运营', '创作']) assert.ok(scenes.has(scene), `missing scene ${scene}`);

  const accessibility = new Set(catalog.themes.map(theme => theme.accessibility));
  for (const mode of ['high-contrast', 'colorblind', 'eye-care']) assert.ok(accessibility.has(mode), `missing accessibility mode ${mode}`);

  for (const theme of catalog.themes) {
    assert.ok(theme.name && theme.description && theme.style && theme.brightness && theme.texture && theme.series);
    assert.ok(Array.isArray(theme.preview) && theme.preview.length >= 4);
    assert.ok(Array.isArray(theme.scenes) && theme.scenes.length >= 1);
    for (const token of ['bg', 'panel', 'card', 'text', 'muted', 'theme-accent']) assert.ok(theme.tokens?.[token], `${theme.id} missing ${token}`);
  }
});

test('theme appearance policy is a single catalog-backed persistence authority', () => {
  assert.equal(policy.THEMES.length, catalog.themes.length);
  assert.equal(policy.THEME_IDS.size, catalog.themes.length);
  assert.equal(policy.normalizeThemeId('not-a-theme'), catalog.defaultThemeId);
  assert.equal(policy.normalizeMotionLevel('invalid'), 'balanced');
  assert.equal(policy.normalizeThemeMode('schedule'), 'schedule');
  assert.equal(policy.normalizeClock('7:05', '09:00'), '07:05');
  assert.equal(policy.normalizeClock('25:00', '09:00'), '09:00');
  assert.deepEqual(policy.normalizeThemeTuning({ backgroundDepth: -4, glowIntensity: 999, glassOpacity: 1, accentSaturation: 999 }), {
    backgroundDepth: 0,
    glowIntensity: 100,
    glassOpacity: 20,
    accentSaturation: 150
  });
  assert.deepEqual(policy.normalizeTypography({ fontProfile: 'serif', fontScale: 500, lineHeight: 1, spacing: 'compact' }), {
    fontProfile: 'serif',
    fontScale: 150,
    lineHeight: 130,
    spacing: 'compact'
  });

  const normalized = policy.normalizeAppearanceState({
    themeId: 'jade-paper',
    previewThemeId: 'cyber-pulse',
    themeMode: 'system',
    lightThemeId: 'jade-paper',
    darkThemeId: 'pure-black-code',
    favoriteThemeIds: ['jade-paper', 'jade-paper', 'bad-id'],
    recentThemeIds: ['cyber-pulse', 'jade-paper'],
    customThemePresets: [{
      id: 'my-preset', name: '我的主题', baseThemeId: 'morandi-cloud',
      tuning: { glowIntensity: 10 }, typography: { fontProfile: 'humanist' },
      motionLevel: 'subtle', backgroundEffect: 'none'
    }],
    activeCustomThemePresetId: 'my-preset'
  });
  assert.equal(normalized.previewThemeId, '');
  assert.equal(normalized.themeMode, 'system');
  assert.deepEqual(normalized.favoriteThemeIds, ['jade-paper']);
  assert.equal(normalized.customThemePresets.length, 1);
  assert.equal(normalized.activeCustomThemePresetId, 'my-preset');
});

test('favorites, tuning, typography, automation and personal presets persist through StoreManager', async () => {
  const persistence = memoryPersistence();
  const manager = new StoreManager({ persistence });
  registerRuntimeStateCommands(manager);
  await manager.hydrate();

  await manager.dispatch({
    type: 'UPDATE_THEME_PREFERENCES', source: 'test', payload: {
      favoriteThemeId: 'jade-paper', favorite: true,
      themeTuning: { backgroundDepth: 35, glowIntensity: 0, glassOpacity: 88, accentSaturation: 76 },
      typography: { fontProfile: 'serif', fontScale: 108, lineHeight: 172, spacing: 'spacious' },
      themeMode: 'schedule', lightThemeId: 'white-paper-reading', darkThemeId: 'pure-black-code',
      scheduleDayStart: '06:30', scheduleNightStart: '20:15'
    }
  });

  let ui = manager.select(state => state.ui);
  assert.deepEqual(ui.favoriteThemeIds, ['jade-paper']);
  assert.equal(ui.themeMode, 'schedule');
  assert.equal(ui.lightThemeId, 'white-paper-reading');
  assert.equal(ui.darkThemeId, 'pure-black-code');
  assert.equal(ui.scheduleDayStart, '06:30');
  assert.equal(ui.scheduleNightStart, '20:15');
  assert.equal(ui.themeTuning.glowIntensity, 0);
  assert.equal(ui.typography.fontProfile, 'serif');
  assert.ok(persistence.uiWrites.length >= 1);

  const save = await manager.dispatch({
    type: 'SAVE_CUSTOM_THEME_PRESET', source: 'test', payload: { id: 'paper-focus', name: '纸张专注', baseThemeId: 'eye-care-paper' }
  });
  assert.equal(save.result.saved, true);
  ui = manager.select(state => state.ui);
  assert.equal(ui.customThemePresets.length, 1);
  assert.equal(ui.customThemePresets[0].id, 'paper-focus');
  assert.equal(ui.activeCustomThemePresetId, 'paper-focus');

  await manager.dispatch({ type: 'APPLY_THEME', source: 'test', payload: { themeId: 'cyber-pulse' } });
  ui = manager.select(state => state.ui);
  assert.equal(ui.themeId, 'cyber-pulse');
  assert.equal(ui.themeMode, 'manual');
  assert.equal(ui.activeCustomThemePresetId, '');
  assert.equal(ui.recentThemeIds[0], 'cyber-pulse');

  const apply = await manager.dispatch({ type: 'APPLY_CUSTOM_THEME_PRESET', source: 'test', payload: { presetId: 'paper-focus' } });
  assert.equal(apply.result.applied, true);
  ui = manager.select(state => state.ui);
  assert.equal(ui.themeId, 'eye-care-paper');
  assert.equal(ui.activeCustomThemePresetId, 'paper-focus');
  assert.equal(ui.recentThemeIds[0], 'eye-care-paper');

  const deleted = await manager.dispatch({ type: 'DELETE_CUSTOM_THEME_PRESET', source: 'test', payload: { presetId: 'paper-focus' } });
  assert.equal(deleted.result.deleted, true);
  ui = manager.select(state => state.ui);
  assert.equal(ui.customThemePresets.length, 0);
  assert.equal(ui.activeCustomThemePresetId, '');

  const lastPersisted = persistence.uiWrites.at(-1);
  assert.equal(lastPersisted.previewThemeId, '');
  assert.ok(Array.isArray(lastPersisted.customThemePresets));
  assert.ok(lastPersisted.themeTuning && lastPersisted.typography);
});

test('theme studio frontend exposes filters, mini previews, personalization, accessibility and adaptive switching', () => {
  const runtime = read('frontend/r32-theme-motion.js');
  const css = read('frontend/r32-theme-motion.css');
  const authority = read('frontend/r32-theme-authority.css');
  const client = read('frontend/js/r32-store-client.js');
  const routes = read('backend/routes/store.js');

  for (const marker of [
    'theme32Search', 'theme32Style', 'theme32Brightness', 'theme32Scene', 'theme32Texture',
    'theme32ViewTabs', '我的收藏', '最近使用', 'theme32-preview',
    'backgroundDepth', 'glowIntensity', 'glassOpacity', 'accentSaturation',
    'fontProfile', 'lineHeight', 'spacing',
    'saveCustomThemePreset', 'applyCustomThemePreset', 'deleteCustomThemePreset',
    "window.matchMedia?.('(prefers-color-scheme: light)')", "current.themeMode === 'schedule'"
  ]) assert.ok(runtime.includes(marker), `runtime missing ${marker}`);
  assert.equal(runtime.includes('fontScale'), false, 'theme studio must not restore a second font-size authority');
  assert.ok(read('frontend/r32-global-reading.css').includes('data-reading="large"'), 'reading modes own semantic font scaling');

  for (const marker of [
    'data-theme-accessibility="high-contrast"',
    'data-theme-accessibility="colorblind"',
    'data-theme-texture="极简"',
    'data-theme-texture="纸张"',
    '.theme32-toolbar', '.theme32-preview', '.theme32-personal-grid', '.theme32-auto-grid'
  ]) assert.ok(css.includes(marker) || authority.includes(marker), `CSS missing ${marker}`);

  for (const marker of ['updateThemePreferences', 'saveCustomThemePreset', 'applyCustomThemePreset', 'deleteCustomThemePreset']) {
    assert.ok(client.includes(marker), `client missing ${marker}`);
  }
  for (const route of ['/ui/theme/preferences', '/ui/theme/presets', "/ui/theme/presets/:presetId/apply", "/ui/theme/presets/:presetId"]) {
    assert.ok(routes.includes(route), `route missing ${route}`);
  }
});

test('global fontScale authority accepts exact 85-150 percent bounds', () => {
  assert.equal(policy.normalizeTypography({ fontScale: 85 }).fontScale, 85);
  assert.equal(policy.normalizeTypography({ fontScale: 150 }).fontScale, 150);
  assert.equal(policy.normalizeTypography({ fontScale: 84 }).fontScale, 85);
  assert.equal(policy.normalizeTypography({ fontScale: 151 }).fontScale, 150);
});
