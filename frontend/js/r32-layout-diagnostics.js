(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceLayoutDiagnostics = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const ROUTE_LAYOUTS = Object.freeze([
    Object.freeze({ view: 'contacts', workspaceId: 'contactsWorkspace', label: '联系人中心' }),
    Object.freeze({ view: 'profiles', workspaceId: 'profilesWorkspace', label: '客户档案' }),
    Object.freeze({ view: 'timeline', workspaceId: 'timelineWorkspace', label: '关系轨迹' }),
    Object.freeze({ view: 'insights', workspaceId: 'insightsWorkspace', label: '关系洞察' }),
    Object.freeze({ view: 'ai-workbench', workspaceId: 'aiworkWorkspace', label: 'AI工作台' }),
    Object.freeze({ view: 'accounts', workspaceId: 'accountCenterWorkspace', label: '统一账号中心' }),
    Object.freeze({ view: 'system', workspaceId: 'systemCenterWorkspace', label: '系统中心' }),
    Object.freeze({ view: 'settings', workspaceId: 'settingsRecoveryWorkspace', label: '设置与恢复' }),
    Object.freeze({ view: 'theme', workspaceId: 'themeWorkspace', label: '主题与外观' })
  ]);

  function rectangleOverlapArea(a = {}, b = {}) {
    const left = Math.max(Number(a.left || 0), Number(b.left || 0));
    const right = Math.min(Number(a.right || 0), Number(b.right || 0));
    const top = Math.max(Number(a.top || 0), Number(b.top || 0));
    const bottom = Math.min(Number(a.bottom || 0), Number(b.bottom || 0));
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function collectHeaderFlowMetrics(workspace) {
    if (!workspace?.querySelector) return { headerSubnavOverlapArea: 0, clippedTitleSamples: [] };
    const header = workspace.querySelector(':scope > header');
    const subnav = workspace.querySelector(':scope > .product-area-subnav');
    const headerRect = header?.getBoundingClientRect?.();
    const subnavRect = subnav?.getBoundingClientRect?.();
    const clippedTitleSamples = [];
    for (const node of workspace.querySelectorAll(':scope > header h1,:scope > header h2,:scope > header p,:scope > header button')) {
      if (clippedTitleSamples.length >= 5) break;
      if ((node.scrollWidth || 0) > (node.clientWidth || 0) + 2 || (node.scrollHeight || 0) > (node.clientHeight || 0) + 2) {
        clippedTitleSamples.push(String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48));
      }
    }
    return {
      headerSubnavOverlapArea: headerRect && subnavRect ? rectangleOverlapArea(headerRect, subnavRect) : 0,
      clippedTitleSamples
    };
  }

  function expectedWorkspaceWidth(viewportWidth) {
    const width = Math.max(0, Number(viewportWidth) || 0);
    return Math.min(720, Math.max(320, Math.round(width * 0.55)));
  }

  function evaluateWorkspaceMetrics(metrics = {}, viewportWidth = 0, viewportHeight = 0) {
    const minimumWidth = expectedWorkspaceWidth(viewportWidth);
    const width = Math.max(0, Number(metrics.width ?? metrics.clientWidth) || 0);
    const clientWidth = Math.max(0, Number(metrics.clientWidth ?? width) || 0);
    const scrollWidth = Math.max(0, Number(metrics.scrollWidth ?? clientWidth) || 0);
    const hasHeightMetric = metrics.height != null || metrics.clientHeight != null;
    const height = Math.max(0, Number(metrics.height ?? metrics.clientHeight) || 0);
    const clientHeight = Math.max(0, Number(metrics.clientHeight ?? height) || 0);
    const minimumHeight = Math.min(240, Math.max(120, Math.round((Number(viewportHeight) || 0) * 0.22)));
    const display = String(metrics.display || 'block');
    const verticalTextSamples = Array.isArray(metrics.verticalTextSamples) ? metrics.verticalTextSamples.filter(Boolean) : [];
    const clippedTitleSamples = Array.isArray(metrics.clippedTitleSamples) ? metrics.clippedTitleSamples.filter(Boolean) : [];
    const headerSubnavOverlapArea = Math.max(0, Number(metrics.headerSubnavOverlapArea || 0));
    const visible = display !== 'none' && width > 0 && clientWidth > 0 && (!hasHeightMetric || (height > 0 && clientHeight > 0));
    const widthPass = visible && width >= minimumWidth;
    const heightPass = !hasHeightMetric || (visible && height >= minimumHeight);
    const overflowPass = visible && scrollWidth <= clientWidth + 4;
    const verticalTextPass = verticalTextSamples.length === 0;
    const headerFlowPass = headerSubnavOverlapArea < 1 && clippedTitleSamples.length === 0;
    const pass = visible && widthPass && heightPass && overflowPass && verticalTextPass && headerFlowPass;
    const failures = [];
    if (!visible) failures.push('工作区未显示');
    if (visible && !widthPass) failures.push(`工作区宽度 ${Math.round(width)}px，低于 ${minimumWidth}px`);
    if (hasHeightMetric && !heightPass) failures.push(`工作区高度 ${Math.round(height)}px，低于 ${minimumHeight}px`);
    if (visible && !overflowPass) failures.push(`横向溢出 ${Math.round(scrollWidth - clientWidth)}px`);
    if (!verticalTextPass) failures.push(`疑似逐字竖排：${verticalTextSamples.slice(0, 3).join('、')}`);
    if (headerSubnavOverlapArea >= 1) failures.push(`标题与页签重叠 ${Math.round(headerSubnavOverlapArea)}px²`);
    if (clippedTitleSamples.length) failures.push(`标题或操作被裁切：${clippedTitleSamples.slice(0, 3).join('、')}`);
    return Object.freeze({ ...metrics, width, clientWidth, scrollWidth, height, clientHeight, minimumWidth, minimumHeight, visible, widthPass, heightPass, overflowPass, verticalTextPass, headerFlowPass, headerSubnavOverlapArea, clippedTitleSamples: Object.freeze(clippedTitleSamples), pass, failures: Object.freeze(failures) });
  }

  function collectVerticalTextSamples(workspace, win) {
    if (!workspace || !win?.getComputedStyle) return [];
    const samples = [];
    const nodes = workspace.querySelectorAll('button,h1,h2,h3,h4,p,span,b,label,small,strong,em');
    for (const node of nodes) {
      if (samples.length >= 5) break;
      const value = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (value.length < 2 || value.length > 80) continue;
      const style = win.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      const fontSize = Math.max(8, Number.parseFloat(style.fontSize) || 12);
      if (rect.width > 0 && rect.height > 0 && rect.width < Math.max(20, fontSize * 1.55) && rect.height > rect.width * 1.8) samples.push(value.slice(0, 24));
    }
    return samples;
  }

  function frame(win) {
    return new Promise(resolve => (win?.requestAnimationFrame || (callback => setTimeout(callback, 0)))(() => resolve()));
  }

  async function twoFrames(win) {
    await frame(win);
    await frame(win);
  }

  function workspaceReady({ routeAuthority, app, route, workspace, win }) {
    const integrity = routeAuthority?.routeIntegrity?.(app, route.view);
    if (integrity && !integrity.pass) return false;
    if (!workspace) return false;
    const style = win?.getComputedStyle?.(workspace) || workspace.style || {};
    const rect = workspace.getBoundingClientRect?.() || {};
    return style.display !== 'none' && Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0;
  }

  async function waitForRouteReady(context = {}, options = {}) {
    const attempts = Math.max(1, Number(options.attempts ?? 30) || 30);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await frame(context.win);
      if (workspaceReady(context)) return true;
    }
    return false;
  }

  function measureWorkspace({ route, workspace, win }) {
    if (!workspace) {
      return evaluateWorkspaceMetrics({ ...route, display: 'none', width: 0, clientWidth: 0, scrollWidth: 0, height: 0, clientHeight: 0, verticalTextSamples: [], missing: true }, win?.innerWidth || 0, win?.innerHeight || 0);
    }
    const style = win?.getComputedStyle?.(workspace) || workspace.style || {};
    const rect = workspace.getBoundingClientRect?.() || {};
    const headerFlow = collectHeaderFlowMetrics(workspace);
    return evaluateWorkspaceMetrics({
      ...route,
      ...headerFlow,
      display: style.display,
      width: rect.width,
      clientWidth: workspace.clientWidth,
      height: rect.height,
      clientHeight: workspace.clientHeight,
      scrollWidth: workspace.scrollWidth,
      verticalTextSamples: collectVerticalTextSamples(workspace, win)
    }, win?.innerWidth || 0, win?.innerHeight || 0);
  }

  function failureResult(route, status, failures, detail = {}) {
    return Object.freeze({
      ...route,
      ...detail,
      status,
      pass: false,
      failures: Object.freeze(Array.isArray(failures) ? failures : [String(failures || status)])
    });
  }

  async function runRouteMatrix(options = {}) {
    const doc = options.document || root?.document || null;
    const win = options.window || root || null;
    const app = options.app || doc?.getElementById?.('app');
    const routes = Array.isArray(options.routes) && options.routes.length ? options.routes : ROUTE_LAYOUTS;
    const routeAuthority = options.routeAuthority || win?.YanceWorkspaceRouteAuthority;
    const layoutAuthority = options.layoutAuthority || win?.YanceWorkspaceLayoutAuthority;
    const waitForReady = options.waitForReady || waitForRouteReady;
    const measure = options.measure || measureWorkspace;
    if (!doc || !win || !app || !routeAuthority?.applyRoute) return [];

    const originalRoute = routeAuthority.activeView?.(app, 'conversation') || app.dataset?.activeWorkspaceView || 'conversation';
    const originalLayout = layoutAuthority?.capture?.(app) || null;
    const originalFocus = doc.activeElement;
    const originalScroll = Object.freeze({ x: Number(win.scrollX || 0), y: Number(win.scrollY || 0) });
    const results = [];

    try {
      for (const route of routes) {
        const activation = routeAuthority.applyRoute(app, route.view, { source: 'layout-diagnostics' });
        const integrity = routeAuthority.routeIntegrity?.(app, route.view) || activation;
        if (!activation?.pass || (integrity && !integrity.pass)) {
          results.push(failureResult(route, 'route_activation_failed', [`路由未激活：期望 ${route.view}，实际 ${integrity?.actual || activation?.actual || 'unknown'}`], { activation, integrity }));
          continue;
        }

        await twoFrames(win);
        const workspace = doc.getElementById(route.workspaceId);
        const ready = await waitForReady({ app, document: doc, win, route, workspace, routeAuthority, layoutAuthority }, options.readyOptions || {});
        if (!ready) {
          results.push(failureResult(route, 'route_ready_timeout', ['路由已激活，但工作区未在等待窗口内完成可见布局']));
          continue;
        }

        const metrics = await measure({ app, document: doc, win, route, workspace, routeAuthority, layoutAuthority });
        results.push(Object.freeze({
          ...metrics,
          view: route.view,
          workspaceId: route.workspaceId,
          label: route.label,
          status: metrics.pass ? 'pass' : 'workspace_layout_failed'
        }));
      }
    } finally {
      routeAuthority.applyRoute(app, originalRoute, { source: 'layout-diagnostics-restore' });
      if (layoutAuthority?.restore && originalLayout) layoutAuthority.restore(app, { ...originalLayout, route: originalRoute }, win.innerWidth || 0);
      await twoFrames(win);
      try { originalFocus?.focus?.({ preventScroll: true }); } catch (_) { originalFocus?.focus?.(); }
      win.scrollTo?.(originalScroll.x, originalScroll.y);
    }
    return results;
  }

  async function probeWorkspaceLayouts(options = {}) {
    return runRouteMatrix(options);
  }

  return Object.freeze({
    ROUTE_LAYOUTS,
    rectangleOverlapArea,
    collectHeaderFlowMetrics,
    expectedWorkspaceWidth,
    evaluateWorkspaceMetrics,
    collectVerticalTextSamples,
    frame,
    twoFrames,
    workspaceReady,
    waitForRouteReady,
    measureWorkspace,
    runRouteMatrix,
    probeWorkspaceLayouts
  });
});
