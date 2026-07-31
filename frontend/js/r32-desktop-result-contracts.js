(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceDesktopResultContracts = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function normalizeSaveDialogResult(value) {
    const input = typeof value === 'string'
      ? { ok: true, saved: true, path: value, filePath: value }
      : value && typeof value === 'object' ? value : {};
    const path = String(input.path || input.filePath || '').trim();
    const cancelled = input.cancelled === true || input.canceled === true || (
      input.saved === false && input.ok !== false && !path
    );
    const saved = !cancelled && (
      input.saved === true || input.wrote === true || (
        Boolean(path) && (input.ok === true || input.success === true)
      )
    );
    const ok = cancelled || saved;
    return Object.freeze({
      ok,
      saved,
      cancelled,
      canceled: cancelled,
      path,
      filePath: path,
      raw: input
    });
  }

  return Object.freeze({ normalizeSaveDialogResult });
});
