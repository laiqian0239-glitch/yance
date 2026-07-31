(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceSettingsRouting = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DESKTOP_FIELDS = Object.freeze([
    'windowX', 'windowY', 'windowWidth', 'windowHeight', 'windowMaximized',
    'autoLaunch', 'minimizeToTray', 'closeToTray', 'startMinimized', 'theme',
    'gifAutoplay', 'stickerAutoplay', 'pauseAnimationWhenHidden',
    'autoCheckUpdates', 'autoDownloadUpdates'
  ]);
  const RUNTIME_FIELDS = Object.freeze(['autoConnectAccounts', 'backupOnStart', 'mediaAutoDownload']);
  const LIFECYCLE_FIELDS = Object.freeze(['safeMode']);
  const DESKTOP_SET = new Set(DESKTOP_FIELDS);
  const RUNTIME_SET = new Set(RUNTIME_FIELDS);
  const LIFECYCLE_SET = new Set(LIFECYCLE_FIELDS);

  function splitSettingsPatch(patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('settings patch must be an object');
    const desktop = {}, runtime = {}, lifecycle = {}, rejected = [];
    for (const [key, value] of Object.entries(patch)) {
      if (DESKTOP_SET.has(key)) desktop[key] = value;
      else if (RUNTIME_SET.has(key)) runtime[key] = value;
      else if (LIFECYCLE_SET.has(key)) lifecycle[key] = value;
      else rejected.push(key);
    }
    if (rejected.length) {
      const error = new Error(`Unsupported settings fields: ${rejected.join(', ')}`);
      error.reasonCode = 'SETTINGS_FIELD_NOT_ROUTABLE';
      error.fields = rejected;
      throw error;
    }
    return { desktop, runtime, lifecycle };
  }

  async function saveSettingsPatch({ patch, desktopUpdate, runtimeUpdate, lifecycleUpdate }) {
    const split = splitSettingsPatch(patch);
    const result = { desktop: null, runtime: null, lifecycle: null, routed: split };
    // Desktop values are saved independently first. A backend policy failure must
    // never make a valid desktop field fail Electron's strict whitelist.
    if (Object.keys(split.desktop).length) {
      if (typeof desktopUpdate !== 'function') throw Object.assign(new Error('Desktop settings adapter unavailable'), { reasonCode: 'DESKTOP_SETTINGS_ADAPTER_UNAVAILABLE' });
      result.desktop = await desktopUpdate(split.desktop);
    }
    if (Object.keys(split.runtime).length) {
      if (typeof runtimeUpdate !== 'function') throw Object.assign(new Error('Backend runtime settings adapter unavailable'), { reasonCode: 'BACKEND_RUNTIME_SETTINGS_ADAPTER_UNAVAILABLE', partialResult: result });
      result.runtime = await runtimeUpdate(split.runtime);
    }
    if (Object.keys(split.lifecycle).length) {
      if (typeof lifecycleUpdate !== 'function') throw Object.assign(new Error('Backend lifecycle settings adapter unavailable'), { reasonCode: 'BACKEND_LIFECYCLE_SETTINGS_ADAPTER_UNAVAILABLE', partialResult: result });
      result.lifecycle = await lifecycleUpdate(split.lifecycle);
    }
    return result;
  }

  return Object.freeze({ DESKTOP_FIELDS, RUNTIME_FIELDS, LIFECYCLE_FIELDS, splitSettingsPatch, saveSettingsPatch });
});
