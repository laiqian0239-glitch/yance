(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceNotificationLayoutAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const REGION_ID = 'globalNotificationRegion';
  const MAX_VISIBLE = 2;
  const SUMMARY_CLASS = 'global-notification-summary';
  const TONE_ALIASES = Object.freeze({ warn: 'warning', bad: 'error', ok: 'success' });

  function text(value, fallback = '') {
    const result = String(value ?? '').replace(/\s+/g, ' ').trim();
    return result || fallback;
  }

  function normalizeTone(value) {
    const raw = String(value || 'info').trim().toLowerCase();
    const normalized = TONE_ALIASES[raw] || raw;
    return ['success', 'warning', 'error', 'info'].includes(normalized) ? normalized : 'info';
  }

  function mount(doc = root?.document) {
    if (!doc?.createElement) return null;
    let region = doc.getElementById?.(REGION_ID);
    if (region) return region;
    region = doc.createElement('div');
    region.id = REGION_ID;
    region.className = 'global-notification-region';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', '系统通知');
    region.setAttribute('aria-live', 'polite');
    doc.body?.append?.(region);
    return region;
  }

  function dismiss(notice) {
    if (!notice) return;
    clearTimeout(notice._dismissTimer);
    notice.classList?.add?.('leaving');
    const remove = () => notice.remove?.();
    if (root?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) remove();
    else setTimeout(remove, 150);
  }

  function ensureSummary(region, doc) {
    const count = Math.max(0, Number(region.dataset?.overflowCount || 0));
    let summary = region.querySelector?.(`.${SUMMARY_CLASS}`);
    if (count <= 0) {
      summary?.remove?.();
      return null;
    }
    if (!summary) {
      summary = doc.createElement('div');
      summary.className = `global-notification info ${SUMMARY_CLASS}`;
      summary.setAttribute('role', 'status');
      const copy = doc.createElement('span');
      copy.className = 'global-notification-copy';
      summary.appendChild(copy);
      region.prepend(summary);
    }
    summary.dataset.overflowCount = String(count);
    const copy = summary.querySelector?.('.global-notification-copy');
    if (copy) copy.textContent = `另有 ${count} 条较早通知已折叠`;
    return summary;
  }

  function reconcile(region, doc) {
    const notices = [...region.children].filter(node => node.classList?.contains('global-notification') && !node.classList?.contains(SUMMARY_CLASS));
    let overflow = Math.max(0, Number(region.dataset?.overflowCount || 0));
    while (notices.length > MAX_VISIBLE) {
      const oldest = notices.shift();
      clearTimeout(oldest?._dismissTimer);
      oldest?.remove?.();
      overflow += 1;
    }
    region.dataset.overflowCount = String(overflow);
    ensureSummary(region, doc);
  }

  function show(options = {}) {
    const doc = options.document || root?.document;
    const region = mount(doc);
    if (!region) return null;
    const message = text(options.message, '操作已完成');
    const tone = normalizeTone(options.tone);
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 2600) || 0);
    const notice = doc.createElement('div');
    notice.className = `global-notification ${tone}`;
    notice.dataset.tone = tone;
    const source = text(options.source);
    if (source) notice.dataset.source = source;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    const copy = doc.createElement('span');
    copy.className = 'global-notification-copy';
    copy.textContent = message;
    notice.appendChild(copy);

    if (options.actionLabel && typeof options.action === 'function') {
      const action = doc.createElement('button');
      action.type = 'button';
      action.className = 'global-notification-action';
      action.textContent = text(options.actionLabel, '处理');
      action.addEventListener('click', () => {
        try { options.action(); } finally { dismiss(notice); }
      });
      notice.appendChild(action);
    }

    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'global-notification-close';
    close.setAttribute('aria-label', '关闭通知');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(notice));
    notice.appendChild(close);

    region.appendChild(notice);
    reconcile(region, doc);
    if (timeoutMs > 0) notice._dismissTimer = setTimeout(() => dismiss(notice), timeoutMs);
    return notice;
  }

  function clear(options = {}) {
    const doc = options.document || root?.document;
    const region = doc?.getElementById?.(REGION_ID);
    if (!region) return 0;
    const source = text(options.source);
    let removed = 0;
    for (const notice of [...region.children]) {
      if (notice.classList?.contains(SUMMARY_CLASS)) continue;
      if (source && notice.dataset?.source !== source) continue;
      clearTimeout(notice._dismissTimer);
      notice.remove?.();
      removed += 1;
    }
    if (!source) {
      region.dataset.overflowCount = '0';
      ensureSummary(region, doc);
    }
    return removed;
  }

  return Object.freeze({ REGION_ID, MAX_VISIBLE, SUMMARY_CLASS, TONE_ALIASES, normalizeTone, mount, show, dismiss, clear });
});
