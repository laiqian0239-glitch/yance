'use strict';

const DESKTOP_SETTING_KEYS = Object.freeze([
  'windowX', 'windowY', 'windowWidth', 'windowHeight', 'windowMaximized',
  'autoLaunch', 'minimizeToTray', 'closeToTray', 'startMinimized', 'theme', 'productSoundMode',
  'gifAutoplay', 'stickerAutoplay', 'pauseAnimationWhenHidden',
  'autoCheckUpdates', 'autoDownloadUpdates'
]);
const DESKTOP_SETTING_KEY_SET = new Set(DESKTOP_SETTING_KEYS);
const BUSINESS_SETTING_KEYS = Object.freeze([
  'safeMode', 'autoConnectAccounts', 'backupOnStart', 'mediaAutoDownload',
  'lastBackupAt', 'lastBackupName', 'accountState', 'recoveryState',
  'aiState', 'translationState', 'contactState', 'lifecycleState'
]);
const DEFAULTS = Object.freeze({
  schemaVersion: 2,
  windowX: null, windowY: null, windowWidth: 1520, windowHeight: 940, windowMaximized: false,
  autoLaunch: false, minimizeToTray: false, closeToTray: true, startMinimized: false, theme: 'system', productSoundMode: 'Essential only',
  gifAutoplay: true, stickerAutoplay: true, pauseAnimationWhenHidden: true,
  autoCheckUpdates: true, autoDownloadUpdates: false, updatedAt: ''
});
const BOOLEAN_KEYS = new Set(['windowMaximized','autoLaunch','minimizeToTray','closeToTray','startMinimized','gifAutoplay','stickerAutoplay','pauseAnimationWhenHidden','autoCheckUpdates','autoDownloadUpdates']);
const NUMBER_KEYS = new Set(['windowX','windowY','windowWidth','windowHeight']);

function desktopSettingsError(key) {
  const error = new Error(`Electron desktop setting is not allowed: ${key}`);
  error.reasonCode = BUSINESS_SETTING_KEYS.includes(key) ? 'DESKTOP_BUSINESS_SETTING_FORBIDDEN' : 'DESKTOP_SETTING_NOT_ALLOWED';
  error.settingKey = key;
  return error;
}
function normalizeDesktopSettings(value = {}) {
  const out = { ...DEFAULTS };
  for (const key of BOOLEAN_KEYS) if (Object.prototype.hasOwnProperty.call(value,key)) out[key] = value[key] === true;
  // Native minimize always remains on the Windows taskbar. Keep the legacy key
  // readable for settings-file compatibility, but migrate every stored value off.
  out.minimizeToTray = false;
  for (const key of NUMBER_KEYS) if (Object.prototype.hasOwnProperty.call(value,key)) {
    const n = Number(value[key]); out[key] = Number.isFinite(n) ? Math.trunc(n) : DEFAULTS[key];
  }
  out.windowWidth = Math.max(800, Math.min(10000, Number(out.windowWidth || DEFAULTS.windowWidth)));
  out.windowHeight = Math.max(600, Math.min(10000, Number(out.windowHeight || DEFAULTS.windowHeight)));
  const theme = String(value.theme || out.theme);
  out.theme = ['system','light','dark'].includes(theme) ? theme : 'system';
  const productSoundMode = String(value.productSoundMode || out.productSoundMode);
  out.productSoundMode = ['Off','Essential only','Immersive'].includes(productSoundMode) ? productSoundMode : 'Essential only';
  out.updatedAt = String(value.updatedAt || '').slice(0,64);
  return out;
}
function sanitizeDesktopSettingsPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw desktopSettingsError('(invalid-patch)');
  const clean = {};
  for (const key of Object.keys(patch)) {
    if (!DESKTOP_SETTING_KEY_SET.has(key)) throw desktopSettingsError(key);
    clean[key] = patch[key];
  }
  return normalizeDesktopSettings({ ...DEFAULTS, ...clean });
}
module.exports = { DESKTOP_SETTING_KEYS, BUSINESS_SETTING_KEYS, DEFAULTS, normalizeDesktopSettings, sanitizeDesktopSettingsPatch, desktopSettingsError };
