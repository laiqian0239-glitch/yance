(function attachThemeComputedAudit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceThemeComputedAudit = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis, function createThemeComputedAudit() {
  'use strict';

  const NODE_THEME_CATALOG = (() => {
    if (typeof require !== 'function') return null;
    try { return require('../theme-catalog.json'); } catch (_) { return null; }
  })();
  const THEME_IDS = Object.freeze((NODE_THEME_CATALOG?.themes || []).map(theme => cleanThemeId(theme?.id)).filter(Boolean));

  function cleanThemeId(value) { return String(value == null ? '' : value).trim(); }

  async function resolveThemeIds(documentRef, requested) {
    if (Array.isArray(requested) && requested.length) return [...new Set(requested.map(cleanThemeId).filter(Boolean))];
    const runtimeThemes = documentRef?.defaultView?.YanceThemeCatalog?.themes;
    if (Array.isArray(runtimeThemes) && runtimeThemes.length) return [...new Set(runtimeThemes.map(theme => cleanThemeId(theme?.id)).filter(Boolean))];
    if (THEME_IDS.length) return [...THEME_IDS];
    const fetchFn = documentRef?.defaultView?.fetch;
    if (typeof fetchFn === 'function') {
      const response = await fetchFn('/theme-catalog.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`主题目录加载失败：HTTP ${response.status}`);
      const catalog = await response.json();
      const ids = Array.isArray(catalog?.themes) ? catalog.themes.map(theme => cleanThemeId(theme?.id)).filter(Boolean) : [];
      if (ids.length) return [...new Set(ids)];
    }
    throw new Error('主题审计无法读取统一主题目录');
  }

  const DEFAULT_PROBES = Object.freeze([
    { id: 'titlebar', selector: '.desktop-titlebar', required: true },
    { id: 'navigation', selector: '.nav', required: true },
    { id: 'conversation-list', selector: '.contacts', required: true },
    { id: 'chat-stage', selector: '.chat', required: true },
    { id: 'composer', selector: '.composer', required: true },
    { id: 'ai-panel', selector: '.ai', required: true },
    { id: 'contact-card', selector: '.contact-card', required: false },
    { id: 'candidate-card', selector: '.candidate', required: false },
    { id: 'relationship-card', selector: '.insight29-section', required: false },
    { id: 'ai-workbench', selector: '.aiw30-content', required: false },
    { id: 'dialog', selector: '.r32-dialog, dialog', required: false },
    { id: 'context-menu', selector: '.r32-message-menu:not([hidden]), .r32-contact-context-menu:not([hidden])', required: false }
  ]);

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function parseColor(value) {
    const text = clean(value).toLowerCase();
    if (!text || text === 'transparent') return { r: 0, g: 0, b: 0, a: 0, text };
    const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,\/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
      a: rgb[4] == null ? 1 : Math.max(0, Math.min(1, Number(rgb[4]))),
      text
    };
    const hex = text.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let raw = hex[1];
      if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(char => char + char).join('');
      const hasAlpha = raw.length === 8;
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
        a: hasAlpha ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
        text
      };
    }
    return null;
  }

  function luminance(color) {
    if (!color) return 0;
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function contrastRatio(foreground, background) {
    if (!foreground || !background || foreground.a <= 0.05 || background.a <= 0.05) return null;
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function auditSnapshot(snapshot = {}, probe = {}) {
    const failures = [], warnings = [];
    const background = parseColor(snapshot.backgroundColor);
    const foreground = parseColor(snapshot.color);
    const border = parseColor(snapshot.borderTopColor || snapshot.borderColor);
    if (!background || background.a <= 0.02) failures.push({ code: 'TRANSPARENT_STRUCTURAL_SURFACE', message: '结构背景为透明或无法解析' });
    if (!foreground || foreground.a <= 0.05) failures.push({ code: 'MISSING_TEXT_COLOR', message: '文字颜色为空或无法解析' });
    const ratio = contrastRatio(foreground, background);
    if (ratio != null && ratio < 3) failures.push({ code: 'LOW_TEXT_CONTRAST', message: `文字对比度仅 ${ratio.toFixed(2)}:1` });
    else if (ratio != null && ratio < 4.5) warnings.push({ code: 'MODERATE_TEXT_CONTRAST', message: `正文对比度 ${ratio.toFixed(2)}:1，长文本需人工复核` });
    if (probe.requireBorder && (!border || border.a <= 0.02)) warnings.push({ code: 'MISSING_BORDER', message: '边框不可见' });
    return { ok: failures.length === 0, failures, warnings, ratio };
  }

  function nextFrame(view) {
    return new Promise(resolve => {
      const raf = view?.requestAnimationFrame || (callback => setTimeout(callback, 16));
      raf(() => raf(resolve));
    });
  }

  async function auditDocumentTheme(documentRef, themeId, probes = DEFAULT_PROBES) {
    const view = documentRef?.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!documentRef?.documentElement || !view?.getComputedStyle) throw new Error('主题计算样式审计需要真实 DOM');
    const rows = [];
    for (const probe of probes) {
      const element = documentRef.querySelector(probe.selector);
      if (!element) {
        rows.push({ themeId, probeId: probe.id, selector: probe.selector, status: probe.required ? 'failed' : 'skipped', failures: probe.required ? [{ code: 'REQUIRED_COMPONENT_MISSING', message: '必需组件未渲染' }] : [], warnings: [] });
        continue;
      }
      const style = view.getComputedStyle(element);
      const snapshot = {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderTopColor: style.borderTopColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow
      };
      const result = auditSnapshot(snapshot, probe);
      rows.push({ themeId, probeId: probe.id, selector: probe.selector, status: result.ok ? (result.warnings.length ? 'warning' : 'pass') : 'failed', snapshot, ...result });
    }
    return rows;
  }

  async function auditAllThemes(documentRef = typeof document !== 'undefined' ? document : null, options = {}) {
    if (!documentRef?.documentElement) throw new Error('主题审计没有可用文档');
    const root = documentRef.documentElement;
    const original = {
      theme: root.dataset.theme || '',
      preview: root.dataset.themePreview || '',
      motion: root.dataset.motionLevel || '',
      background: root.dataset.backgroundEffect || ''
    };
    const themeIds = await resolveThemeIds(documentRef, options.themeIds);
    const probes = Array.isArray(options.probes) && options.probes.length ? options.probes : DEFAULT_PROBES;
    const results = [];
    try {
      root.dataset.motionLevel = 'off';
      root.dataset.backgroundEffect = 'none';
      root.dataset.themePreview = 'true';
      for (const themeId of themeIds) {
        root.dataset.theme = themeId;
        await nextFrame(documentRef.defaultView);
        results.push(...await auditDocumentTheme(documentRef, themeId, probes));
      }
    } finally {
      if (original.theme) root.dataset.theme = original.theme; else delete root.dataset.theme;
      if (original.preview) root.dataset.themePreview = original.preview; else delete root.dataset.themePreview;
      if (original.motion) root.dataset.motionLevel = original.motion; else delete root.dataset.motionLevel;
      if (original.background) root.dataset.backgroundEffect = original.background; else delete root.dataset.backgroundEffect;
      await nextFrame(documentRef.defaultView);
    }
    const failed = results.filter(row => row.status === 'failed');
    const warnings = results.filter(row => row.status === 'warning');
    return {
      schemaVersion: 1,
      auditedAt: new Date().toISOString(),
      themes: themeIds.length,
      probes: probes.length,
      checks: results.length,
      passed: results.filter(row => row.status === 'pass').length,
      warningCount: warnings.length,
      failedCount: failed.length,
      ok: failed.length === 0,
      results
    };
  }

  const security = (typeof globalThis !== 'undefined' && globalThis.YanceSecurity) || (typeof require === 'function' ? require('./r32-security.js') : null);
  if (!security?.escapeHtmlText || !security?.escapeHtmlAttribute) throw new Error('YANCE_SECURITY_AUTHORITY_UNAVAILABLE');
  const htmlText = security.escapeHtmlText;
  const htmlAttr = security.escapeHtmlAttribute;

  function renderReport(host, report) {
    if (!host) return;
    const failures = report.results.filter(row => row.status === 'failed');
    const warnings = report.results.filter(row => row.status === 'warning');
    host.innerHTML = `<div class="theme32-audit-summary ${htmlAttr(report.ok ? 'pass' : 'fail')}"><b>${htmlText(report.ok ? `${report.themes} 套主题计算样式审计通过` : `发现 ${report.failedCount} 项阻断问题`)}</b><span>${htmlText(report.themes)} 套主题 · ${htmlText(report.checks)} 个计算样式检查 · ${htmlText(report.warningCount)} 项提示</span></div>${failures.length || warnings.length ? `<div class="theme32-audit-list">${[...failures, ...warnings].slice(0, 80).map(row => `<article class="${htmlAttr(row.status)}"><b>${htmlText(row.themeId)} · ${htmlText(row.probeId)}</b><p>${htmlText([...(row.failures || []), ...(row.warnings || [])].map(item => item.message).join('；'))}</p><small>${htmlText(row.selector)}</small></article>`).join('')}</div>` : '<p class="theme32-audit-clean">所有已渲染关键组件均读取当前主题的真实计算样式。</p>'}`;
  }

  function install(documentRef = typeof document !== 'undefined' ? document : null) {
    if (!documentRef) return false;
    const workspace = documentRef.getElementById('themeWorkspace');
    if (!workspace || documentRef.getElementById('theme32ComputedAudit')) return false;
    const footer = workspace.querySelector('.theme32-footer');
    const section = documentRef.createElement('section');
    section.className = 'theme32-section theme32-computed-audit';
    section.id = 'theme32ComputedAudit';
    section.innerHTML = '<div class="theme32-section-head"><div><h2>完整主题目录真实计算样式审计</h2><p>逐主题读取标题栏、导航、会话、AI、关系、弹窗和菜单的 getComputedStyle，不再只检查 CSS 文件是否包含变量。</p></div><button class="theme32-button" id="theme32RunComputedAudit">运行审计</button></div><div id="theme32ComputedAuditReport"><p>尚未运行。请先打开各核心页面一次，以便动态组件进入审计范围。</p></div>';
    const body = workspace.querySelector('.theme32-body') || workspace;
    if (footer?.parentElement === body) body.insertBefore(section, footer);
    else body.appendChild(section);
    const button = documentRef.getElementById('theme32RunComputedAudit');
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = '正在逐主题检查…';
      const reportHost = documentRef.getElementById('theme32ComputedAuditReport');
      try {
        const report = await auditAllThemes(documentRef);
        renderReport(reportHost, report);
        try { localStorage.setItem('yance27:r32:last-theme-computed-audit', JSON.stringify(report)); } catch (_) {}
        documentRef.defaultView?.dispatchEvent?.(new CustomEvent('yance:theme-computed-audit-complete', { detail: report }));
      } catch (error) {
        reportHost.innerHTML = `<div class="theme32-audit-summary fail"><b>主题审计失败</b><span>${htmlText(error.message || error)}</span></div>`;
      } finally {
        button.disabled = false;
        button.textContent = '运行审计';
      }
    };
    return true;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(document), { once: true });
    else install(document);
  }

  return { THEME_IDS, resolveThemeIds, DEFAULT_PROBES, parseColor, contrastRatio, auditSnapshot, auditDocumentTheme, auditAllThemes, renderReport, install };
});
