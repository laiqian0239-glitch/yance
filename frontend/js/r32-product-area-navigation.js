'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const app = $('app');
  const navMenu = $('navMenu');
  if (!app || !navMenu || window.YanceProductAreaNavigation) return;

  const STORAGE_KEY = 'yance:r32:product-area-navigation:v1';
  const RELATIONSHIP_ROUTES = Object.freeze([
    { id: 'contacts', label: '概览与身份', target: 'navContacts', className: 'contact-page-open' },
    { id: 'profiles', label: '客户档案', target: 'navProfiles', className: 'profile-page-open' },
    { id: 'insights', label: '关系洞察', target: 'navInsights', className: 'insights-page-open' },
    { id: 'timeline', label: '关系轨迹', target: 'navTimeline', className: 'timeline-page-open' }
  ]);
  const SYSTEM_ROUTES = Object.freeze([
    { id: 'health', label: '系统健康', target: 'navSystemCenter', className: 'system-center-open' },
    { id: 'settings', label: '设置与恢复', target: 'navSettingsRecovery', className: 'settings-recovery-open' },
    { id: 'theme', label: '主题与外观', target: 'navThemes', className: 'theme-workspace-open' }
  ]);
  const HIDDEN_LEGACY_NAV = Object.freeze([
    'navContacts', 'navProfiles', 'navInsights', 'navTimeline', 'navSystemCenter', 'navSettingsRecovery', 'navThemes'
  ]);

  let state = { relationshipRoute: 'contacts', systemRoute: 'health' };
  try { state = { ...state, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}) }; } catch (_) {}

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function injectStyle() {
    if ($('r32ProductAreaNavigationStyle')) return;
    const style = document.createElement('style');
    style.id = 'r32ProductAreaNavigationStyle';
    style.textContent = `
      #navMenu .product-area-hidden{display:none!important}
      #navSystemEntries.product-area-hidden-host{display:none!important}
      .product-area-subnav{display:none;align-items:center;gap:7px;min-height:42px;padding:7px 10px;margin:0 0 10px;border:1px solid color-mix(in srgb,var(--theme-border-strong) 72%,transparent);border-radius:14px;background:var(--theme-panel-bg);box-shadow:var(--theme-shadow-soft);position:relative;top:auto;z-index:3;flex:0 0 auto}
      .product-area-subnav.show{display:flex}
      .product-area-subnav strong{font-size:var(--type-body-strong);color:var(--text);margin-right:3px;white-space:nowrap}
      .product-area-subnav button{min-height:30px;padding:6px 10px;border:1px solid color-mix(in srgb,var(--accent-primary) 16%,transparent);border-radius:10px;background:color-mix(in srgb,var(--theme-card-bg) 88%,transparent);color:var(--muted);font:600 var(--type-meta)/1.2 system-ui;cursor:pointer}
      .product-area-subnav button:hover{color:var(--text);border-color:color-mix(in srgb,var(--accent-primary) 32%,transparent)}
      .product-area-subnav button.active{color:var(--theme-on-accent);background:linear-gradient(135deg,var(--status-success),var(--accent-primary));border-color:color-mix(in srgb,var(--accent-primary) 58%,transparent);box-shadow:0 8px 24px color-mix(in srgb,var(--shadow-base) 14%,transparent)}
      .product-area-subnav .product-area-note{margin-left:auto;color:var(--muted2);font-size:var(--type-caption);white-space:nowrap}
      .contact-page-open #relationshipAreaSubnav,.profile-page-open #relationshipAreaSubnav,.insights-page-open #relationshipAreaSubnav,.timeline-page-open #relationshipAreaSubnav{display:flex}
      .system-center-open #systemAreaSubnav,.settings-recovery-open #systemAreaSubnav,.theme-workspace-open #systemAreaSubnav{display:flex}
      .app.settings-recovery-open .settings-recovery-workspace,.app.theme-workspace-open .theme-workspace{grid-template-rows:auto auto minmax(0,1fr)}
      .app.system-center-open .system-center-workspace{grid-template-rows:auto auto auto minmax(0,1fr)}
      .aiw30-business-mode .aiw30-tab[data-aiw-tab="models"],.aiw30-business-mode .aiw30-tab[data-aiw-tab="routing"]{display:none!important}
      .aiw30-business-mode .aiw30-tabs{grid-template-columns:minmax(0,1fr)}
      .aiw30-business-mode .aiw30-tab{min-width:0;white-space:normal;overflow-wrap:anywhere;writing-mode:horizontal-tb}
      .aiw30-business-mode .aiw30-health article:nth-child(2),.aiw30-business-mode .aiw30-health article:nth-child(4){display:none}
      .aiw30-business-mode .aiw30-health{grid-template-columns:repeat(2,minmax(0,1fr))}
      @media(max-width:900px){.product-area-subnav{overflow-x:auto;scrollbar-width:none}.product-area-subnav::-webkit-scrollbar{display:none}.product-area-subnav .product-area-note{display:none}.product-area-subnav button{white-space:nowrap}}
    `;
    document.head.appendChild(style);
  }

  function icon(kind) {
    if (kind === 'relationships') return '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"></circle><path d="M3 19a5 5 0 0 1 10 0M16 7a3 3 0 0 1 0 6M15 16a5 5 0 0 1 6 3"></path><path d="M12 11h3"></path></svg>';
    if (kind === 'system') return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M8 9h8M8 13h5M8 17h3"></path></svg>';
    return '';
  }

  function makeAreaButton(id, label, title, kind) {
    let button = $(id);
    if (button) return button;
    button = document.createElement('button');
    button.className = 'icon product-area-entry';
    button.id = id;
    button.title = title;
    button.setAttribute('aria-label', title);
    const iconHost = document.createElement('span');
    iconHost.className = 'product-area-icon';
    iconHost.innerHTML = icon(kind);
    const labelNode = document.createElement('b');
    labelNode.textContent = label;
    button.append(iconHost, labelNode);
    return button;
  }

  function clickTarget(id) {
    const target = $(id);
    if (!target || target.disabled) return false;
    target.click();
    return true;
  }

  function activeRelationshipRoute() {
    return RELATIONSHIP_ROUTES.find(route => app.classList.contains(route.className))?.id || state.relationshipRoute || 'contacts';
  }
  function activeSystemRoute() {
    return SYSTEM_ROUTES.find(route => app.classList.contains(route.className))?.id || state.systemRoute || 'health';
  }

  function openRelationship(routeId = state.relationshipRoute) {
    const route = RELATIONSHIP_ROUTES.find(row => row.id === routeId) || RELATIONSHIP_ROUTES[0];
    state.relationshipRoute = route.id;
    save();
    if (!clickTarget(route.target)) clickTarget('navContacts');
    queueMicrotask(sync);
  }

  function openSystem(routeId = state.systemRoute) {
    const route = SYSTEM_ROUTES.find(row => row.id === routeId) || SYSTEM_ROUTES[0];
    state.systemRoute = route.id;
    save();
    if (!clickTarget(route.target)) clickTarget('navSystemCenter');
    queueMicrotask(sync);
  }

  function routeAuthority() { return window.YanceWorkspaceRouteAuthority || null; }

  function persistActiveWorkspaceRoute() {
    const authority = routeAuthority();
    if (!authority) return 'conversation';
    const view = authority.activeView(app, 'conversation');
    app.dataset.activeWorkspaceView = view;
    if (!['conversation','contacts','profiles','timeline'].includes(view)) window.__Y27?.setExternalView?.(view);
    return view;
  }

  function restoreWorkspaceView(requestedView, source = 'runtime') {
    const authority = routeAuthority();
    const view = authority?.normalizeView?.(requestedView, 'conversation') || 'conversation';
    const directTargets = {
      conversation: 'navConversation', contacts: 'navContacts', profiles: 'navProfiles', timeline: 'navTimeline',
      insights: 'navInsights', 'ai-workbench': 'navAiWorkbench', accounts: 'navAccountsCenter'
    };
    if (view === 'system') openSystem('health');
    else if (view === 'settings') openSystem('settings');
    else if (view === 'theme') openSystem('theme');
    else clickTarget(directTargets[view] || 'navConversation');
    window.__YancePendingWorkspaceView = '';
    requestAnimationFrame(() => {
      const integrity = authority?.routeIntegrity?.(app, view) || { pass: true, actual: view, active: [] };
      app.dataset.activeWorkspaceView = integrity.actual || view;
      app.dataset.workspaceRouteIntegrity = integrity.pass ? 'pass' : 'fail';
      window.dispatchEvent(new CustomEvent('yance:workspace-route-restored', { detail: { ...integrity, source } }));
      if (!integrity.pass) console.error('[言策 WorkspaceRouteAuthority] 路由恢复不一致', integrity);
    });
    return view;
  }

  function ensureMainEntries() {
    const relationshipButton = makeAreaButton('navRelationships', '联系人与关系', '联系人与关系', 'relationships');
    const aiButton = $('navAiWorkbench');
    const accountButton = $('navAccountsCenter');
    const systemButton = makeAreaButton('navSystemSettings', '系统与设置', '系统与设置', 'system');
    const systemLabel = [...navMenu.querySelectorAll('.nav-group-label')].find(node => node.textContent.trim() === '系统功能');
    const anchor = systemLabel || $('navSystemEntries');

    const conversation = $('navConversation');
    const directReference = candidate => candidate?.parentElement === navMenu ? candidate : null;
    const relationshipReference = directReference(aiButton) || directReference(accountButton) || directReference(anchor);
    if (relationshipButton.parentElement !== navMenu || (relationshipReference && relationshipButton.nextElementSibling !== relationshipReference)) {
      navMenu.insertBefore(relationshipButton, relationshipReference);
    }
    relationshipButton.onclick = () => openRelationship();

    if (aiButton) {
      const label = aiButton.querySelector('b');
      if (label && label.textContent !== 'AI 回复大脑') label.textContent = 'AI 回复大脑';
      aiButton.title = 'AI回复大脑';
      aiButton.setAttribute('aria-label', 'AI回复大脑');
      if (aiButton.parentElement !== navMenu) navMenu.insertBefore(aiButton, directReference(anchor));
    }

    if (accountButton) {
      const label = accountButton.querySelector('b');
      if (label && label.textContent !== '账号与平台') label.textContent = '账号与平台';
      accountButton.title = '账号与平台';
      accountButton.setAttribute('aria-label', '账号与平台');
      if (accountButton.parentElement !== navMenu) navMenu.insertBefore(accountButton, directReference(anchor));
    }

    if (systemButton) {
      systemButton.onclick = () => openSystem();
      if (systemButton.parentElement !== navMenu) navMenu.insertBefore(systemButton, directReference(anchor));
    }

    HIDDEN_LEGACY_NAV.forEach(id => $(id)?.classList.add('product-area-hidden'));
    $('navSystemEntries')?.classList.add('product-area-hidden-host');
    systemLabel?.classList.add('product-area-hidden');
  }

  function makeSubnav(id, title, routes, note) {
    let nav = $(id);
    if (nav) return nav;
    nav = document.createElement('nav');
    nav.id = id;
    nav.className = 'product-area-subnav';
    nav.setAttribute('aria-label', title);
    const heading = document.createElement('strong');
    heading.textContent = title;
    nav.append(heading);
    routes.forEach(route => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.productRoute = String(route.id || '');
      button.textContent = String(route.label || '');
      nav.append(button);
    });
    const noteNode = document.createElement('span');
    noteNode.className = 'product-area-note';
    noteNode.textContent = note;
    nav.append(noteNode);
    nav.querySelectorAll('[data-product-route]').forEach(button => {
      button.onclick = () => id === 'relationshipAreaSubnav' ? openRelationship(button.dataset.productRoute) : openSystem(button.dataset.productRoute);
    });
    return nav;
  }

  function activeWorkspaceForRelationship() {
    if (app.classList.contains('contact-page-open')) return $('contactsWorkspace');
    if (app.classList.contains('profile-page-open')) return $('profilesWorkspace');
    if (app.classList.contains('insights-page-open')) return $('insightsWorkspace');
    if (app.classList.contains('timeline-page-open')) return $('timelineWorkspace');
    return null;
  }
  function activeWorkspaceForSystem() {
    if (app.classList.contains('system-center-open')) return $('systemCenterWorkspace');
    if (app.classList.contains('settings-recovery-open')) return $('settingsRecoveryWorkspace');
    if (app.classList.contains('theme-workspace-open')) return $('themeWorkspace');
    return null;
  }

  function mountSubnav(nav, workspace) {
    if (!nav || !workspace) return;
    const header = workspace.querySelector(':scope > header');
    if (header?.nextElementSibling !== nav) workspace.insertBefore(nav, header?.nextSibling || workspace.firstChild);
  }

  function syncSubnav() {
    const relationshipNav = makeSubnav('relationshipAreaSubnav', '联系人与关系', RELATIONSHIP_ROUTES, '同一联系人 · 同一权威数据源');
    const systemNav = makeSubnav('systemAreaSubnav', '系统与设置', SYSTEM_ROUTES, '同一系统 · 同一权威状态源');
    const relationshipWorkspace = activeWorkspaceForRelationship();
    const systemWorkspace = activeWorkspaceForSystem();
    if (relationshipWorkspace) mountSubnav(relationshipNav, relationshipWorkspace);
    if (systemWorkspace) mountSubnav(systemNav, systemWorkspace);

    const currentRelationship = activeRelationshipRoute();
    const currentSystem = activeSystemRoute();
    relationshipNav.querySelectorAll('[data-product-route]').forEach(button => button.classList.toggle('active', button.dataset.productRoute === currentRelationship));
    systemNav.querySelectorAll('[data-product-route]').forEach(button => button.classList.toggle('active', button.dataset.productRoute === currentSystem));
    if (relationshipWorkspace) { state.relationshipRoute = currentRelationship; save(); }
    if (systemWorkspace) { state.systemRoute = currentSystem; save(); }
  }

  function syncActiveArea() {
    const relationshipActive = Boolean(activeWorkspaceForRelationship());
    const systemActive = Boolean(activeWorkspaceForSystem());
    $('navRelationships')?.classList.toggle('active', relationshipActive);
    $('navSystemSettings')?.classList.toggle('active', systemActive);
    if (relationshipActive) {
      ['navContacts','navProfiles','navInsights','navTimeline'].forEach(id => $(id)?.classList.remove('active'));
    }
    if (systemActive) {
      ['navSettingsRecovery','navThemes'].forEach(id => $(id)?.classList.remove('active'));
    }
  }

  function sync() {
    ensureMainEntries();
    syncSubnav();
    syncActiveArea();
    persistActiveWorkspaceRoute();
  }


  function installAiWorkbenchMode() {
    const workspace = $('aiworkWorkspace');
    const actions = workspace?.querySelector('.aiw30-actions');
    if (!workspace || !actions) return;
    let mode = 'business';
    try { mode = localStorage.getItem('yance:r32:ai-workbench-mode') || 'business'; } catch (_) {}
    let button = $('aiwAdvancedModeToggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'aiwAdvancedModeToggle';
      button.type = 'button';
      actions.insertBefore(button, actions.firstChild);
    }
    const apply = next => {
      mode = next === 'advanced' ? 'advanced' : 'business';
      workspace.classList.toggle('aiw30-business-mode', mode === 'business');
      workspace.classList.toggle('aiw30-advanced-mode', mode === 'advanced');
      button.textContent = mode === 'advanced' ? '返回日常模式' : '高级模型设置';
      button.title = mode === 'advanced' ? '隐藏模型、路由与内部参数' : '查看模型、任务路由与开发诊断';
      button.setAttribute('aria-pressed', String(mode === 'advanced'));
      try { localStorage.setItem('yance:r32:ai-workbench-mode', mode); } catch (_) {}
      if (mode === 'business' && workspace.querySelector('.aiw30-tab.active[data-aiw-tab="models"],.aiw30-tab.active[data-aiw-tab="routing"]')) {
        workspace.querySelector('.aiw30-tab[data-aiw-tab="rules"]')?.click();
      }
    };
    button.onclick = () => apply(mode === 'advanced' ? 'business' : 'advanced');
    apply(mode);
  }

  function improveCommercialLabels() {
    const title = document.querySelector('#aiworkWorkspace .aiw30-title h1');
    if (title) title.textContent = 'AI回复大脑';
    const small = document.querySelector('#aiworkWorkspace .aiw30-title small');
    if (small) small.textContent = '理解、导演、候选、人格与学习';
    const paragraph = document.querySelector('#aiworkWorkspace .aiw30-title p');
    if (paragraph) paragraph.textContent = '统一管理对话理解、导演策略、3–5条真人候选、Yeonhee人物基线、回复学习以及模型路由。日常操作保持简单，高级模型与诊断按需展开。';
    $('aiworkWorkspace')?.setAttribute('aria-label', 'AI回复大脑');
  }

  injectStyle();
  routeAuthority()?.watchRouteIntegrity?.(app, { source: 'r32-product-area-navigation' });
  improveCommercialLabels();
  installAiWorkbenchMode();
  sync();

  const observer = new MutationObserver(() => sync());
  observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  observer.observe(navMenu, { childList: true, subtree: true });
  window.addEventListener('yance:r32-data-ready', sync);
  window.addEventListener('popstate', sync);
  window.addEventListener('yance:workspace-route-restore-requested', event => restoreWorkspaceView(event?.detail?.view, event?.detail?.source || 'event'));
  queueMicrotask(() => {
    const pendingView = window.__YancePendingWorkspaceView || window.__Y27?.getState?.().currentView;
    if (pendingView && !['conversation','contacts','profiles','timeline'].includes(String(pendingView))) restoreWorkspaceView(pendingView, 'startup-pending');
  });

  window.YanceProductAreaNavigation = Object.freeze({
    openRelationship,
    openSystem,
    restoreWorkspaceView,
    sync,
    getState: () => ({ ...state })
  });
})();
