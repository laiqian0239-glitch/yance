'use strict';

/**
 * Windows desktop lifecycle policy.
 *
 * The native minimize button must remain a normal taskbar minimize operation.
 * Only an explicit close-to-tray request may hide the window and remove its
 * taskbar button. Keeping these paths separate prevents a minimized window
 * from becoming reachable only through the notification area.
 */
function preserveTaskbarOnMinimize(window) {
  if (!window || window.isDestroyed?.()) return { action: 'ignored' };
  try { window.setSkipTaskbar?.(false); } catch (_) {}
  return { action: 'native-minimize', taskbarVisible: true };
}

function hideWindowToTray(window, event) {
  if (!window || window.isDestroyed?.()) return { action: 'ignored' };
  event?.preventDefault?.();
  window.hide?.();
  window.setSkipTaskbar?.(true);
  return { action: 'hide-to-tray', taskbarVisible: false };
}

function restoreWindowTaskbar(window) {
  if (!window || window.isDestroyed?.()) return { action: 'ignored' };
  window.setSkipTaskbar?.(false);
  return { action: 'restore-taskbar', taskbarVisible: true };
}

module.exports = {
  preserveTaskbarOnMinimize,
  hideWindowToTray,
  restoreWindowTaskbar
};
