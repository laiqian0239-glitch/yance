(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceSystemStatus = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const DEFAULT_DURATIONS = Object.freeze({
    success: 2600,
    info: 3200,
    warning: 5200,
    error: 7000
  });
  const ROUTE_CLASSES = Object.freeze([
    'contact-page-open', 'profile-page-open', 'timeline-page-open',
    'insights-page-open', 'aiwork-page-open', 'account-center-open',
    'system-center-open', 'settings-recovery-open', 'theme-workspace-open',
    'immersive'
  ]);

  let timer = null;
  let current = null;
  let routeSignature = '';
  let observer = null;

  function documentRef() {
    return root?.document || null;
  }

  function element(id) {
    return documentRef()?.getElementById?.(id) || null;
  }

  function normalizeType(type) {
    const value = String(type || 'info').toLowerCase();
    return ['success', 'info', 'warning', 'error'].includes(value) ? value : 'info';
  }

  function defaultDuration(type) {
    return DEFAULT_DURATIONS[normalizeType(type)] || DEFAULT_DURATIONS.info;
  }

  function clear(reason = 'manual') {
    if (timer) {
      root?.clearTimeout?.(timer);
      timer = null;
    }
    const bar = element('systemStatus');
    if (bar) {
      bar.classList.remove('show', 'success', 'info', 'warning', 'error');
      delete bar.dataset.statusSource;
      delete bar.dataset.statusPersistent;
      delete bar.dataset.statusReason;
    }
    const button = element('systemStatusAction');
    if (button) {
      button.hidden = true;
      button.textContent = '';
      button.onclick = null;
    }
    current = null;
    return { cleared: true, reason };
  }

  function show(type, text, options = {}) {
    const bar = element('systemStatus');
    if (!bar) return { shown: false, reason: 'status-element-missing' };

    if (timer) {
      root?.clearTimeout?.(timer);
      timer = null;
    }

    const normalizedType = normalizeType(type);
    const message = String(text || '').trim() || '操作状态已更新';
    const actionLabel = String(options.actionLabel || '').trim();
    const action = typeof options.action === 'function' ? options.action : null;
    const persistent = options.persistent === true;
    const retainAcrossRoutes = options.retainAcrossRoutes === true;
    const duration = persistent
      ? 0
      : Math.max(900, Number.isFinite(Number(options.duration))
        ? Number(options.duration)
        : defaultDuration(normalizedType));

    bar.className = `system-status show ${normalizedType}`;
    bar.dataset.statusSource = String(options.source || 'runtime');
    bar.dataset.statusPersistent = persistent ? 'true' : 'false';
    bar.dataset.statusReason = String(options.reason || '');

    const label = element('systemStatusText');
    if (label) label.textContent = message;

    const button = element('systemStatusAction');
    if (button) {
      button.hidden = !actionLabel;
      button.textContent = actionLabel;
      button.onclick = actionLabel ? async () => {
        clear('action');
        if (action) await action();
      } : null;
    }

    current = {
      type: normalizedType,
      text: message,
      source: bar.dataset.statusSource,
      persistent,
      retainAcrossRoutes,
      shownAt: Date.now()
    };

    if (duration > 0) timer = root?.setTimeout?.(() => clear('timeout'), duration) || null;
    return { shown: true, ...current, duration };
  }

  function signatureFor(app) {
    if (!app?.classList) return '';
    return ROUTE_CLASSES.filter(name => app.classList.contains(name)).join('|') || 'conversation';
  }

  function install() {
    const doc = documentRef();
    if (!doc) return false;

    const app = doc.querySelector?.('.app');
    routeSignature = signatureFor(app);

    if (app && typeof root?.MutationObserver === 'function' && !observer) {
      observer = new root.MutationObserver(() => {
        const next = signatureFor(app);
        if (next !== routeSignature) {
          routeSignature = next;
          if (current && current.retainAcrossRoutes !== true) clear('route-change');
        }
      });
      observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    }

    doc.addEventListener?.('click', event => {
      const nav = event.target?.closest?.('#navMenu button,.nav-bottom button,[data-route],[data-open-view]');
      if (nav && current && current.retainAcrossRoutes !== true) clear('navigation-click');
    }, true);

    root?.addEventListener?.('yance:system-status-clear', event => clear(event?.detail?.reason || 'event'));
    root?.addEventListener?.('yance:system-status-show', event => {
      const detail = event?.detail || {};
      show(detail.type, detail.text, detail);
    });

    return true;
  }

  if (root) install();

  return Object.freeze({
    show,
    clear,
    install,
    current: () => current ? { ...current } : null,
    defaultDuration,
    DEFAULT_DURATIONS,
    ROUTE_CLASSES
  });
});
