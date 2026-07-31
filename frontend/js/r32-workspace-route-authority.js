(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceWorkspaceRouteAuthority = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const ROUTES = Object.freeze({
    conversation: Object.freeze({ className: '', target: 'navConversation', workspaceId: '' }),
    contacts: Object.freeze({ className: 'contact-page-open', target: 'navContacts', workspaceId: 'contactsWorkspace' }),
    profiles: Object.freeze({ className: 'profile-page-open', target: 'navProfiles', workspaceId: 'profilesWorkspace' }),
    timeline: Object.freeze({ className: 'timeline-page-open', target: 'navTimeline', workspaceId: 'timelineWorkspace' }),
    insights: Object.freeze({ className: 'insights-page-open', target: 'navInsights', workspaceId: 'insightsWorkspace' }),
    'ai-workbench': Object.freeze({ className: 'aiwork-page-open', target: 'navAiWorkbench', workspaceId: 'aiworkWorkspace' }),
    accounts: Object.freeze({ className: 'account-center-open', target: 'navAccountsCenter', workspaceId: 'accountCenterWorkspace' }),
    system: Object.freeze({ className: 'system-center-open', target: 'navSystemCenter', workspaceId: 'systemCenterWorkspace' }),
    settings: Object.freeze({ className: 'settings-recovery-open', target: 'navSettingsRecovery', workspaceId: 'settingsRecoveryWorkspace' }),
    theme: Object.freeze({ className: 'theme-workspace-open', target: 'navThemes', workspaceId: 'themeWorkspace' })
  });
  const VIEW_ALIASES = Object.freeze({
    ai: 'ai-workbench',
    aiwork: 'ai-workbench',
    account: 'accounts',
    'account-center': 'accounts',
    health: 'system',
    'system-center': 'system',
    recovery: 'settings',
    'settings-recovery': 'settings',
    themes: 'theme'
  });
  const ROUTE_CLASSES = Object.freeze(Object.values(ROUTES).map(row => row.className).filter(Boolean));
  const TRANSIENT_LAYOUT_CLASSES = Object.freeze(['immersive', 'contacts-hidden', 'ai-hidden', 'compact', 'ai-open-small', 'ai-overlay-mode', 'ai-overlay-open']);

  function normalizeView(value, fallback = 'conversation') {
    const raw = String(value || '').trim().toLowerCase();
    const normalized = VIEW_ALIASES[raw] || raw;
    return Object.prototype.hasOwnProperty.call(ROUTES, normalized) ? normalized : fallback;
  }

  function activeViews(app) {
    if (!app?.classList) return [];
    return Object.entries(ROUTES)
      .filter(([, route]) => route.className && app.classList.contains(route.className))
      .map(([view]) => view);
  }

  function activeView(app, fallback = 'conversation') {
    const active = activeViews(app);
    if (active.length === 1) return active[0];
    const desired = normalizeView(app?.dataset?.desiredWorkspaceView, '');
    if (desired && active.includes(desired)) return desired;
    return active.length ? active[0] : fallback;
  }


  function scrollRoot(app, requestedView = '') {
    const view = normalizeView(requestedView || activeView(app), 'conversation');
    const workspaceId = ROUTES[view]?.workspaceId || '';
    if (!workspaceId) return null;
    return app?.ownerDocument?.getElementById?.(workspaceId) || null;
  }

  function normalizeScrollTop(value, rootElement) {
    const numeric = Number(value);
    const requested = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    const maximum = Math.max(0, Number(rootElement?.scrollHeight || 0) - Number(rootElement?.clientHeight || 0));
    return Math.min(requested, maximum);
  }

  function captureScroll(app, requestedView = '') {
    const owner = scrollRoot(app, requestedView);
    if (!owner) return 0;
    return normalizeScrollTop(owner.scrollTop, owner);
  }

  function restoreScroll(app, requestedView = '', top = 0, options = {}) {
    const owner = scrollRoot(app, requestedView);
    if (!owner) return false;
    const apply = () => { owner.scrollTop = normalizeScrollTop(top, owner); };
    const win = app?.ownerDocument?.defaultView || root;
    if (options.defer !== false && typeof win?.requestAnimationFrame === 'function') win.requestAnimationFrame(apply);
    else apply();
    return true;
  }

  function resetScroll(app, requestedView = '', options = {}) {
    return restoreScroll(app, requestedView, 0, options);
  }

  function routeIntegrity(app, expectedView = '') {
    const expected = normalizeView(expectedView || app?.dataset?.desiredWorkspaceView || activeView(app), 'conversation');
    const active = activeViews(app);
    const actual = active.length === 0 ? 'conversation' : activeView(app, 'conversation');
    const duplicateClasses = active.length > 1;
    return Object.freeze({
      expected,
      actual,
      active: Object.freeze(active),
      duplicateClasses,
      pass: !duplicateClasses && actual === expected,
      expectedClassName: ROUTES[expected].className,
      target: ROUTES[expected].target
    });
  }

  function clearRouteClasses(app) {
    if (!app?.classList) return false;
    app.classList.remove(...ROUTE_CLASSES);
    return true;
  }

  function clearTransientLayoutClasses(app) {
    if (!app?.classList) return false;
    app.classList.remove(...TRANSIENT_LAYOUT_CLASSES);
    return true;
  }

  function dispatchRouteEvent(app, name, detail) {
    const win = app?.ownerDocument?.defaultView || root;
    if (!win?.dispatchEvent || typeof win.CustomEvent !== 'function') return;
    win.dispatchEvent(new win.CustomEvent(name, { detail }));
  }

  function applyRoute(app, requestedView, options = {}) {
    if (!app?.classList) return routeIntegrity(app, requestedView);
    const view = normalizeView(requestedView, 'conversation');
    app.dataset.desiredWorkspaceView = view;
    clearRouteClasses(app);
    if (options.clearTransient !== false) clearTransientLayoutClasses(app);
    const routeClass = ROUTES[view].className;
    if (routeClass) app.classList.add(routeClass);
    app.dataset.activeWorkspaceView = view;
    const layoutAuthority = root?.YanceWorkspaceLayoutAuthority;
    if (layoutAuthority?.apply) {
      const layoutState = layoutAuthority.read(app);
      layoutAuthority.apply(app, { ...layoutState, route: view }, (app.ownerDocument?.defaultView || root)?.innerWidth || 0);
    }
    const integrity = routeIntegrity(app, view);
    app.dataset.workspaceRouteIntegrity = integrity.pass ? 'pass' : 'fail';
    app.dataset.workspaceRouteSource = String(options.source || 'workspace-route-authority');
    dispatchRouteEvent(app, 'yance:workspace-route-changed', Object.freeze({ ...integrity, source: app.dataset.workspaceRouteSource }));
    return integrity;
  }

  function repairRoute(app, preferredView = '', options = {}) {
    const expected = normalizeView(preferredView || app?.dataset?.desiredWorkspaceView || activeView(app), 'conversation');
    const before = routeIntegrity(app, expected);
    if (before.pass) return before;
    const after = applyRoute(app, expected, { ...options, source: options.source || 'workspace-route-integrity-repair' });
    dispatchRouteEvent(app, 'yance:workspace-route-repaired', Object.freeze({ before, after, source: options.source || 'workspace-route-integrity-repair' }));
    return after;
  }

  function watchRouteIntegrity(app, options = {}) {
    if (!app?.classList || typeof MutationObserver !== 'function') return () => {};
    if (app.__yanceWorkspaceRouteObserver) return app.__yanceWorkspaceRouteObserver.disconnect;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const expected = normalizeView(app.dataset.desiredWorkspaceView || activeView(app), 'conversation');
        const integrity = routeIntegrity(app, expected);
        if (!integrity.pass) repairRoute(app, expected, { source: options.source || 'workspace-route-observer' });
      });
    });
    observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    const disconnect = () => {
      observer.disconnect();
      delete app.__yanceWorkspaceRouteObserver;
    };
    app.__yanceWorkspaceRouteObserver = Object.freeze({ observer, disconnect });
    return disconnect;
  }

  return Object.freeze({
    ROUTES,
    ROUTE_CLASSES,
    TRANSIENT_LAYOUT_CLASSES,
    normalizeView,
    activeViews,
    activeView,
    scrollRoot,
    captureScroll,
    restoreScroll,
    resetScroll,
    routeIntegrity,
    clearRouteClasses,
    clearTransientLayoutClasses,
    applyRoute,
    repairRoute,
    watchRouteIntegrity
  });
});
