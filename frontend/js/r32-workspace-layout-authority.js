(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceWorkspaceLayoutAuthority = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const ROUTED_VIEWS = new Set(['contacts', 'profiles', 'timeline', 'insights', 'ai-workbench', 'accounts', 'system', 'settings', 'theme']);
  const NAV_MODES = new Set(['expanded', 'compact', 'hidden']);
  const CONTACT_MODES = new Set(['normal', 'compact', 'hidden']);
  const DENSITIES = new Set(['comfortable', 'compact']);
  const COMPATIBILITY_CLASSES = Object.freeze([
    'nav-expanded', 'nav-compact', 'nav-hidden', 'compact', 'contacts-hidden',
    'ai-hidden', 'ai-overlay-mode', 'ai-overlay-open', 'ai-open-small'
  ]);

  function viewportBand(viewportWidth) {
    const width = Math.max(0, Number(viewportWidth) || 0);
    if (width >= 1640) return 'wide';
    if (width >= 1360) return 'desktop';
    if (width >= 820) return 'narrow';
    return 'mobile';
  }

  function normalizeRoute(value) {
    const route = String(value || 'conversation').trim().toLowerCase();
    return route || 'conversation';
  }

  function normalize(input = {}, viewportWidth = 0) {
    const band = viewportBand(viewportWidth);
    let navMode = NAV_MODES.has(input.navMode) ? input.navMode : (band === 'wide' ? 'expanded' : 'compact');
    if (navMode === 'expanded' && (band === 'narrow' || band === 'mobile')) navMode = 'compact';
    const contactMode = CONTACT_MODES.has(input.contactMode) ? input.contactMode : 'normal';
    const density = DENSITIES.has(input.density) ? input.density : 'comfortable';
    const route = normalizeRoute(input.route);
    const routed = ROUTED_VIEWS.has(route);
    const overlayMode = !routed && (band === 'narrow' || band === 'mobile');
    return Object.freeze({
      navMode,
      contactMode,
      aiVisible: input.aiVisible !== false,
      aiOverlayOpen: Boolean(input.aiOverlayOpen),
      route,
      routed,
      overlayMode,
      viewportBand: band,
      density
    });
  }

  function widthToken(mode, tokens) {
    if (mode === 'hidden') return '0px';
    return tokens[mode];
  }

  function compute(input = {}, viewportWidth = 0) {
    const state = normalize(input, viewportWidth);
    const navWidth = widthToken(state.navMode, {
      expanded: 'var(--ui-nav-expanded-w)',
      compact: 'var(--ui-nav-compact-w)'
    });
    const contactWidth = state.routed ? '0px' : widthToken(state.contactMode, {
      normal: 'var(--ui-contact-normal-w)',
      compact: 'var(--ui-contact-compact-w)'
    });
    const aiWidth = state.routed || state.overlayMode || !state.aiVisible ? '0px' : 'var(--ui-ai-panel-w)';
    const mainColumn = navWidth === '0px' ? '1' : '2';
    const columns = [];
    if (navWidth !== '0px') columns.push(navWidth);
    if (contactWidth !== '0px') columns.push(contactWidth);
    columns.push('minmax(0,1fr)');
    if (aiWidth !== '0px') columns.push(aiWidth);
    return Object.freeze({ ...state, navWidth, contactWidth, aiWidth, mainColumn, columns: columns.join(' ') });
  }

  function read(app) {
    if (!app) return normalize({}, root?.innerWidth || 0);
    return Object.freeze({
      navMode: app.dataset?.navMode || (app.classList?.contains('nav-hidden') ? 'hidden' : app.classList?.contains('nav-expanded') ? 'expanded' : 'compact'),
      contactMode: app.dataset?.contactMode || (app.classList?.contains('contacts-hidden') ? 'hidden' : app.classList?.contains('compact') ? 'compact' : 'normal'),
      aiVisible: app.dataset?.aiVisible !== 'false' && !app.classList?.contains('ai-hidden'),
      aiOverlayOpen: app.dataset?.aiOverlayOpen === 'true' || app.classList?.contains('ai-overlay-open'),
      route: app.dataset?.activeWorkspaceView || app.dataset?.desiredWorkspaceView || 'conversation',
      density: app.dataset?.density || 'comfortable'
    });
  }

  function dispatch(app, detail) {
    const win = app?.ownerDocument?.defaultView || root;
    if (!win?.dispatchEvent || typeof win.CustomEvent !== 'function') return;
    win.dispatchEvent(new win.CustomEvent('yance:workspace-layout-changed', { detail }));
  }

  function apply(app, input = {}, viewportWidth = root?.innerWidth || 0) {
    if (!app?.classList || !app?.style) return compute(input, viewportWidth);
    const result = compute(input, viewportWidth);
    app.classList.remove(...COMPATIBILITY_CLASSES);
    app.classList.add(`nav-${result.navMode}`);
    if (result.contactMode === 'compact' && !result.routed) app.classList.add('compact');
    if (result.contactMode === 'hidden' && !result.routed) app.classList.add('contacts-hidden');
    if (result.overlayMode) {
      app.classList.add('ai-overlay-mode');
      if (result.aiOverlayOpen) app.classList.add('ai-overlay-open');
    } else if (!result.aiVisible && !result.routed) {
      app.classList.add('ai-hidden');
    }
    app.dataset.navMode = result.navMode;
    app.dataset.contactMode = result.contactMode;
    app.dataset.aiVisible = String(result.aiVisible);
    app.dataset.aiOverlayOpen = String(result.aiOverlayOpen);
    app.dataset.viewportBand = result.viewportBand;
    app.dataset.density = result.density;
    app.style.setProperty('--ui-shell-columns', result.columns);
    app.style.setProperty('--ui-nav-current-w', result.navWidth);
    app.style.setProperty('--ui-contact-current-w', result.contactWidth);
    app.style.setProperty('--ui-ai-current-w', result.aiWidth);
    app.style.setProperty('--ui-route-main-column', result.mainColumn);
    dispatch(app, Object.freeze({ ...result }));
    return result;
  }

  function capture(app) {
    return Object.freeze({ ...read(app) });
  }

  function restore(app, snapshot, viewportWidth = root?.innerWidth || 0) {
    return apply(app, snapshot || {}, viewportWidth);
  }

  return Object.freeze({
    ROUTED_VIEWS: Object.freeze([...ROUTED_VIEWS]),
    COMPATIBILITY_CLASSES,
    viewportBand,
    normalize,
    compute,
    read,
    apply,
    capture,
    restore
  });
});
