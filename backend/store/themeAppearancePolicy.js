'use strict';

const path = require('node:path');
const catalog = require(path.join(__dirname, '..', '..', 'frontend', 'theme-catalog.json'));

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

const THEMES = Object.freeze(Array.isArray(catalog.themes) ? catalog.themes.map(theme => Object.freeze({ ...theme })) : []);
const THEME_IDS = new Set(THEMES.map(theme => clean(theme.id)).filter(Boolean));
const LIGHT_THEME_IDS = new Set(THEMES.filter(theme => theme.brightness === '浅色').map(theme => theme.id));
const DARK_THEME_IDS = new Set(THEMES.filter(theme => theme.brightness === '深色').map(theme => theme.id));
const DEFAULT_THEME_ID = THEME_IDS.has(clean(catalog.defaultThemeId)) ? clean(catalog.defaultThemeId) : 'midnight-cyan';
const DEFAULT_LIGHT_THEME_ID = LIGHT_THEME_IDS.has(clean(catalog.lightDefaultThemeId)) ? clean(catalog.lightDefaultThemeId) : [...LIGHT_THEME_IDS][0] || DEFAULT_THEME_ID;
const DEFAULT_DARK_THEME_ID = DARK_THEME_IDS.has(clean(catalog.darkDefaultThemeId)) ? clean(catalog.darkDefaultThemeId) : [...DARK_THEME_IDS][0] || DEFAULT_THEME_ID;
const MOTION_LEVELS = new Set(['off', 'subtle', 'balanced', 'enhanced']);
const BACKGROUND_EFFECTS = new Set(['none', 'ambient', 'grid', 'aurora']);
const THEME_MODES = new Set(['manual', 'system', 'schedule']);
const FONT_PROFILES = new Set(['theme', 'sans', 'humanist', 'serif', 'mono']);
const SPACING_PROFILES = new Set(['theme', 'compact', 'comfortable', 'spacious']);

function normalizeThemeId(value, fallback = DEFAULT_THEME_ID) {
  const id = clean(value);
  return THEME_IDS.has(id) ? id : (THEME_IDS.has(clean(fallback)) ? clean(fallback) : DEFAULT_THEME_ID);
}

function normalizeMotionLevel(value, fallback = 'balanced') {
  const level = clean(value);
  return MOTION_LEVELS.has(level) ? level : (MOTION_LEVELS.has(clean(fallback)) ? clean(fallback) : 'balanced');
}

function normalizeBackgroundEffect(value, fallback = 'ambient') {
  const effect = clean(value);
  return BACKGROUND_EFFECTS.has(effect) ? effect : (BACKGROUND_EFFECTS.has(clean(fallback)) ? clean(fallback) : 'ambient');
}

function normalizeThemeMode(value, fallback = 'manual') {
  const mode = clean(value);
  return THEME_MODES.has(mode) ? mode : (THEME_MODES.has(clean(fallback)) ? clean(fallback) : 'manual');
}

function normalizeClock(value, fallback) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return fallback;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeThemeIdList(values, limit) {
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = clean(value);
    if (!THEME_IDS.has(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function normalizeThemeTuning(input = {}) {
  return {
    backgroundDepth: clamp(input.backgroundDepth, 0, 100, 50),
    glowIntensity: clamp(input.glowIntensity, 0, 100, 50),
    glassOpacity: clamp(input.glassOpacity, 20, 100, 72),
    accentSaturation: clamp(input.accentSaturation, 50, 150, 100)
  };
}

function normalizeTypography(input = {}) {
  const fontProfile = clean(input.fontProfile);
  const spacing = clean(input.spacing);
  return {
    fontProfile: FONT_PROFILES.has(fontProfile) ? fontProfile : 'theme',
    fontScale: clamp(input.fontScale, 85, 150, 100),
    lineHeight: clamp(input.lineHeight, 130, 190, 155),
    spacing: SPACING_PROFILES.has(spacing) ? spacing : 'theme'
  };
}

function normalizePresetId(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 48);
}

function normalizeCustomThemePresets(values) {
  const rows = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') continue;
    const id = normalizePresetId(value.id);
    const name = clean(value.name).slice(0, 40);
    if (!id || !name || rows.some(row => row.id === id)) continue;
    rows.push({
      id,
      name,
      baseThemeId: normalizeThemeId(value.baseThemeId),
      tuning: normalizeThemeTuning(value.tuning),
      typography: normalizeTypography(value.typography),
      motionLevel: normalizeMotionLevel(value.motionLevel),
      backgroundEffect: normalizeBackgroundEffect(value.backgroundEffect),
      createdAt: clean(value.createdAt),
      updatedAt: clean(value.updatedAt)
    });
    if (rows.length >= 12) break;
  }
  return rows;
}

function defaultAppearanceState() {
  return {
    themeId: DEFAULT_THEME_ID,
    previewThemeId: '',
    motionLevel: 'balanced',
    backgroundEffect: 'ambient',
    themeMode: 'manual',
    lightThemeId: DEFAULT_LIGHT_THEME_ID,
    darkThemeId: DEFAULT_DARK_THEME_ID,
    scheduleDayStart: '07:00',
    scheduleNightStart: '19:00',
    favoriteThemeIds: [],
    recentThemeIds: [DEFAULT_THEME_ID],
    themeTuning: normalizeThemeTuning(),
    typography: normalizeTypography(),
    customThemePresets: [],
    activeCustomThemePresetId: ''
  };
}

function normalizeAppearanceState(input = {}) {
  const defaults = defaultAppearanceState();
  const customThemePresets = normalizeCustomThemePresets(input.customThemePresets);
  const activeCustomThemePresetId = normalizePresetId(input.activeCustomThemePresetId);
  return {
    themeId: normalizeThemeId(input.themeId, defaults.themeId),
    previewThemeId: '',
    motionLevel: normalizeMotionLevel(input.motionLevel, defaults.motionLevel),
    backgroundEffect: normalizeBackgroundEffect(input.backgroundEffect, defaults.backgroundEffect),
    themeMode: normalizeThemeMode(input.themeMode, defaults.themeMode),
    lightThemeId: LIGHT_THEME_IDS.has(clean(input.lightThemeId)) ? clean(input.lightThemeId) : defaults.lightThemeId,
    darkThemeId: DARK_THEME_IDS.has(clean(input.darkThemeId)) ? clean(input.darkThemeId) : defaults.darkThemeId,
    scheduleDayStart: normalizeClock(input.scheduleDayStart, defaults.scheduleDayStart),
    scheduleNightStart: normalizeClock(input.scheduleNightStart, defaults.scheduleNightStart),
    favoriteThemeIds: normalizeThemeIdList(input.favoriteThemeIds, 60),
    recentThemeIds: Array.isArray(input.recentThemeIds) ? normalizeThemeIdList(input.recentThemeIds, 12) : defaults.recentThemeIds,
    themeTuning: normalizeThemeTuning(input.themeTuning),
    typography: normalizeTypography(input.typography),
    customThemePresets,
    activeCustomThemePresetId: customThemePresets.some(row => row.id === activeCustomThemePresetId) ? activeCustomThemePresetId : ''
  };
}

function themeById(id) {
  return THEMES.find(theme => theme.id === normalizeThemeId(id)) || THEMES[0] || null;
}

module.exports = {
  catalog,
  THEMES,
  THEME_IDS,
  LIGHT_THEME_IDS,
  DARK_THEME_IDS,
  DEFAULT_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  DEFAULT_DARK_THEME_ID,
  MOTION_LEVELS,
  BACKGROUND_EFFECTS,
  THEME_MODES,
  FONT_PROFILES,
  SPACING_PROFILES,
  normalizeThemeId,
  normalizeMotionLevel,
  normalizeBackgroundEffect,
  normalizeThemeMode,
  normalizeClock,
  normalizeThemeIdList,
  normalizeThemeTuning,
  normalizeTypography,
  normalizeCustomThemePresets,
  normalizePresetId,
  normalizeAppearanceState,
  defaultAppearanceState,
  themeById
};
