'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const security = window.YanceSecurity;
  if (!security?.escapeHtmlText || !security?.escapeHtmlAttribute || !security?.sanitizeCssColor) return;
  const { escapeHtmlText: htmlText, escapeHtmlAttribute: htmlAttr, sanitizeCssColor } = security;
  const app = $('app');
  const navBottom = document.querySelector('.nav-bottom');
  if (!app || !navBottom || $('navThemes')) return;

  const MOTION = Object.freeze([
    ['off', '关闭', '关闭所有非必要动效'],
    ['subtle', '轻微', '仅保留短过渡和状态反馈'],
    ['balanced', '平衡', '轻量流光、呼吸和过渡'],
    ['enhanced', '沉浸', '完整氛围、流光与状态动画']
  ]);
  const BACKGROUNDS = Object.freeze([
    ['none', '纯净'], ['ambient', '氛围'], ['grid', '网格'], ['aurora', '极光']
  ]);
  const FONT_PROFILES = Object.freeze([
    ['theme', '跟随主题'], ['sans', '商务无衬线'], ['humanist', '人文无衬线'], ['serif', '舒适衬线'], ['mono', '等宽代码']
  ]);
  const SPACING = Object.freeze([
    ['theme', '跟随主题'], ['compact', '紧凑'], ['comfortable', '舒适'], ['spacious', '宽松']
  ]);
  const THEME_MODES = Object.freeze([
    ['manual', '手动'], ['system', '跟随系统'], ['schedule', '按时间切换']
  ]);
  const TOKEN_KEYS = Object.freeze([
    'bg', 'bg2', 'nav', 'panel', 'panel2', 'card', 'card2', 'line', 'line2', 'text', 'muted', 'muted2',
    'cyan', 'cyan2', 'green', 'violet', 'pink', 'gold', 'red', 'theme-accent', 'theme-accent-2', 'theme-accent-3', 'theme-glow', 'theme-grid'
  ]);
  const classesToClose = [
    'immersive', 'contacts-hidden', 'ai-hidden', 'compact', 'ai-open-small', 'contact-page-open', 'profile-page-open',
    'timeline-page-open', 'insights-page-open', 'aiwork-page-open', 'account-center-open', 'system-center-open', 'settings-recovery-open'
  ];
  const DEFAULT_TUNING = Object.freeze({ backgroundDepth: 50, glowIntensity: 50, glassOpacity: 72, accentSaturation: 100 });
  const DEFAULT_TYPOGRAPHY = Object.freeze({ fontProfile: 'theme', fontScale: 100, lineHeight: 155, spacing: 'theme' });
  const FONT_STACKS = Object.freeze({
    sans: '"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif',
    humanist: '"Segoe UI Variable Text","Microsoft YaHei UI","PingFang SC",sans-serif',
    serif: '"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,serif',
    mono: '"Cascadia Code","SFMono-Regular",Consolas,"Liberation Mono",monospace'
  });

  let catalog = { themes: [], defaultThemeId: 'midnight-cyan', lightDefaultThemeId: 'jade-paper', darkDefaultThemeId: 'midnight-cyan' };
  let themeMap = new Map();
  let busy = false;
  let saveTimer = null;
  let scheduleTimer = null;
  let unsubscribeThemeStore = null;
  let historyMutationObserver = null;
  let current = {
    ready: false,
    themeId: 'midnight-cyan',
    previewThemeId: '',
    motionLevel: 'balanced',
    backgroundEffect: 'ambient',
    themeMode: 'manual',
    lightThemeId: 'jade-paper',
    darkThemeId: 'midnight-cyan',
    scheduleDayStart: '07:00',
    scheduleNightStart: '19:00',
    favoriteThemeIds: [],
    recentThemeIds: [],
    themeTuning: { ...DEFAULT_TUNING },
    typography: { ...DEFAULT_TYPOGRAPHY },
    customThemePresets: [],
    activeCustomThemePresetId: ''
  };
  const filters = { query: '', style: '全部', brightness: '全部', scene: '全部', texture: '全部', view: 'all' };
  const systemColorScheme = window.matchMedia?.('(prefers-color-scheme: light)') || null;
  const handleSystemColorScheme = () => { if (current.themeMode === 'system') { setRootState(); render(); } };

  const button = document.createElement('button');
  button.className = 'icon';
  button.id = 'navThemes';
  button.title = '主题与外观';
  button.setAttribute('aria-label', '主题与外观');
  button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-1.2-.8-2-2-2h-2.1a2 2 0 0 1-2-2V5.1c0-1.2-.8-2.1-2-2.1Z"></path><circle cx="7.5" cy="11" r="1"></circle><circle cx="10" cy="7.5" r="1"></circle><circle cx="8.5" cy="15" r="1"></circle></svg><b>主题与外观</b>';
  (window.YanceConversationCenterV2?.registerNavEntry?.(button, { group: 'quick', order: 10 }) || navBottom.insertBefore(button, $('displaySettingsBtn')));

  const workspace = document.createElement('section');
  workspace.id = 'themeWorkspace';
  workspace.className = 'theme-workspace ui-route-scroll-root';
  workspace.setAttribute('aria-label', '主题与外观');
  workspace.innerHTML = `
    <header class="theme32-head">
      <div><small>YANCE · THEME & MOTION STUDIO</small><h1>主题与外观</h1><p>覆盖深色、浅色、极简、场景化和无障碍主题。卡片可直接查看侧边栏、聊天气泡和操作按钮的迷你预览；预览与正式应用相互隔离。</p></div>
      <div class="theme32-head-actions"><button class="theme32-button" id="theme32Back">返回会话</button><button class="theme32-button" id="theme32CancelPreview">取消预览</button><button class="theme32-button primary" id="theme32Apply">应用主题</button></div>
    </header>
    <div class="theme32-body ui-route-scroll-surface">
      <section class="theme32-summary">
        <article><span>当前视觉状态</span><b id="theme32Current">正在读取 StoreManager</b><p id="theme32CurrentMeta">主题、排版、动效与自动切换由统一 UIState 驱动。</p></article>
        <article><span>主题数量</span><b id="theme32Count">正在加载</b><p>收藏、最近使用和个人主题会置顶，不再依赖平铺查找。</p></article>
        <article><span>无障碍与性能</span><b id="theme32A11y">自动适配</b><p>高对比、色觉安全、减少动画和纯净背景可组合使用。</p></article>
      </section>

      <section class="theme32-section theme32-browser">
        <div class="theme32-section-head"><div><h2>主题浏览与筛选</h2><p>按风格、亮度、场景和质感过滤；收藏与最近使用会优先展示。</p></div><span class="theme32-status" id="theme32PreviewState">未在预览</span></div>
        <div class="theme32-toolbar">
          <label class="theme32-search"><span>搜索</span><input id="theme32Search" type="search" placeholder="名称、标签、场景"></label>
          <label><span>风格</span><select id="theme32Style"></select></label>
          <label><span>亮度</span><select id="theme32Brightness"></select></label>
          <label><span>场景</span><select id="theme32Scene"></select></label>
          <label><span>质感</span><select id="theme32Texture"></select></label>
        </div>
        <div class="theme32-view-tabs" id="theme32ViewTabs"><button data-view="all" class="active">全部主题</button><button data-view="favorite">我的收藏</button><button data-view="recent">最近使用</button></div>
        <div id="theme32Grid"></div>
      </section>

      <section class="theme32-section">
        <div class="theme32-section-head"><div><h2>主题微调与排版</h2><p>在当前主题上调整深浅、光晕、玻璃透明度、主色饱和度、字体和行高，并可保存为个人主题。</p></div><button class="theme32-button" id="theme32SavePreset">保存为个人主题</button></div>
        <div class="theme32-tuning-grid">
          <article class="theme32-control"><header><h3>视觉强度</h3><span>实时生效</span></header><div id="theme32Tuning"></div></article>
          <article class="theme32-control"><header><h3>字体与排版</h3><span>系统字体，无需额外字体包</span></header><div id="theme32Typography"></div></article>
        </div>
        <div class="theme32-personal" id="theme32Personal"></div>
      </section>

      <section class="theme32-section">
        <div class="theme32-section-head"><div><h2>自适应切换</h2><p>支持手动、跟随 Windows 深浅色，以及按日间/夜间时段自动切换。</p></div><span class="theme32-status" id="theme32ModeValue"></span></div>
        <div class="theme32-auto-grid">
          <div class="theme32-options" id="theme32Mode"></div>
          <label><span>日间浅色主题</span><select id="theme32LightTheme"></select></label>
          <label><span>夜间深色主题</span><select id="theme32DarkTheme"></select></label>
          <label><span>日间开始</span><input id="theme32DayStart" type="time" step="60"></label>
          <label><span>夜间开始</span><input id="theme32NightStart" type="time" step="60"></label>
        </div>
      </section>

      <section class="theme32-section">
        <div class="theme32-section-head"><div><h2>动态氛围与背景</h2><p>从关闭所有动效到沉浸光影分四档；系统“减少动画”设置始终拥有更高优先级。</p></div><span class="theme32-status">性能不足时自动降级</span></div>
        <div class="theme32-controls">
          <article class="theme32-control"><header><h3>动态氛围强度</h3><span id="theme32MotionValue"></span></header><input class="theme32-motion-range" id="theme32MotionRange" type="range" min="0" max="3" step="1"><div class="theme32-range-labels"><span>关闭</span><span>轻微</span><span>平衡</span><span>沉浸</span></div></article>
          <article class="theme32-control"><header><h3>背景效果</h3><span id="theme32BackgroundValue"></span></header><div class="theme32-options four" id="theme32Background"></div></article>
        </div>
      </section>
      <footer class="theme32-footer"><p id="theme32Status">视觉设置通过 StoreManager 同步到所有页面和窗口。</p><div class="theme32-footer-actions"><button class="theme32-button" id="theme32Reset">恢复经典主题</button><button class="theme32-button primary" id="theme32ApplyBottom">应用主题</button></div></footer>
    </div>`;
  app.appendChild(workspace);

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  }
  function unique(values) { return [...new Set(values.filter(Boolean))]; }
  function themeById(id) { return themeMap.get(clean(id)) || themeMap.get(catalog.defaultThemeId) || catalog.themes[0]; }
  function labelFor(list, value) { return list.find(row => row[0] === value)?.[1] || value; }
  function clockMinutes(value) {
    const match = clean(value).match(/^(\d{2}):(\d{2})$/u);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  }
  function scheduleUsesLight(now = new Date()) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const day = clockMinutes(current.scheduleDayStart || '07:00');
    const night = clockMinutes(current.scheduleNightStart || '19:00');
    return day <= night ? minute >= day && minute < night : minute >= day || minute < night;
  }
  function automaticThemeId() {
    if (current.themeMode === 'system') return systemColorScheme?.matches ? current.lightThemeId : current.darkThemeId;
    if (current.themeMode === 'schedule') return scheduleUsesLight() ? current.lightThemeId : current.darkThemeId;
    return current.themeId;
  }
  function effectiveThemeId() { return current.previewThemeId || automaticThemeId() || catalog.defaultThemeId; }

  function hexToRgb(value) {
    const match = clean(value).match(/^#([0-9a-f]{6})$/iu);
    if (!match) return null;
    return [0, 2, 4].map(index => Number.parseInt(match[1].slice(index, index + 2), 16));
  }
  function rgbToHex(rgb) { return `#${rgb.map(value => clamp(value, 0, 255, 0).toString(16).padStart(2, '0')).join('')}`; }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
    const l = (max + min) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [h, s * 100, l * 100];
  }
  function hslToRgb([h, s, l]) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    const parts = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return parts.map(value => Math.round((value + m) * 255));
  }
  function tuneHex(value, lightnessDelta = 0, saturationScale = 1) {
    const rgb = hexToRgb(value); if (!rgb) return value;
    const [h, s, l] = rgbToHsl(rgb);
    return rgbToHex(hslToRgb([h, Math.max(0, Math.min(100, s * saturationScale)), Math.max(0, Math.min(100, l + lightnessDelta))]));
  }
  function rgbaFromHex(value, alpha) {
    const rgb = hexToRgb(value);
    return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, alpha)).toFixed(3)})` : value;
  }

  function resolvedTypography(theme) {
    const typography = { ...DEFAULT_TYPOGRAPHY, ...(current.typography || {}) };
    return {
      ...typography,
      fontProfile: typography.fontProfile === 'theme' ? (theme.defaults?.fontProfile || 'sans') : typography.fontProfile,
      spacing: typography.spacing === 'theme' ? (theme.defaults?.spacing || 'comfortable') : typography.spacing
    };
  }

  function setRootState() {
    if (!catalog.themes.length) return;
    const root = document.documentElement;
    const theme = themeById(effectiveThemeId());
    const tuning = { ...DEFAULT_TUNING, ...(current.themeTuning || {}) };
    const typography = resolvedTypography(theme);
    root.dataset.theme = theme.id;
    root.dataset.themePreview = current.previewThemeId ? 'true' : 'false';
    root.dataset.themeMode = current.themeMode || 'manual';
    root.dataset.themeBrightness = theme.brightness === '浅色' ? 'light' : 'dark';
    root.dataset.themeAccessibility = theme.accessibility || 'standard';
    root.dataset.themeTexture = theme.texture || '玻璃';
    root.dataset.themeSpacing = typography.spacing;
    root.dataset.motionLevel = current.motionLevel || 'balanced';
    root.dataset.backgroundEffect = current.backgroundEffect || 'ambient';
    TOKEN_KEYS.forEach(key => root.style.removeProperty(`--${key}`));
    const depthDelta = (50 - clamp(tuning.backgroundDepth, 0, 100, 50)) * 0.12;
    const saturationScale = clamp(tuning.accentSaturation, 50, 150, 100) / 100;
    const backgroundKeys = new Set(['bg', 'bg2', 'nav', 'panel', 'panel2', 'card', 'card2']);
    const accentKeys = new Set(['cyan', 'cyan2', 'green', 'violet', 'pink', 'gold', 'red', 'theme-accent', 'theme-accent-2', 'theme-accent-3']);
    for (const key of TOKEN_KEYS) {
      let value = clean(theme.tokens?.[key]);
      if (!value) continue;
      if (backgroundKeys.has(key)) value = tuneHex(value, depthDelta, 1);
      if (accentKeys.has(key)) value = tuneHex(value, 0, saturationScale);
      root.style.setProperty(`--${key}`, sanitizeCssColor(value));
    }
    const accent = tuneHex(theme.tokens?.['theme-accent'] || theme.preview?.[1], 0, saturationScale);
    root.style.setProperty('--theme-glow', rgbaFromHex(accent, 0.03 + clamp(tuning.glowIntensity, 0, 100, 50) * 0.0027));
    root.style.setProperty('--theme-user-glass-opacity', String(clamp(tuning.glassOpacity, 20, 100, 72) / 100));
    root.style.setProperty('--theme-user-glass-percent', `${clamp(tuning.glassOpacity, 20, 100, 72)}%`);
    root.style.setProperty('--theme-font-family', FONT_STACKS[typography.fontProfile] || FONT_STACKS.sans);
    root.style.setProperty('--theme-font-scale', String(clamp(typography.fontScale, 90, 120, 100) / 100));
    root.style.setProperty('--theme-line-height', String(clamp(typography.lineHeight, 130, 190, 155) / 100));
    root.style.setProperty('--ws-card-title', `calc(14px * var(--theme-font-scale))`);
    root.style.setProperty('--ws-body', `calc(13px * var(--theme-font-scale))`);
    root.style.setProperty('--ws-small', `calc(11px * var(--theme-font-scale))`);
    root.style.setProperty('--ws-meta', `calc(10px * var(--theme-font-scale))`);
    root.style.setProperty('--ws-section', `calc(17px * var(--theme-font-scale))`);
    root.style.setProperty('--ws-section-title', `calc(17px * var(--theme-font-scale))`);
    const computedTheme = getComputedStyle(root);
    const titlebarColor = sanitizeCssColor(clean(computedTheme.getPropertyValue('--nav')))
      || sanitizeCssColor(tuneHex(theme.tokens?.nav || theme.preview?.[0], depthDelta, 1));
    const symbolColor = sanitizeCssColor(clean(computedTheme.getPropertyValue('--text')))
      || sanitizeCssColor(theme.tokens?.text || '#ffffff');
    const syncTitlebar = () => {
      const request = window.yanceDesktop?.setTitlebarTheme?.({ color: titlebarColor, symbolColor });
      request?.catch?.(error => console.warn('[Yance Theme] titlebar sync failed', error?.message || error));
    };
    syncTitlebar();
    clearTimeout(window.__yanceThemeTitlebarRetry);
    window.__yanceThemeTitlebarRetry = setTimeout(syncTitlebar, 220);
  }

  function optionHtml(values, selected) {
    return values.map(value => `<option value="${htmlAttr(value)}" ${value === selected ? 'selected' : ''}>${htmlText(value)}</option>`).join('');
  }

  function filteredThemes() {
    const query = filters.query.toLocaleLowerCase('zh-CN');
    const favorites = new Set(current.favoriteThemeIds || []);
    const recent = new Set(current.recentThemeIds || []);
    return catalog.themes.filter(theme => {
      if (filters.view === 'favorite' && !favorites.has(theme.id)) return false;
      if (filters.view === 'recent' && !recent.has(theme.id)) return false;
      if (filters.style !== '全部' && theme.style !== filters.style) return false;
      if (filters.brightness !== '全部' && theme.brightness !== filters.brightness) return false;
      if (filters.scene !== '全部' && !(theme.scenes || []).includes(filters.scene)) return false;
      if (filters.texture !== '全部' && theme.texture !== filters.texture) return false;
      if (query) {
        const haystack = [theme.name, theme.description, theme.style, theme.brightness, theme.texture, theme.series, ...(theme.tags || []), ...(theme.scenes || [])].join(' ').toLocaleLowerCase('zh-CN');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function cardHtml(theme, context = '') {
    const favorite = (current.favoriteThemeIds || []).includes(theme.id);
    const active = effectiveThemeId() === theme.id;
    const previewing = current.previewThemeId === theme.id;
    return `<article class="theme32-card ${active ? 'active' : ''} ${previewing ? 'previewing' : ''}" data-card-theme="${htmlAttr(theme.id)}">
      <button class="theme32-favorite ${favorite ? 'active' : ''}" data-theme-favorite="${htmlAttr(theme.id)}" title="${favorite ? '取消收藏' : '加入收藏'}" aria-label="${favorite ? '取消收藏' : '加入收藏'}">${favorite ? '★' : '☆'}</button>
      <button class="theme32-card-main" data-theme-id="${htmlAttr(theme.id)}">
        <div class="theme32-preview"><div class="theme32-mini-nav"><i></i><i></i><i></i></div><div class="theme32-mini-main"><header></header><p class="in"></p><p class="out"></p><footer><span></span><b></b></footer></div></div>
        <div class="theme32-card-title"><h3>${htmlText(theme.name)}</h3><span>${htmlText(theme.brightness)}</span></div>
        <p>${htmlText(theme.description)}</p>
        <div class="theme32-tags">${[theme.style, theme.texture, ...(theme.scenes || []).slice(0, 2)].map(tag => `<span>${htmlText(tag)}</span>`).join('')}</div>
        ${context ? `<small class="theme32-card-context">${htmlText(context)}</small>` : ''}
      </button>
    </article>`;
  }


  function applyCardPreviewStyles(host) {
    host.querySelectorAll('[data-card-theme]').forEach(node => {
      const theme = themeById(node.dataset.cardTheme);
      if (!theme) return;
      const tokens = theme.tokens || {};
      const values = {
        '--preview-bg': tokens.bg || theme.preview?.[0],
        '--preview-nav': tokens.nav || tokens.bg2 || theme.preview?.[0],
        '--preview-card': tokens.card || tokens.panel || theme.preview?.[0],
        '--preview-text': tokens.text || '#ffffff',
        '--preview-muted': tokens.muted || '#999999',
        '--preview-a': tokens['theme-accent'] || theme.preview?.[1],
        '--preview-b': tokens['theme-accent-2'] || theme.preview?.[2]
      };
      for (const [name, value] of Object.entries(values)) node.style.setProperty(name, sanitizeCssColor(value));
    });
  }

  function renderThemeGrid() {
    const host = $('theme32Grid');
    const rows = filteredThemes();
    if (!rows.length) {
      host.innerHTML = '<div class="theme32-empty"><b>没有匹配的主题</b><p>清除筛选或换一个关键词。</p></div>';
      return;
    }
    const filtered = filters.query || filters.style !== '全部' || filters.brightness !== '全部' || filters.scene !== '全部' || filters.texture !== '全部' || filters.view !== 'all';
    const sections = [];
    if (!filtered) {
      const favorites = (current.favoriteThemeIds || []).map(themeById).filter(Boolean);
      const recent = (current.recentThemeIds || []).map(themeById).filter(Boolean).slice(0, 6);
      if (favorites.length) sections.push(['我的收藏', favorites, '收藏']);
      if (recent.length) sections.push(['最近使用', recent, '最近']);
    }
    const grouped = new Map();
    for (const theme of rows) {
      if (!grouped.has(theme.series)) grouped.set(theme.series, []);
      grouped.get(theme.series).push(theme);
    }
    for (const [name, themes] of grouped) sections.push([name || '其他主题', themes, '']);
    host.innerHTML = sections.map(([name, themes, context]) => `<section class="theme32-group"><header><h3>${htmlText(name)}</h3><span>${htmlText(themes.length)} 套</span></header><div class="theme32-grid">${themes.map(theme => cardHtml(theme, context)).join('')}</div></section>`).join('');
    applyCardPreviewStyles(host);
    host.querySelectorAll('[data-theme-id]').forEach(node => node.onclick = () => previewTheme(node.dataset.themeId));
    host.querySelectorAll('[data-theme-favorite]').forEach(node => node.onclick = event => { event.preventDefault(); event.stopPropagation(); toggleFavorite(node.dataset.themeFavorite); });
  }

  function sliderRowHtml(key, label, min, max, value, suffix = '') {
    return `<label class="theme32-slider"><span>${htmlText(label)}</span><input type="range" min="${htmlAttr(min)}" max="${htmlAttr(max)}" step="1" value="${htmlAttr(value)}" data-tuning="${htmlAttr(key)}"><b data-value-for="${htmlAttr(key)}">${htmlText(value)}${htmlText(suffix)}</b></label>`;
  }

  function renderPersonalization() {
    const tuning = { ...DEFAULT_TUNING, ...(current.themeTuning || {}) };
    const typography = { ...DEFAULT_TYPOGRAPHY, ...(current.typography || {}) };
    $('theme32Tuning').innerHTML = [
      sliderRowHtml('backgroundDepth', '背景深浅', 0, 100, tuning.backgroundDepth, '%'),
      sliderRowHtml('glowIntensity', '光晕浓度', 0, 100, tuning.glowIntensity, '%'),
      sliderRowHtml('glassOpacity', '玻璃透明度', 20, 100, tuning.glassOpacity, '%'),
      sliderRowHtml('accentSaturation', '主色饱和度', 50, 150, tuning.accentSaturation, '%')
    ].join('');
    $('theme32Tuning').querySelectorAll('[data-tuning]').forEach(input => input.oninput = () => {
      current.themeTuning = { ...tuning, [input.dataset.tuning]: Number(input.value) };
      const value = $(`theme32Tuning`)?.querySelector(`[data-value-for="${input.dataset.tuning}"]`);
      if (value) value.textContent = `${input.value}%`;
      current.activeCustomThemePresetId = '';
      setRootState();
      debouncePreferences({ themeTuning: current.themeTuning });
    });
    $('theme32Typography').innerHTML = `
      <label class="theme32-field"><span>字体风格</span><select id="theme32Font">${FONT_PROFILES.map(row => `<option value="${htmlAttr(row[0])}" ${typography.fontProfile === row[0] ? 'selected' : ''}>${htmlText(row[1])}</option>`).join('')}</select></label>
      ${sliderRowHtml('fontScale', '字号比例', 90, 120, typography.fontScale, '%')}
      ${sliderRowHtml('lineHeight', '正文行高', 130, 190, typography.lineHeight, '%')}
      <label class="theme32-field"><span>内容间距</span><select id="theme32Spacing">${SPACING.map(row => `<option value="${htmlAttr(row[0])}" ${typography.spacing === row[0] ? 'selected' : ''}>${htmlText(row[1])}</option>`).join('')}</select></label>`;
    $('theme32Font').onchange = () => updateTypography({ fontProfile: $('theme32Font').value });
    $('theme32Spacing').onchange = () => updateTypography({ spacing: $('theme32Spacing').value });
    $('theme32Typography').querySelectorAll('[data-tuning="fontScale"],[data-tuning="lineHeight"]').forEach(input => input.oninput = () => {
      const value = $('theme32Typography').querySelector(`[data-value-for="${input.dataset.tuning}"]`);
      if (value) value.textContent = `${input.value}%`;
      updateTypography({ [input.dataset.tuning]: Number(input.value) }, true);
    });
    const presets = current.customThemePresets || [];
    $('theme32Personal').innerHTML = presets.length ? `<header><h3>我的个人主题</h3><span>${htmlText(presets.length)}/12</span></header><div class="theme32-personal-grid">${presets.map(preset => `<article class="${current.activeCustomThemePresetId === preset.id ? 'active' : ''}"><div><b>${htmlText(preset.name)}</b><span>${htmlText(themeById(preset.baseThemeId)?.name || preset.baseThemeId)}</span></div><div><button data-preset-apply="${htmlAttr(preset.id)}">使用</button><button data-preset-delete="${htmlAttr(preset.id)}">删除</button></div></article>`).join('')}</div>` : '<div class="theme32-personal-empty">尚未保存个人主题。调整参数后点击“保存为个人主题”。</div>';
    $('theme32Personal').querySelectorAll('[data-preset-apply]').forEach(node => node.onclick = () => applyPreset(node.dataset.presetApply));
    $('theme32Personal').querySelectorAll('[data-preset-delete]').forEach(node => node.onclick = () => deletePreset(node.dataset.presetDelete));
  }

  function renderFilters() {
    const styles = ['全部', ...unique(catalog.themes.map(theme => theme.style))];
    const brightness = ['全部', ...unique(catalog.themes.map(theme => theme.brightness))];
    const scenes = ['全部', ...unique(catalog.themes.flatMap(theme => theme.scenes || []))];
    const textures = ['全部', ...unique(catalog.themes.map(theme => theme.texture))];
    $('theme32Style').innerHTML = optionHtml(styles, filters.style);
    $('theme32Brightness').innerHTML = optionHtml(brightness, filters.brightness);
    $('theme32Scene').innerHTML = optionHtml(scenes, filters.scene);
    $('theme32Texture').innerHTML = optionHtml(textures, filters.texture);
    $('theme32Search').value = filters.query;
    for (const [id, key] of [['theme32Style', 'style'], ['theme32Brightness', 'brightness'], ['theme32Scene', 'scene'], ['theme32Texture', 'texture']]) {
      $(id).onchange = () => { filters[key] = $(id).value; renderThemeGrid(); };
    }
    $('theme32Search').oninput = () => { filters.query = $('theme32Search').value; renderThemeGrid(); };
    $('theme32ViewTabs').querySelectorAll('[data-view]').forEach(node => {
      node.classList.toggle('active', filters.view === node.dataset.view);
      node.onclick = () => { filters.view = node.dataset.view; renderFilters(); renderThemeGrid(); };
    });
  }

  function renderAutomation() {
    const lightThemes = catalog.themes.filter(theme => theme.brightness === '浅色');
    const darkThemes = catalog.themes.filter(theme => theme.brightness === '深色');
    $('theme32Mode').innerHTML = THEME_MODES.map(row => `<button class="${current.themeMode === row[0] ? 'active' : ''}" data-mode="${htmlAttr(row[0])}">${htmlText(row[1])}</button>`).join('');
    $('theme32Mode').querySelectorAll('[data-mode]').forEach(node => node.onclick = () => updateAutomation({ themeMode: node.dataset.mode }));
    $('theme32LightTheme').innerHTML = lightThemes.map(theme => `<option value="${htmlAttr(theme.id)}" ${current.lightThemeId === theme.id ? 'selected' : ''}>${htmlText(theme.name)}</option>`).join('');
    $('theme32DarkTheme').innerHTML = darkThemes.map(theme => `<option value="${htmlAttr(theme.id)}" ${current.darkThemeId === theme.id ? 'selected' : ''}>${htmlText(theme.name)}</option>`).join('');
    $('theme32DayStart').value = current.scheduleDayStart || '07:00';
    $('theme32NightStart').value = current.scheduleNightStart || '19:00';
    $('theme32LightTheme').onchange = () => updateAutomation({ lightThemeId: $('theme32LightTheme').value });
    $('theme32DarkTheme').onchange = () => updateAutomation({ darkThemeId: $('theme32DarkTheme').value });
    $('theme32DayStart').onchange = () => updateAutomation({ scheduleDayStart: $('theme32DayStart').value });
    $('theme32NightStart').onchange = () => updateAutomation({ scheduleNightStart: $('theme32NightStart').value });
    $('theme32ModeValue').textContent = labelFor(THEME_MODES, current.themeMode);
    const scheduleDisabled = current.themeMode !== 'schedule';
    $('theme32DayStart').disabled = scheduleDisabled;
    $('theme32NightStart').disabled = scheduleDisabled;
  }

  function renderMotion() {
    const motionIndex = Math.max(0, MOTION.findIndex(row => row[0] === current.motionLevel));
    $('theme32MotionRange').value = String(motionIndex);
    $('theme32MotionValue').textContent = labelFor(MOTION, current.motionLevel);
    $('theme32MotionRange').oninput = () => setMotion(MOTION[Number($('theme32MotionRange').value)]?.[0] || 'balanced');
    $('theme32Background').innerHTML = BACKGROUNDS.map(row => `<button class="${current.backgroundEffect === row[0] ? 'active' : ''}" data-background="${htmlAttr(row[0])}">${htmlText(row[1])}</button>`).join('');
    $('theme32Background').querySelectorAll('[data-background]').forEach(node => node.onclick = () => setBackground(node.dataset.background));
    $('theme32BackgroundValue').textContent = labelFor(BACKGROUNDS, current.backgroundEffect);
  }

  function render() {
    if (!catalog.themes.length) return;
    setRootState();
    const theme = themeById(effectiveThemeId());
    $('theme32Current').textContent = `${theme.name} · ${labelFor(MOTION, current.motionLevel)}`;
    const modeText = current.themeMode === 'manual' ? '手动主题' : `${labelFor(THEME_MODES, current.themeMode)} · 当前自动选择`;
    $('theme32CurrentMeta').textContent = `${current.previewThemeId ? '正在预览，尚未写入 SQLite' : modeText} · 背景 ${labelFor(BACKGROUNDS, current.backgroundEffect)}`;
    $('theme32PreviewState').textContent = current.previewThemeId ? `预览：${theme.name}` : '未在预览';
    $('theme32Count').textContent = `${catalog.themes.length} 套正式主题`;
    $('theme32A11y').textContent = theme.accessibility === 'high-contrast' ? '高对比模式' : theme.accessibility === 'colorblind' ? '色觉安全模式' : theme.accessibility === 'eye-care' ? '护眼低疲劳' : '标准视觉';
    $('theme32CancelPreview').disabled = !current.previewThemeId || busy;
    $('theme32Apply').disabled = busy;
    $('theme32ApplyBottom').disabled = busy;
    renderFilters();
    renderThemeGrid();
    renderPersonalization();
    renderAutomation();
    renderMotion();
  }

  function notify(message, type = '') {
    return window.YanceNotificationLayoutAuthority.show({ message, tone: type || 'info', timeoutMs: 2400 });
  }
  function setBusy(value, text = '') {
    busy = value;
    $('theme32Status').textContent = text || (value ? '正在同步 StoreManager…' : '视觉设置通过 StoreManager 同步到所有页面和窗口。');
    render();
  }
  async function previewTheme(themeId) {
    if (busy || !themeMap.has(themeId) || themeId === current.previewThemeId) return;
    setBusy(true, '正在载入主题预览…');
    try {
      await window.YanceStoreClient?.previewTheme?.(themeId);
      current.previewThemeId = themeId;
      setRootState(); notify('主题预览已载入，尚未正式应用');
    } catch (error) { notify(error.message || '主题预览失败', 'error'); }
    finally { setBusy(false); }
  }
  async function cancelPreview() {
    if (busy || !current.previewThemeId) return;
    setBusy(true, '正在取消主题预览…');
    try { await window.YanceStoreClient?.cancelThemePreview?.(); current.previewThemeId = ''; setRootState(); notify('已恢复正式主题'); }
    catch (error) { notify(error.message || '取消预览失败', 'error'); }
    finally { setBusy(false); }
  }
  async function applyTheme(themeId = effectiveThemeId()) {
    if (busy || !themeMap.has(themeId)) return;
    setBusy(true, '正在应用并持久化主题…');
    try {
      await window.YanceStoreClient?.applyTheme?.(themeId);
      current.themeId = themeId; current.previewThemeId = ''; current.themeMode = 'manual'; current.activeCustomThemePresetId = '';
      current.recentThemeIds = [themeId, ...(current.recentThemeIds || []).filter(id => id !== themeId)].slice(0, 12);
      setRootState(); notify('主题已应用，重启后仍会恢复');
    } catch (error) { notify(error.message || '应用主题失败', 'error'); }
    finally { setBusy(false); }
  }
  async function setMotion(motionLevel) {
    if (busy || motionLevel === current.motionLevel) return;
    const previous = current.motionLevel; current.motionLevel = motionLevel; setRootState(); renderMotion();
    try { await window.YanceStoreClient?.setMotionLevel?.(motionLevel); notify(`动效强度已设为${labelFor(MOTION, motionLevel)}`); }
    catch (error) { current.motionLevel = previous; setRootState(); renderMotion(); notify(error.message || '动效设置保存失败', 'error'); }
  }
  async function setBackground(backgroundEffect) {
    if (busy || backgroundEffect === current.backgroundEffect) return;
    const previous = current.backgroundEffect; current.backgroundEffect = backgroundEffect; setRootState(); renderMotion();
    try { await window.YanceStoreClient?.setBackgroundEffect?.(backgroundEffect); notify(`背景效果已设为${labelFor(BACKGROUNDS, backgroundEffect)}`); }
    catch (error) { current.backgroundEffect = previous; setRootState(); renderMotion(); notify(error.message || '背景设置保存失败', 'error'); }
  }
  async function updatePreferences(payload, silent = false) {
    try { await window.YanceStoreClient?.updateThemePreferences?.(payload); if (!silent) notify('主题偏好已保存'); }
    catch (error) { notify(error.message || '主题偏好保存失败', 'error'); }
  }
  function debouncePreferences(payload) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updatePreferences(payload, true), 260);
  }
  async function toggleFavorite(themeId) {
    if (!themeMap.has(themeId)) return;
    const favorites = new Set(current.favoriteThemeIds || []);
    const favorite = !favorites.has(themeId);
    if (favorite) favorites.add(themeId); else favorites.delete(themeId);
    current.favoriteThemeIds = [...favorites]; renderThemeGrid();
    await updatePreferences({ favoriteThemeId: themeId, favorite }, true);
  }
  function updateTypography(partial, debounce = false) {
    current.typography = { ...DEFAULT_TYPOGRAPHY, ...(current.typography || {}), ...partial };
    current.activeCustomThemePresetId = ''; setRootState();
    if (debounce) debouncePreferences({ typography: current.typography }); else updatePreferences({ typography: current.typography }, true);
  }
  async function updateAutomation(partial) {
    current = { ...current, ...partial }; setRootState(); renderAutomation(); renderThemeGrid();
    await updatePreferences({
      themeMode: current.themeMode,
      lightThemeId: current.lightThemeId,
      darkThemeId: current.darkThemeId,
      scheduleDayStart: current.scheduleDayStart,
      scheduleNightStart: current.scheduleNightStart
    }, true);
  }
  async function savePreset() {
    const name = await window.YanceDialogs?.prompt?.({ title: '保存个人主题', label: '主题名称', value: `${themeById(effectiveThemeId()).name} · 我的版本`, placeholder: '例如：日间客服护眼版' });
    if (name == null || !clean(name)) return;
    try {
      const result = await window.YanceStoreClient?.saveCustomThemePreset?.({
        name: clean(name), baseThemeId: effectiveThemeId(), tuning: current.themeTuning, typography: current.typography,
        motionLevel: current.motionLevel, backgroundEffect: current.backgroundEffect
      });
      if (result?.preset) {
        current.customThemePresets = [result.preset, ...(current.customThemePresets || []).filter(row => row.id !== result.preset.id)].slice(0, 12);
        current.activeCustomThemePresetId = result.preset.id;
      }
      renderPersonalization(); notify('个人主题已保存');
    } catch (error) { notify(error.message || '个人主题保存失败', 'error'); }
  }
  async function applyPreset(presetId) {
    try { await window.YanceStoreClient?.applyCustomThemePreset?.(presetId); notify('个人主题已应用'); }
    catch (error) { notify(error.message || '个人主题应用失败', 'error'); }
  }
  async function deletePreset(presetId) {
    const confirmed = await window.YanceDialogs?.confirm?.({ title: '删除个人主题', message: '只删除个人预设，不会删除内置主题。', danger: true, submitLabel: '删除' });
    if (!confirmed) return;
    try {
      await window.YanceStoreClient?.deleteCustomThemePreset?.(presetId);
      current.customThemePresets = (current.customThemePresets || []).filter(row => row.id !== presetId);
      if (current.activeCustomThemePresetId === presetId) current.activeCustomThemePresetId = '';
      renderPersonalization(); notify('个人主题已删除');
    } catch (error) { notify(error.message || '个人主题删除失败', 'error'); }
  }

  function setActiveNav(id) { document.querySelectorAll('#navMenu button,.nav-bottom button').forEach(node => node.classList.toggle('active', node.id === id)); }
  function open() {
    window.YanceR32BasicSettings?.close?.(); window.YanceR32DisplaySettings?.close?.();
    if (window.YanceWorkspaceRouteAuthority?.applyRoute) window.YanceWorkspaceRouteAuthority.applyRoute(app, 'theme', { source: 'r32-theme-motion' }); else { classesToClose.forEach(name => app.classList.remove(name)); app.classList.add('theme-workspace-open'); } setActiveNav('navThemes'); render();
  }
  function close() {
    if (current.previewThemeId) cancelPreview().catch(() => {});
    app.classList.remove('theme-workspace-open');
    if (window.__Y27?.openConversationPage) window.__Y27.openConversationPage(); else $('navConversation')?.click();
  }

  button.onclick = event => { event.preventDefault(); event.stopPropagation(); open(); };
  $('theme32Back').onclick = close;
  $('theme32CancelPreview').onclick = cancelPreview;
  $('theme32Apply').onclick = () => applyTheme();
  $('theme32ApplyBottom').onclick = () => applyTheme();
  $('theme32SavePreset').onclick = savePreset;
  $('theme32Reset').onclick = async () => {
    await previewTheme(catalog.defaultThemeId); await applyTheme(catalog.defaultThemeId);
    current.themeTuning = { ...DEFAULT_TUNING }; current.typography = { ...DEFAULT_TYPOGRAPHY };
    await updatePreferences({ themeTuning: current.themeTuning, typography: current.typography, themeMode: 'manual' }, true);
    await setMotion('balanced'); await setBackground('ambient'); render();
  };
  const handleDocumentClick = event => {
    const nav = event.target.closest('#navMenu button,.nav-bottom button');
    if (nav && nav.id !== 'navThemes' && app.classList.contains('theme-workspace-open')) {
      app.classList.remove('theme-workspace-open'); if (current.previewThemeId) cancelPreview().catch(() => {});
    }
  };
  const handleVisibilityChange = () => document.documentElement.classList.toggle('motion-paused', document.hidden);
  const handleWindowFocus = () => { setRootState(); render(); };
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleWindowFocus, { passive: true });
  systemColorScheme?.addEventListener?.('change', handleSystemColorScheme);
  const messages = $('messages');
  if (messages && 'MutationObserver' in window) {
    const updateHistoryMode = () => document.documentElement.classList.toggle('large-history-mode', messages.children.length > 800);
    historyMutationObserver = new MutationObserver(updateHistoryMode);
    historyMutationObserver.observe(messages, { childList: true }); updateHistoryMode();
  }

  const selector = state => ({
    ready: state.ui?.ready === true,
    themeId: state.ui?.themeId || catalog.defaultThemeId,
    previewThemeId: state.ui?.previewThemeId || '',
    motionLevel: state.ui?.motionLevel || 'balanced',
    backgroundEffect: state.ui?.backgroundEffect || 'ambient',
    themeMode: state.ui?.themeMode || 'manual',
    lightThemeId: state.ui?.lightThemeId || catalog.lightDefaultThemeId,
    darkThemeId: state.ui?.darkThemeId || catalog.darkDefaultThemeId,
    scheduleDayStart: state.ui?.scheduleDayStart || '07:00',
    scheduleNightStart: state.ui?.scheduleNightStart || '19:00',
    favoriteThemeIds: state.ui?.favoriteThemeIds || [],
    recentThemeIds: state.ui?.recentThemeIds || [],
    themeTuning: state.ui?.themeTuning || DEFAULT_TUNING,
    typography: state.ui?.typography || DEFAULT_TYPOGRAPHY,
    customThemePresets: state.ui?.customThemePresets || [],
    activeCustomThemePresetId: state.ui?.activeCustomThemePresetId || ''
  });

  async function initialize() {
    try {
      const response = await fetch('/theme-catalog.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`主题目录加载失败：HTTP ${response.status}`);
      const loaded = await response.json();
      if (!Array.isArray(loaded.themes) || loaded.themes.length < 15) throw new Error('主题目录不完整');
      catalog = loaded; themeMap = new Map(catalog.themes.map(theme => [theme.id, theme]));
      window.YanceThemeCatalog = Object.freeze({ ...catalog, themes: Object.freeze(catalog.themes.map(theme => Object.freeze(theme))) });
    } catch (error) {
      console.error('[言策主题目录]', error);
      $('theme32Status').textContent = error.message || '主题目录加载失败';
      return;
    }
    unsubscribeThemeStore = window.YanceStoreClient?.subscribe?.(selector, next => {
      if (!next?.ready) return;
      current = { ...current, ...next };
      setRootState(); render();
    }, { fireImmediately: true, equality: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
    clearInterval(scheduleTimer);
    scheduleTimer = setInterval(() => { if (current.themeMode === 'schedule') { setRootState(); if (app.classList.contains('theme-workspace-open')) render(); } }, 60000);
    setRootState(); render();
    const dispose = () => {
      clearTimeout(saveTimer); saveTimer = null;
      clearTimeout(notify.timer); notify.timer = null;
      clearTimeout(window.__yanceThemeTitlebarRetry); window.__yanceThemeTitlebarRetry = null;
      clearInterval(scheduleTimer); scheduleTimer = null;
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      systemColorScheme?.removeEventListener?.('change', handleSystemColorScheme);
      historyMutationObserver?.disconnect?.(); historyMutationObserver = null;
      try { unsubscribeThemeStore?.(); } catch (_) {}
      unsubscribeThemeStore = null;
    };
    window.YanceThemeMotion = Object.freeze({ open, close, previewTheme, cancelPreview, applyTheme, setMotion, setBackground, updateAutomation, savePreset, dispose });
  }
  initialize();
})();
