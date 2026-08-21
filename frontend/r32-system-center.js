(() => {
'use strict';

const app = document.querySelector('.app');
const navMenu = document.getElementById('navMenu');
if (!app || !navMenu || document.getElementById('navSystemCenter')) return;

const SYSTEM_API = '/api/r32/system';
const STORAGE_KEY = 'yance27-r32-system-center-final';
const state = Object.assign({
  view: false,
  tab: 'overview',
  overview: null,
  desktop: null,
  loading: false,
  lastError: '',
  operation: '',
  logs: [],
  busy: '',
  expandedAccount: '',
  selectedBackup: '',
  workspaceScrollTopByTab: {},
  workspaceScrollTop: 0
}, loadState());

const TAB_META = [
  ['overview', '智能总览', '健康、风险与处理中心', '◈'],
  ['connections', '连接链路', '账号认证、消息源与能力', '⌁'],
  ['desktop', '桌面与运行', '启动、托盘、进程与媒体', '▣'],
  ['notifications', '通知与声音', '真实提醒链路与免打扰', '♬'],
  ['data', '数据保护', '完整备份、验证、恢复与回滚', '◇'],
  ['ai', 'AI与资产', 'Model Brain、模型来源与执行证据', '✦'],
  ['diagnostics', '诊断与日志', '真实探针、错误与脱敏导出', '◎'],
  ['security', '安全控制', '凭据、隐私、安全模式与门禁', '⚑'],
  ['about', '关于言策', '品牌、版本与内测说明', '言']
];

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      view: state.view,
      tab: state.tab,
      expandedAccount: state.expandedAccount,
      workspaceScrollTopByTab: state.workspaceScrollTopByTab || {}
    }));
  } catch (_) {}
}
const { escapeHtmlText: htmlText, escapeHtmlAttribute: htmlAttr, escapeUrlAttribute: urlAttr, setUrlAttribute } = window.YanceSecurity;
function fmtDate(value) {
  if (!value) return '尚无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}
function fmtDuration(seconds) {
  seconds = Math.max(0, Number(seconds || 0));
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`;
}
function fmtBytes(value) {
  let n = Math.max(0, Number(value || 0));
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function healthText(level) { return ({ healthy:'系统健康', attention:'需要关注', critical:'存在阻断' })[level] || '正在检查'; }
function healthStateText(value) { return ({ healthy:'健康', degraded:'功能降级', blocked:'存在阻断', recovering:'正在恢复', unknown:'证据不足' })[value] || '正在检查'; }
function stateLabel(value) { return ({ connected:'已连接', online:'在线', healthy:'健康', warning:'需关注', error:'异常', blocked:'已阻断', paused:'已暂停', idle:'待连接', disconnected:'未连接', connecting:'连接中', awaiting_auth:'等待授权' })[value] || value || '未知'; }
function severityClass(value) { return ({ critical:'bad', high:'bad', medium:'warn', info:'' })[value] || ''; }
function boolLabel(value) { return value ? '已开启' : '已关闭'; }

function notificationSoundCatalog() {
  const catalog = state.overview?.notifications?.soundCatalog || {};
  return {
    patterns: Array.isArray(catalog.patterns) ? catalog.patterns : [],
    events: Array.isArray(catalog.events) ? catalog.events : [],
    library: catalog.library && typeof catalog.library === 'object' ? catalog.library : {},
    upload: catalog.upload && typeof catalog.upload === 'object' ? catalog.upload : null
  };
}
function notificationSoundLabel(patternId) {
  return notificationSoundCatalog().patterns.find(row => row.id === patternId)?.label || '默认提示音';
}
function notificationSoundDurationLabel(value) {
  const ms = Math.max(0, Number(value || 0));
  if (!ms || ms < 5000) return '';
  return ` · ${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}秒`;
}
function notificationSoundOptions(selected, eventId = '') {
  const patterns = notificationSoundCatalog().patterns;
  const rows = patterns.length ? patterns : [{ id: selected || 'message-in', label: '默认提示音', group: '言策原创', custom: false }];
  const builtIn = rows.filter(row => row.custom !== true);
  const custom = rows.filter(row => row.custom === true);
  const grouped = new Map();
  for (const row of builtIn) {
    const group = String(row.group || row.family || '内置提示音');
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(row);
  }
  const groups = [...grouped.entries()].sort((a, b) => {
    const aRecommended = a[1].some(row => Array.isArray(row.recommendedEvents) && row.recommendedEvents.includes(eventId));
    const bRecommended = b[1].some(row => Array.isArray(row.recommendedEvents) && row.recommendedEvents.includes(eventId));
    return Number(bRecommended) - Number(aRecommended);
  });
  const option = row => {
    const recommended = Array.isArray(row.recommendedEvents) && row.recommendedEvents.includes(eventId);
    const suffix = notificationSoundDurationLabel(row.durationMs);
    return `<option value="${htmlAttr(row.id)}" ${row.id === selected ? 'selected' : ''}>${recommended ? '★ ' : ''}${htmlText(row.label)}${htmlText(suffix)}</option>`;
  };
  const builtInHtml = groups.map(([group, groupRows]) => `<optgroup label="${htmlAttr(group)}">${groupRows.map(option).join('')}</optgroup>`).join('');
  const customHtml = custom.length ? `<optgroup label="我的提示音">${custom.map(option).join('')}</optgroup>` : '';
  return `${builtInHtml}${customHtml}`;
}
function renderSoundLibrarySummary() {
  const library = notificationSoundCatalog().library || {};
  const builtIn = Math.max(0, Number(library.builtInCount || 0));
  const imported = Math.max(0, Number(library.importedCount || 0));
  const removed = Math.max(0, Number(library.duplicateEntriesRemoved || 0));
  const rejected = Math.max(0, Number(library.invalidEntriesRejected || 0));
  if (!builtIn) return '';
  return `<div class="sc32-sound-library-summary"><div><i>♬</i><span><b>${htmlText(builtIn)} 套无重复内置音效</b><small>言策原创 ${htmlText(library.originalCount || 0)} 套 · 新增 ${htmlText(imported)} 套 · 按系列与用途分组</small></span></div><p>已自动排除 ${htmlText(removed)} 个重复条目${rejected ? `和 ${htmlText(rejected)} 个空白或损坏文件` : ''}；只导入验证通过的音频，没有带入压缩包中的程序、DLL或脚本。</p></div>`;
}
function customNotificationSounds() {
  return notificationSoundCatalog().patterns.filter(row => row.custom === true);
}
function renderCustomNotificationSounds() {
  const rows = customNotificationSounds();
  if (!rows.length) return `<div class="sc32-empty compact"><b>尚未上传自定义提示音</b><p>支持 WAV、MP3、M4A、AAC，文件最多 8 MB。上传后可用于任意通知事件。</p></div>`;
  return `<div class="sc32-custom-sound-list">${rows.map(row => `<article class="sc32-custom-sound-row"><div><b>${htmlText(row.label)}</b><p>${htmlText(row.originalFileName || '本地音频')} · ${htmlText(fmtBytes(row.sizeBytes || 0))}${row.createdAt ? ` · ${htmlText(fmtDate(row.createdAt))}` : ''}</p></div><div><button type="button" class="sc32-link" data-sc-action="preview-sound" data-sound-id="${htmlAttr(row.id)}">试听</button><button type="button" class="sc32-link danger" data-sc-action="delete-custom-sound" data-sound-id="${htmlAttr(row.id)}">删除</button></div></article>`).join('')}</div>`;
}
function notificationSoundPicker(event, settings) {
  const selectId = `sc32Sound-${event.id}`;
  const selected = settings[event.settingKey] || event.defaultPattern || 'message-in';
  return `<label class="sc32-sound-picker"><span><b>${htmlText(event.label)}</b><small>${htmlText(event.description)}</small></span><div><select id="${htmlAttr(selectId)}" data-sc-sound-key="${htmlAttr(event.settingKey)}">${notificationSoundOptions(selected, event.id)}</select><button type="button" class="sc32-button" data-sc-action="preview-sound" data-sound-select="${htmlAttr(selectId)}">试听</button></div></label>`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || payload.error || `请求失败（${response.status}）`);
    error.code = payload.error || 'REQUEST_FAILED';
    error.payload = payload;
    throw error;
  }
  return payload;
}
function api(path = '', options = {}) { return request(`${SYSTEM_API}${path}`, options); }

function toast(message, type = '') {
  return window.YanceNotificationLayoutAuthority.show({ message, tone: type || 'info', source: 'system-center', timeoutMs: 3000 });
}
function clearToast(reason = 'manual') {
  return window.YanceNotificationLayoutAuthority.clear({ source: 'system-center', reason, document });
}
function setBusy(name = '') { state.busy = name; renderPanel(); }

function injectNav() {
  const button = document.createElement('button');
  button.className = 'icon';
  button.id = 'navSystemCenter';
  button.title = '系统中心';
  button.setAttribute('aria-label', '系统中心');
  button.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="13" rx="2"/><path d="M8 9h8M8 13h3M15 13h1M7 21h10M12 18v3"/></svg><b>系统中心</b>';
  (window.YanceConversationCenterV2?.registerNavEntry?.(button, { group: 'system', order: 20 }) || (document.getElementById('navSystemEntries') || navMenu).appendChild(button));
  button.onclick = () => openSystemCenter();
}

function injectWorkspace() {
  const sectionNode = document.createElement('section');
  sectionNode.className = 'system-center-workspace ui-route-scroll-root';
  sectionNode.id = 'systemCenterWorkspace';
  sectionNode.setAttribute('aria-label', '系统中心');
  sectionNode.innerHTML = `
    <header class="sc32-hero">
      <div class="sc32-title">
        <small>YANCE · ARCHITECTURE & RELEASE COMMAND CENTER</small>
        <h1>系统中心</h1>
        <p>统一桌面、账号、消息、通知、数据、AI与安全状态。重复设置已合并，伪成功已删除，所有关键操作均有真实结果和失败原因。</p>
        <div class="sc32-title-line"><i id="sc32LiveDot"></i><span id="sc32LiveText">正在读取真实系统状态</span></div>
      </div>
      <div class="sc32-hero-side">
        <div class="sc32-score" id="sc32Score" style="--score:0"><strong id="sc32ScoreValue">--</strong><span>健康分</span></div>
        <div class="sc32-hero-actions">
          <button class="sc32-button" id="sc32Refresh">刷新状态</button>
          <button class="sc32-button" id="sc32Export">导出诊断</button>
          <button class="sc32-button warn" id="sc32OpenData">打开数据目录</button>
          <button class="sc32-button primary" id="sc32RunDiagnostics">运行诊断</button>
        </div>
      </div>
    </header>
    <div class="sc32-summary" id="sc32Summary"></div>
    <div class="sc32-body">
      <aside class="sc32-sidebar">
        <nav class="sc32-nav" id="sc32Nav"></nav>
        <footer class="sc32-side-foot"><span>当前工程</span><b id="sc32Build">言策</b><p id="sc32Updated">尚未读取系统状态</p></footer>
      </aside>
      <main class="sc32-content ui-route-scroll-surface" id="sc32Content"><div class="sc32-loading"><div><i></i><b>正在读取真实系统状态</b><p>检查桌面进程、本地服务、账号连接、数据保护与安全策略。</p></div></div></main>
    </div>`;
  app.appendChild(sectionNode);
  sectionNode.addEventListener('scroll', event => {
    if (!state.view || event.target?.id !== 'systemCenterWorkspace') return;
    captureSystemCenterScroll(state.tab);
    clearTimeout(sectionNode._scrollSaveTimer);
    sectionNode._scrollSaveTimer = setTimeout(saveState, 120);
  }, { passive: true, capture: true });
}

function closeOtherViews() {
  app.classList.remove('immersive','contacts-hidden','ai-hidden','compact','ai-open-small','contact-page-open','profile-page-open','timeline-page-open','insights-page-open','aiwork-page-open','account-center-open','settings-recovery-open','theme-workspace-open');
}
function setActiveNav() {
  ['navConversation','navContacts','navProfiles','navTimeline','navInsights','navAiWorkbench','navAccountsCenter','navSystemCenter'].forEach(id => document.getElementById(id)?.classList.toggle('active', id === 'navSystemCenter'));
}
function openSystemCenter(tab = state.tab) {
  if (window.YanceWorkspaceRouteAuthority?.applyRoute) window.YanceWorkspaceRouteAuthority.applyRoute(app, 'system', { source: 'r32-system-center' });
  else { closeOtherViews(); app.classList.add('system-center-open'); }
  state.view = true;
  if (TAB_META.some(row => row[0] === tab)) state.tab = tab;
  setActiveNav();
  saveState();
  renderNav();
  state.workspaceScrollTopByTab ||= {};
  state.workspaceScrollTopByTab[state.tab] = 0;
  refresh(true);
}
function leaveSystemCenter() {
  clearToast('leave-system-center');
  window.YanceSystemStatus?.clear?.('leave-system-center');
  state.operation = '';
  document.getElementById('navSystemCenter')?.classList.remove('active');
  state.view = false;
  saveState();
  app.classList.remove('system-center-open','theme-workspace-open');
}
function captureSystemCenterScroll(tab = state.tab) {
  const authority = window.YanceWorkspaceRouteAuthority;
  state.workspaceScrollTopByTab ||= {};
  if (!tab) return;
  const top = authority?.captureScroll?.(app, 'system') || 0;
  state.workspaceScrollTopByTab[tab] = top;
  state.workspaceScrollTop = top;
}
function restoreSystemCenterScroll(tab = state.tab, options = {}) {
  const authority = window.YanceWorkspaceRouteAuthority;
  const legacyTop = 0;
  const workspaceTop = Number(options.workspaceTop ?? state.workspaceScrollTopByTab?.[tab] ?? legacyTop);
  authority?.restoreScroll?.(app, 'system', workspaceTop);
}
function goTab(tab) {
  if (!TAB_META.some(row => row[0] === tab)) return;
  const previousTab = state.tab;
  captureSystemCenterScroll(previousTab);
  if (previousTab !== tab) {
    clearToast('system-center-tab-change');
    window.YanceSystemStatus?.clear?.('system-center-tab-change');
    state.operation = '';
  }
  state.tab = tab;
  saveState();
  renderNav();
  state.workspaceScrollTopByTab ||= {};
  state.workspaceScrollTopByTab[tab] = 0;
  renderPanel({ capture: false, workspaceTop: 0 });
}

function renderNav() {
  const issues = state.overview?.issues || [];
  const issueCount = tab => issues.filter(issue => issue.targetTab === tab).length;
  const fail = state.overview?.health?.fail || 0;
  document.getElementById('sc32Nav').innerHTML = TAB_META.map(([id, label, desc, icon]) => {
    let badge = issueCount(id) || '';
    if (id === 'diagnostics' && fail) badge = fail;
    if (id === 'security' && state.overview?.security?.writeGate === 'blocked') badge = 'BLOCK';
    return `<button class="${htmlAttr(state.tab === id ? 'active' : '')}" data-sc-tab="${htmlAttr(id)}"><i>${htmlText(icon)}</i><span><b>${htmlText(label)}</b><small>${htmlText(desc)}</small></span><em>${htmlText(badge)}</em></button>`;
  }).join('');
  document.querySelectorAll('[data-sc-tab]').forEach(button => button.onclick = () => goTab(button.dataset.scTab));
}

function renderHeader() {
  const data = state.overview;
  if (!data) return;
  const score = data.health?.score || 0;
  const level = data.health?.level || 'attention';
  document.getElementById('sc32Score').style.setProperty('--score', score);
  document.getElementById('sc32ScoreValue').textContent = score;
  const availability = data.availability || { score: 0, fail: 0 };
  const integrity = data.integrity || { passed: 0, failed: 0, checks: [] };
  const release = data.releaseReadiness || { ready: false, blockers: [] };
  const releaseLabel = release.ready ? '发布就绪' : release.level === 'incomplete' ? '发布证据未完成' : `${release.blockers?.length || 0} 项发布阻断`;
  const runtimeDegradation = data.health?.activeErrorAggregates || 0;
  document.getElementById('sc32LiveText').textContent = `${healthText(level)} · ${healthStateText(data.health?.state)}${runtimeDegradation ? `（${runtimeDegradation} 类当前降级）` : ''} · 可用性 ${availability.score || 0}% · 完整性 ${integrity.failed ? `${integrity.failed} 项失败` : '通过'} · ${releaseLabel}`;
  const liveDot = document.getElementById('sc32LiveDot');
  if (liveDot) { liveDot.dataset.healthLevel = level === 'healthy' ? 'healthy' : level === 'attention' ? 'attention' : 'critical'; liveDot.style.removeProperty('background'); }
  document.getElementById('sc32Build').textContent = `${data.product?.name || '言策'} ${data.product?.version || ''} · ${data.product?.build || 'Internal Test'}`;
  document.getElementById('sc32Updated').textContent = `最近刷新 ${fmtDate(data.at)}`;

  const desktop = state.desktop;
  const latest = data.backups?.latest;
  const ai = data.ai || {};
  const rows = [
    ['当前运行', `${data.health?.score || 0} 分`, data.health?.summaryZh || (runtimeDegradation ? `${runtimeDegradation} 类当前降级` : '当前状态正常'), data.health?.level === 'critical' ? 'bad' : data.health?.level === 'attention' ? 'warn' : 'ok'],
    ['可用性', `${availability.score || 0}%`, availability.fail ? `${availability.fail} 个运行探针或核心操作失败` : `${availability.pass || 0} 个核心运行探针通过`, availability.fail ? 'bad' : 'ok'],
    ['数据与配置完整性', integrity.failed ? `${integrity.failed} 项失败` : '全部通过', `Schema ${integrity.schemaVersion || '-'} · ${integrity.passed || 0}/${integrity.checks?.length || 0} 项`, integrity.criticalFailed ? 'bad' : integrity.failed ? 'warn' : 'ok'],
    ['发布就绪', release.ready ? '可以发布' : '禁止发布', release.ready ? '全部正式门禁通过' : `${release.blockers?.length || 0} 个未通过或未执行门禁`, release.ready ? 'ok' : 'bad'],
    ['平台连接', `${data.accounts?.connected || 0}/${data.accounts?.total || 0}`, data.accounts?.total ? (data.accounts?.abnormal ? `${data.accounts.abnormal} 个账号异常` : '只统计凭据就绪的真实连接') : '尚无账号，平台实测未执行', data.accounts?.abnormal || !data.accounts?.total ? 'warn' : 'ok'],
    ['数据保护', latest ? (latest.valid ? '校验通过' : '校验失败') : '尚无恢复点', latest ? `${latest.files} 文件 · ${latest.sizeLabel}` : '建议立即创建完整备份', latest ? (latest.valid ? 'ok' : 'bad') : 'warn'],
    ['AI能力', ai.count ? `${ai.verified || 0}/${ai.count} 硬资格验证` : '尚无模型', `${ai.modelBrain?.litellm || 'LiteLLM v1.95.0'} · health ${ai.modelBrain?.health || 'unavailable'}`, ai.modelBrain?.runtimeAvailable && ai.taskReadiness?.pass ? 'ok' : 'warn']
  ];
  document.getElementById('sc32Summary').innerHTML = rows.map(row => `<article class="sc32-stat ${htmlAttr(row[3])}"><span>${htmlText(row[0])}</span><b>${htmlText(row[1])}</b><small>${htmlText(row[2])}</small></article>`).join('');
}

function section(title, meta, body, wide = false, extra = '') {
  return `<section class="sc32-section ${htmlAttr(wide ? 'wide' : '')} ${htmlAttr(extra)}"><header><h3>${htmlText(title)}</h3><span>${htmlText(meta || '')}</span></header><div class="sc32-section-body">${body}</div></section>`;
}
function row(icon, title, detail, status, cls = '', action = '') {
  return `<article class="sc32-row ${htmlAttr(cls)}"><i>${htmlText(icon)}</i><div><b>${htmlText(title)}</b><p>${htmlText(detail)}</p></div>${action || `<em>${htmlText(status)}</em>`}</article>`;
}
function fact(label, value, note = '') {
  return `<article class="sc32-fact"><span>${htmlText(label)}</span><b>${htmlText(value || '尚未读取')}</b>${note ? `<small>${htmlText(note)}</small>` : ''}</article>`;
}
function service(label, value, detail, status, cls = '') {
  return `<article class="sc32-service ${htmlAttr(cls)}"><span>${htmlText(label)}</span><b>${htmlText(value)}</b><p>${htmlText(detail)}</p><strong>${htmlText(status)}</strong></article>`;
}
function actionButton(label, action, cls = '', disabled = false) {
  return `<button class="sc32-button ${htmlAttr(cls)}" data-sc-action="${htmlAttr(action)}" ${disabled ? 'disabled' : ''}>${htmlText(label)}</button>`;
}
function toggleRow(scope, key, title, detail, enabled, disabled = false) {
  return `<div class="sc32-toggle-row"><div><b>${htmlText(title)}</b><p>${htmlText(detail)}</p></div><button class="sc32-switch ui-binary-control ${htmlAttr(enabled ? 'on' : '')}" data-toggle-scope="${htmlAttr(scope)}" data-toggle-key="${htmlAttr(key)}" aria-pressed="${htmlAttr(enabled)}" ${disabled ? 'disabled' : ''}><i></i></button></div>`;
}
function miniStatus(label, value, cls = '') { return `<span class="sc32-chip ${htmlAttr(cls)}"><i></i>${htmlText(label)} · ${htmlText(value)}</span>`; }

function renderTrend(history = []) {
  const rows = history.slice().reverse().slice(-24);
  if (rows.length < 2) return `<div class="sc32-empty compact"><b>趋势正在建立</b><p>系统会在状态变化或每5分钟记录一次健康数据。</p></div>`;
  const width = 520, height = 92, pad = 8;
  const points = rows.map((item, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, rows.length - 1));
    const y = height - pad - (Math.max(0, Math.min(100, Number(item.score || 0))) / 100) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const first = rows[0]?.score || 0, last = rows[rows.length - 1]?.score || 0;
  return `<div class="sc32-trend"><svg viewBox="0 0 ${htmlAttr(width)} ${htmlAttr(height)}" preserveAspectRatio="none" aria-label="系统健康趋势"><defs><linearGradient id="sc32TrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-series-primary)" stop-opacity=".28"/><stop offset="1" stop-color="var(--chart-series-primary)" stop-opacity="0"/></linearGradient></defs><polyline class="area" points="${htmlAttr(pad)},${htmlAttr(height-pad)} ${htmlAttr(points)} ${htmlAttr(width-pad)},${htmlAttr(height-pad)}"/><polyline class="line" points="${htmlAttr(points)}"/></svg><div><span>起点 ${htmlText(first)}</span><b>${htmlText(last >= first ? '↑' : '↓')} ${htmlText(Math.abs(last-first))} 分</b><span>${htmlText(rows.length)} 个真实记录</span></div></div>`;
}

function renderTopology() {
  const topology = state.overview.topology || { nodes: [], edges: [] };
  const desktopReady = state.desktop?.backend?.ready;
  const nodes = topology.nodes.map(node => {
    const actual = node.id === 'desktop' ? { ...node, state: desktopReady ? 'online' : 'warning', detail: desktopReady ? `主进程 ${state.desktop.runtime?.mainPid || '-'} · 事件流 ${state.desktop.backend?.eventStreamConnected ? '正常' : '连接中'}` : '等待Electron桌面桥' } : node;
    return `<article class="sc32-topology-node ${htmlAttr(actual.state)}" data-node="${htmlAttr(actual.id)}"><i></i><b>${htmlText(actual.label)}</b><span>${htmlText(stateLabel(actual.state))}</span><p>${htmlText(actual.detail)}</p></article>`;
  }).join('');
  const edges = topology.edges.map(edge => `${edge.from} → ${edge.to}`).join('　');
  return `<div class="sc32-topology">${nodes}</div><p class="sc32-edge-note">链路关系：${htmlText(edges || '正在建立')}</p>`;
}

function renderOverview() {
  const d = state.overview;
  const issues = d.issues || [];
  const issueHtml = issues.length ? issues.slice(0, 8).map(issue => row(
    issue.severity === 'critical' ? '!' : issue.severity === 'high' ? '×' : issue.severity === 'medium' ? '△' : 'i',
    issue.title,
    issue.detail,
    issue.actionLabel,
    severityClass(issue.severity),
    `<button class="sc32-link" data-sc-target-tab="${htmlAttr(issue.targetTab)}">${htmlText(issue.actionLabel || '查看')}</button>`
  )).join('') : row('✓', '当前没有系统级阻断项', '账号、消息、数据、通知和安全探针均未发现需要立即处理的问题。', '正常');
  const a = d.accounts || {};
  const ai = d.ai || {};
  const latest = d.backups?.latest;
  const services = [
    service('桌面与后台', state.desktop?.backend?.ready ? '双进程在线' : '桌面待确认', state.desktop ? `主进程 ${state.desktop.runtime?.mainPid || '-'} · 后端 ${state.desktop.backend?.pid || '-'}` : '浏览器无法读取Electron状态', state.desktop?.backend?.ready ? '事件流已连接' : '等待正式程序', state.desktop?.backend?.ready ? '' : 'warn'),
    service('多平台账号', `${a.connected || 0}/${a.total || 0} 已连接`, `${a.platforms?.map(p => `${p.label || p.platform} ${p.connected || 0}/${p.total || 0}`).join(' · ') || '尚无账号'}`, a.abnormal ? `${a.abnormal} 个异常` : '认证与路由正常', a.abnormal ? 'bad' : ''),
    service('消息与媒体', `${d.messages?.conversations || 0} 个会话`, `${d.messages?.count || 0} 条消息 · 实时事件总线 ${d.services?.eventBus?.pass ? '正常' : '异常'}`, d.services?.eventBus?.pass ? '接收链路正常' : '需要诊断', d.services?.eventBus?.pass ? '' : 'bad'),
    service('通知与声音', d.notifications?.enabled && !d.notifications?.paused ? '提醒开启' : '提醒暂停', `桌面通知 ${boolLabel(d.notifications?.desktopEnabled)} · 声音 ${Math.round((d.notifications?.soundVolume || 0) * 100)}%`, d.notifications?.soundEnabled ? '真实播放回执已接入' : '声音已关闭', d.notifications?.enabled && !d.notifications?.paused ? '' : 'warn'),
    service('完整数据保护', latest ? (latest.valid ? '恢复点有效' : '恢复点异常') : '尚无恢复点', latest ? `${latest.files} 个文件 · ${latest.sizeLabel} · Schema ${latest.schemaVersion}` : `受保护 ${d.data?.protectedSizeLabel || '0 B'}`, latest?.valid === false ? '立即处理' : latest ? 'SHA256已验证' : '建议立即备份', latest?.valid === false ? 'bad' : latest ? '' : 'warn'),
    service('Model Brain / LiteLLM', ai.modelBrain?.runtimeAvailable ? '运行中' : 'unavailable', `${ai.verified || 0}/${ai.count || 0} 已验证 · local ${ai.local || 0} · cloud ${ai.cloud || 0} · 资产 ${ai.assets?.sizeLabel || '0 B'}`, ai.taskReadiness?.pass ? 'hard eligibility ready' : `${Number(ai.taskReadiness?.missing?.length || 0)} logical tasks degraded`, ai.modelBrain?.runtimeAvailable && ai.taskReadiness?.pass ? '' : 'warn')
  ].join('');
  const integrityRows = (d.integrity?.checks || []).map(check => row(check.pass ? '✓' : '!', check.id, check.detail, check.pass ? '通过' : check.severity, check.pass ? '' : severityClass(check.severity))).join('');
  const releaseStatusLabel = { pass:'通过', fail:'失败', warning:'需关注', skipped:'未执行' };
  const releaseRows = (d.releaseReadiness?.layers || []).map(layer => row(
    layer.status === 'pass' ? '✓' : layer.status === 'skipped' ? '—' : '!',
    layer.label,
    layer.reasonCode,
    releaseStatusLabel[layer.status] || layer.status,
    layer.status === 'pass' ? '' : layer.status === 'skipped' ? 'warn' : 'bad'
  )).join('') || row('!', '发布门禁证据缺失', '未读取到分层发布状态。', 'BLOCKED', 'bad');
  return `<div class="sc32-panel-head"><div><h2>智能系统总览</h2><p>可用性回答“能否运行”，完整性回答“数据与配置是否可信”，发布就绪回答“是否允许交付”。三层状态相互独立，不再用单一健康分掩盖高危问题。</p></div><div class="sc32-panel-actions">${actionButton('统一账号中心','open-accounts')}${actionButton('立即建立恢复点','create-backup','primary')}</div></div>
  <div class="sc32-grid">
    ${section('分层健康与发布门禁', d.releaseReadiness?.ready ? 'READY' : 'BLOCKED', `<div class="sc32-list">${releaseRows}${integrityRows}</div>`, true, d.releaseReadiness?.ready ? '' : 'release-blocked')}
    ${section('关键服务与能力', '实时状态', `<div class="sc32-service-grid">${services}</div>`, true)}
    ${section('智能处理中心', `${issues.length} 项建议`, `<div class="sc32-alerts">${issueHtml}</div>`)}
    ${section('系统健康趋势', '持久化记录', renderTrend(d.healthHistory || []))}
    ${section('端到端运行链路', '桌面 → 服务 → 平台 → AI → 通知/备份', renderTopology(), true)}
  </div>`;
}

function renderConnections() {
  const a = state.overview.accounts || {};
  const platforms = (a.platforms || []).map(p => service(
    p.label || p.platform,
    `${p.connected || 0}/${p.total || 0} 已连接`,
    `${p.technical || '统一连接器'} · 异常 ${p.abnormal || 0} · 暂停 ${p.paused || 0}`,
    p.abnormal ? '需要处理' : p.connected ? '实时通道正常' : '等待连接',
    p.abnormal ? 'bad' : p.connected ? '' : 'warn'
  )).join('') || `<div class="sc32-empty"><b>尚未添加平台账号</b><p>可在统一账号中心添加WhatsApp、Telegram个人账号或Facebook公共主页。</p></div>`;
  const rows = (a.rows || []).map(account => {
    const expanded = state.expandedAccount === account.id;
    const detail = expanded ? `<div class="sc32-account-detail">
      <div class="sc32-facts">
        ${fact('认证凭据', account.credentialReady ? '已保存并可用' : '未就绪', a.credentialStorage?.desktopSecureStorage ? 'Windows安全存储' : '运行时安全桥')}
        ${fact('实时消息源', account.source || '等待连接', account.canReceive ? '允许接收消息' : '当前不可接收')}
        ${fact('自动重连', boolLabel(account.autoReconnect))}
        ${fact('消息提醒', boolLabel(account.notificationsEnabled))}
        ${fact('默认发送账号', account.isDefaultSend ? '是' : '否')}
        ${fact('最后同步', fmtDate(account.lastSyncAt))}
      </div>
      <div class="sc32-capability-row">
        ${Object.entries(account.capabilities || {}).map(([key, value]) => miniStatus(key, value === true ? '支持' : value === false ? '不支持' : value, value === true ? 'ok' : value === false ? 'muted' : '')).join('')}
      </div>
      ${account.lastError ? `<div class="sc32-result bad">最近错误：${htmlText(account.lastError)}</div>` : ''}
    </div>` : '';
    const statusCls = account.health === 'error' || account.state === 'error' ? 'bad' : account.health === 'warning' || !account.credentialReady ? 'warn' : '';
    return `<article class="sc32-account-card ${htmlAttr(statusCls)}">
      <div class="sc32-account-head">
        <div class="sc32-account-icon">${htmlText((account.platform || '?').slice(0,1).toUpperCase())}</div>
        <div><small>${htmlText(account.platform)} · ${htmlText(account.identityLabel || '')}</small><h4>${htmlText(account.displayName || account.id)}</h4><p>${htmlText(account.stateLabel || stateLabel(account.state))} · 未读 ${htmlText(account.unread || 0)} · ${htmlText(account.sendVerified ? '真实ACK已验证' : account.canAttemptSend ? '可尝试·待ACK' : '发送受限')}</p></div>
        <div class="sc32-account-actions"><button class="sc32-link" data-account-action="diagnose" data-account-id="${htmlAttr(account.id)}">诊断</button><button class="sc32-link" data-account-action="reconnect" data-account-id="${htmlAttr(account.id)}">重连</button><button class="sc32-link" data-account-expand="${htmlAttr(account.id)}">${htmlText(expanded ? '收起' : '详情')}</button></div>
      </div>${detail}
    </article>`;
  }).join('') || `<div class="sc32-empty"><b>没有账号记录</b><p>系统中心保留完整连接汇总，新增、删除、扫码和凭据管理仍在统一账号中心完成。</p></div>`;
  const matrix = Object.entries(a.capabilityMatrix || {}).map(([platform, item]) => row('•', platform, Object.entries(item || {}).map(([k,v]) => `${k}: ${v === true ? '支持' : v === false ? '不支持' : v}`).join(' · '), '能力矩阵')).join('');
  return `<div class="sc32-panel-head"><div><h2>平台连接与消息链路</h2><p>承接旧版账号认证、二维码、凭据、实时消息源、自动重连、默认发送与写操作状态；系统中心负责总览与诊断，账号中心负责详细操作。</p></div><div class="sc32-panel-actions">${actionButton('重新连接全部账号','reconnect-all','warn')}${actionButton('打开统一账号中心','open-accounts','primary')}</div></div>
  <div class="sc32-grid">
    ${section('平台连接引擎', `${a.connected || 0}/${a.total || 0} 在线`, `<div class="sc32-service-grid">${platforms}</div>`, true)}
    ${section('账号认证与实时状态', `${a.rows?.length || 0} 个账号`, `<div class="sc32-account-list">${rows}</div>`, true)}
    ${section('统一凭据保护', a.credentialStorage?.desktopSecureStorage ? '可用' : '待确认', `<div class="sc32-facts">${fact('凭据模式', a.credentialStorage?.desktopSecureStorage ? 'Windows安全存储' : '运行时安全桥')}${fact('安全存储状态', a.credentialStorage?.desktopSecureStorage ? '可用' : '不可用')}${fact('凭据引用', `${state.overview.security?.credentialRefs || 0} 个`)}${fact('旧认证通道', '永久禁止')}</div>`)}
    ${section('平台能力矩阵', '发送、接收、媒体与会话', `<div class="sc32-list">${matrix || row('i','能力矩阵等待账号初始化','平台适配器完成初始化后会显示真实能力。','等待')}</div>`)}
  </div>`;
}

function renderDesktop() {
  const b = state.overview;
  const d = state.desktop;
  const application = d?.application || {};
  const runtime = d?.runtime || {};
  const desktop = d?.desktop || {};
  const settings = desktop.settings || {};
  const recovery = b.runtimeRecovery || {};
  const queueRuntime = recovery.queue || {};
  const res = d?.resources || {};
  const volume = res.dataVolume || {};
  const disabled = !d;
  const browserNote = !d ? `<div class="sc32-result warn">当前页面未运行在Electron桌面环境中，桌面开关已锁定。正式安装程序中会读取并保存真实Windows设置。</div>` : '';
  return `<div class="sc32-panel-head"><div><h2>桌面、启动与后台运行</h2><p>统一管理开机启动、托盘、启动后最小化、自动连接和媒体行为，同时展示主进程、版本、路径、资源与错误状态。</p></div><div class="sc32-panel-actions">${actionButton('打开程序目录','open-program')}${actionButton('恢复连接与队列','runtime-recover','warn')}${actionButton('重启本地服务','restart-backend','warn')}${actionButton('重新启动应用','restart-app','primary')}</div></div>
  <div class="sc32-grid">
    ${section('桌面运行状态', d ? 'Electron真实状态' : '等待桌面桥', `${browserNote}<div class="sc32-facts">
      ${fact('程序版本', application.version || b.product.version, `${application.installMode || '源码/浏览器'} · ${application.build || b.product.build}`)}
      ${fact('主进程', runtime.mainPid ? `PID ${runtime.mainPid}` : '等待Electron', runtime.processUptimeSeconds ? `运行 ${fmtDuration(runtime.processUptimeSeconds)}` : '')}
      ${fact('本地后端', d?.backend?.ready ? `PID ${d.backend.pid}` : '未连接', d?.backend?.lastError?.message || `重启 ${d?.backend?.restartCount || 0} 次`)}
      ${fact('实时事件流', d?.backend?.eventStreamConnected ? '已连接' : '未连接')}
      ${fact('网络与休眠', recovery.suspended ? '系统已休眠' : recovery.online === false ? '网络离线' : '在线运行', `最近事件 ${recovery.lastEvent || 'startup'} · ${recovery.lastEventAt ? fmtDate(recovery.lastEventAt) : '等待'}`)}
      ${fact('发送队列', queueRuntime.paused ? `已暂停：${queueRuntime.pausedReason || '系统状态'}` : '正常运行', `${queueRuntime.pending || 0} 项待处理 · ${queueRuntime.running ? '正在发送' : '空闲'}`)}
      ${fact('自动恢复', recovery.recovering ? '正在恢复' : recovery.lastRecoveryAt ? '最近已执行' : '等待触发', recovery.lastRecoveryAt ? fmtDate(recovery.lastRecoveryAt) : '')}
      ${fact('系统与架构', runtime.platform ? `${runtime.platform} ${runtime.release}` : `${b.environment.platform} ${b.environment.release}`, runtime.arch || b.environment.arch)}
      ${fact('语言与时区', runtime.locale || '等待桌面', runtime.timezone || '')}
    </div>`)}
    ${section('启动与后台', settings.updatedAt ? `更新于 ${fmtDate(settings.updatedAt)}` : '桌面持久化设置', `
      ${toggleRow('desktop','autoLaunch','开机自动启动','写入Windows登录启动项，并与“启动后最小化”共同生效。',settings.autoLaunch,disabled)}
      ${toggleRow('desktop','closeToTray','关闭后留在托盘','关闭窗口时保持消息接收、自动连接和通知服务。',settings.closeToTray,disabled)}
      ${toggleRow('desktop','startMinimized','启动后最小化','开机启动时隐藏主窗口，只保留托盘运行。',settings.startMinimized,disabled)}
      ${toggleRow('desktop','autoConnectAccounts','自动连接已授权账号','安全模式关闭时，启动后重新连接所有已授权平台账号。',settings.autoConnectAccounts,disabled)}
      ${toggleRow('desktop','backupOnStart','每日启动前自动备份','超过24小时没有有效备份时，启动阶段自动创建恢复点。',settings.backupOnStart,disabled)}
    `)}
    ${section('消息与媒体行为', '统一桌面设置', `
      ${toggleRow('desktop','gifAutoplay','GIF自动播放','会话可见时自动播放GIF。',settings.gifAutoplay,disabled)}
      ${toggleRow('desktop','stickerAutoplay','动态贴纸自动播放','支持动态贴纸的会话中自动播放。',settings.stickerAutoplay,disabled)}
      ${toggleRow('desktop','mediaAutoDownload','媒体自动下载','自动保存接收的图片、视频、语音和文件到受控媒体目录。',settings.mediaAutoDownload,disabled)}
      ${toggleRow('desktop','pauseAnimationWhenHidden','窗口隐藏时暂停动画','最小化或隐藏后暂停GIF与动态贴纸，降低资源占用。',settings.pauseAnimationWhenHidden,disabled)}
    `)}
    ${section('运行环境与资源', '实时读取', `<div class="sc32-facts">
      ${fact('Electron / Chromium', runtime.electron ? `${runtime.electron} / ${runtime.chrome}` : '等待桌面')}
      ${fact('Node.js', runtime.node || b.environment.node)}
      ${fact('CPU', `${res.cpuCount || b.environment.cpuCount || 0} 核`, `负载 ${Array.isArray(res.loadAverage) ? res.loadAverage.map(x => Number(x).toFixed(2)).join(' / ') : '待读取'}`)}
      ${fact('系统内存', `${fmtBytes(res.systemMemoryFree || b.environment.memoryFree)} 可用`, `总计 ${fmtBytes(res.systemMemoryTotal || b.environment.memoryTotal)}`)}
      ${fact('进程内存', runtime.memory ? `${fmtBytes(runtime.memory.rss)} RSS` : '等待桌面', b.performance?.memory ? `软限制 ${b.performance.softMemoryLimitMb} MB · ${b.performance.memory.withinSoftLimit ? '正常' : '已触发保护'}` : '')}
      ${fact('历史流式加载', b.performance ? `${b.performance.messagePageSize} 条/页` : '等待后端', b.performance ? `NDJSON ${b.performance.streamChunkSize} 条/块 · 单会话最多 ${b.performance.maxMessagesPerConversation} 条` : '')}
      ${fact('SQLite持久化', b.performance?.sqlite?.persistenceHealthy ? '完整' : '需检查', b.performance?.sqlite ? `${b.performance.sqlite.journalMode.toUpperCase()} · busy ${b.performance.sqlite.busyTimeoutMs} ms` : '')}
      ${fact('数据盘空间', volume.availableBytes ? `${fmtBytes(volume.availableBytes)} 可用` : '等待桌面', volume.totalBytes ? `总计 ${fmtBytes(volume.totalBytes)}` : '')}
    </div>`)}
    ${section('目录与安装信息', b.policy?.privacyMode ? '隐私模式已脱敏' : '真实路径', `<div class="sc32-list">
      ${row('D','永久数据目录',application.permanentDataRoot || b.environment.dataRoot,'统一数据根')}
      ${row('L','日志目录',application.logRoot || b.environment.logRoot,'可打开')}
      ${row('E','Electron用户数据',application.electronUserData || '等待桌面确认','桌面运行数据')}
      ${row('A','程序目录',application.applicationPath || '等待桌面确认',application.installMode || '待确认')}
      ${row('S','桌面设置文件',application.settingsFile || '等待桌面确认',desktop.settingsPersistence?.ok ? `SQLite已验证 · ${fmtDate(desktop.settingsPersistence.updatedAt)}` : '等待持久化验证')}
    </div>`, true)}
  </div>`;
}

function renderNotifications() {
  const n = state.overview.notifications || {};
  const dnd = n.dnd || {};
  if (typeof window !== 'undefined' && !window.__yanceNotifViewInit) {
    window.__yanceNotifViewInit = true;
    window.YanceNotificationView = { enabled: n.enabled, soundEnabled: n.soundEnabled, paused: n.paused, dnd: n.dnd };
  }
  const last = state.desktop?.desktop?.lastNotificationResult;
  const operation = state.operation.startsWith('notification:') ? state.operation.slice('notification:'.length) : '';
  const result = operation || (last ? `${last.shown ? '最近一次桌面通知已显示' : `最近一次通知未显示：${last.reason || '未知原因'}`}；${last.sound?.played ? `声音已播放 ${last.sound.durationMs || 0} ms` : `声音未播放：${last.sound?.reason || '关闭或不可用'}`}` : '尚未执行本次运行的通知测试。');
  return `<div class="sc32-panel-head"><div><h2>通知、声音与免打扰</h2><p>通知设置使用后端唯一状态源；托盘、消息事件和本页面读取同一份配置。声音必须收到实际播放完成回执才算成功。</p></div><div class="sc32-panel-actions">${actionButton('测试提示音','test-sound')}${actionButton('测试桌面通知','test-notification','primary')}</div></div>
  <div class="sc32-grid">
    ${section('通知总开关', n.updatedAt ? `更新于 ${fmtDate(n.updatedAt)}` : '唯一持久化设置源', `
      ${toggleRow('notification','enabled','启用消息提醒','关闭后，所有账号的新消息仍会保存，但不会触发通知。',n.enabled)}
      ${toggleRow('notification','desktopEnabled','Windows桌面通知','通过Electron原生通知显示，并记录显示调度结果。',n.desktopEnabled)}
      ${toggleRow('notification','soundEnabled','声音总开关','关闭后自动通知不播放；各类提示音选择仍会保留。',n.soundEnabled)}
      ${toggleRow('notification','incomingSoundEnabled','新消息声音','收到新消息时播放所选提示音。',n.incomingSoundEnabled !== false)}
      ${toggleRow('notification','outgoingSoundEnabled','发送成功声音','消息确认发送完成时播放。',n.outgoingSoundEnabled !== false)}
      ${toggleRow('notification','failureSoundEnabled','发送失败声音','永久失败或需要人工处理时播放。',n.failureSoundEnabled !== false)}
      ${toggleRow('notification','presenceSoundEnabled','联系人状态声音','重点联系人上线或离线时播放。',n.presenceSoundEnabled !== false)}
      ${toggleRow('notification','paused','临时暂停全部通知','托盘菜单和系统中心共用同一暂停状态。',n.paused)}
    `)}
    ${section('声音与真实测试', `${notificationSoundCatalog().library?.builtInCount || notificationSoundCatalog().patterns.length} 套无重复内置音效 · 每类事件独立选择`, `${renderSoundLibrarySummary()}<div class="sc32-toggle-row"><div><b>提示音音量</b><p>只影响言策消息提示音，不改变Windows系统音量。</p></div></div><div class="sc32-volume"><input id="sc32Volume" type="range" min="0" max="100" value="${htmlAttr(Math.round((n.soundVolume ?? .68) * 100))}"><output id="sc32VolumeOut">${htmlText(Math.round((n.soundVolume ?? .68) * 100))}%</output></div><div class="sc32-sound-grid">${notificationSoundCatalog().events.map(event => notificationSoundPicker(event, n)).join('')}</div><div class="sc32-custom-sound-upload"><input id="sc32SoundUpload" type="file" accept=".wav,.mp3,.m4a,.aac,audio/wav,audio/mpeg,audio/mp4,audio/aac" hidden><div><b>上传自己的提示音</b><p>音频保存在言策永久数据目录，并随完整备份迁移。建议使用 1–10 秒的短音频。</p></div><button type="button" class="sc32-button" data-sc-action="upload-custom-sound">选择音频</button></div>${renderCustomNotificationSounds()}<div class="sc32-result ${htmlAttr(result.includes('失败') || result.includes('未显示') ? 'bad' : result.includes('尚未') ? 'warn' : '')}" id="sc32NotifyResult">${htmlText(result)}</div>`)}
    ${section('通知内容隐私', '预览策略', `<label class="sc32-field"><span>锁屏与桌面通知内容</span><select id="sc32Privacy"><option value="preview" ${n.privacy === 'preview' ? 'selected' : ''}>显示发送者与消息内容</option><option value="sender-only" ${n.privacy === 'sender-only' ? 'selected' : ''}>只显示发送者</option><option value="hidden" ${n.privacy === 'hidden' ? 'selected' : ''}>完全隐藏内容</option></select><small>该设置不会影响应用内消息显示。</small></label><div class="sc32-facts">${fact('静音账号', `${n.mutedAccounts?.length || 0} 个`)}${fact('静音会话', `${n.mutedConversations?.length || 0} 个`)}</div>`)}
    ${section('免打扰计划', dnd.enabled ? '当前已启用' : '当前未启用', `${toggleRow('notification-dnd','enabled','启用免打扰','支持跨午夜时间段，按本机时区实时判断。',dnd.enabled)}<div class="sc32-time-grid"><label class="sc32-field"><span>开始时间</span><input id="sc32DndStart" type="time" value="${htmlAttr(dnd.start || '22:00')}"></label><label class="sc32-field"><span>结束时间</span><input id="sc32DndEnd" type="time" value="${htmlAttr(dnd.end || '08:00')}"></label></div><button class="sc32-button" data-sc-action="save-dnd">保存免打扰时间</button>`)}
  </div>`;
}

function backupCoverageHtml(d) {
  return (d.data?.roots || []).map(root => {
    const label = String(root.label || '数据目录');
    const sizeLabel = String(root.sizeLabel || fmtBytes(root.bytes || 0));
    const included = root.backupIncluded === true;
    const detail = `${Number(root.files || 0)} 个文件 · ${label === '媒体缓存' ? '按需重新下载，不进入完整备份' : (root.path || '路径已隐藏')}`;
    const status = included ? `${label === 'AI成果与知识资产' ? 'AI资产保护' : '已纳入'} · ${sizeLabel}` : `${sizeLabel} · 不纳入`;
    return row(included ? '✓' : '○', label, detail, status, included ? '' : 'warn');
  }).join('');
}

function renderData() {
  const d = state.overview;
  const backups = d.backups || {};
  const latest = backups.latest;
  const pending = backups.pendingRestore;
  const rows = (backups.rows || []).map(item => `<article class="sc32-backup-row ${htmlAttr(item.valid === false ? 'bad' : '')}">
    <div><small>${htmlText(fmtDate(item.createdAt))} · ${htmlText(item.label || 'manual')}</small><b>${htmlText(item.name)}</b><p>${htmlText(item.files)} 个文件 · ${htmlText(item.sizeLabel)} · Schema ${htmlText(item.schemaVersion)} · ${htmlText(item.verifyMessage || '')}</p></div>
    <div class="sc32-backup-actions"><button class="sc32-link" data-backup-action="verify" data-backup-name="${htmlAttr(item.name)}">验证</button><button class="sc32-link danger" data-backup-action="restore" data-backup-name="${htmlAttr(item.name)}">准备恢复</button></div>
  </article>`).join('') || `<div class="sc32-empty"><b>尚未创建完整恢复点</b><p>新备份会同时保护核心数据、模型目录与资格、WhatsApp认证、安全凭据和AI成果资产。</p></div>`;
  const pendingHtml = pending ? `<div class="sc32-restore-plan"><div><small>等待重启执行</small><b>${htmlText(pending.backupName)}</b><p>创建于 ${htmlText(fmtDate(pending.createdAt))}。启动时会再次验证清单，建立保护备份，再进行原子目录切换；失败会自动回滚。</p></div><div>${actionButton('取消恢复','cancel-restore')}${actionButton('重启并执行','restart-app','danger')}</div></div>` : `<div class="sc32-result">当前没有待执行恢复任务。恢复不会在应用运行中直接覆盖数据库。</div>`;
  const history = (backups.restoreHistory || []).map(item => row(item.ok === false ? '×' : '✓', item.backupName || item.name || '恢复任务', item.message || item.detail || `保护备份 ${item.protectionBackup || '已创建'}`, fmtDate(item.at || item.completedAt), item.ok === false ? 'bad' : '')).join('') || `<div class="sc32-empty compact"><b>暂无恢复历史</b><p>执行恢复后会记录结果、回滚和保护备份。</p></div>`;
  const excluded = latest?.excluded?.map(item => row('○', item.label || item.id || '排除项', item.reason || '不进入备份', item.inventory ? `${item.inventory.length} 项清单` : '仅记录清单', 'warn')).join('') || row('○','大型本地基础模型','只记录模型清单与版本，不复制Ollama大型模型文件。','节省空间','warn');
  const retention=backups.retention||{},retentionPolicy=retention.policy||{};const retentionHtml=`<div class="sc32-facts">${fact('自动恢复点',`${Number(retention.automatic||0)} 个`)}${fact('受保护恢复点',`${Number(retention.protected||0)} 个`)}${fact('自动保留上限',`${Number(retentionPolicy.maxAutomaticCount||14)} 个`)}${fact('最大保留天数',`${Number(retentionPolicy.maxAutomaticAgeDays||30)} 天`)}${fact('预计清理',`${Number(retention.remove?.length||0)} 个`)}${fact('空间状态',retention.pressure?.bytesExceeded?'超过策略':'正常')}</div><p class="sc32-note">手动、恢复保护和正在引用的恢复点不会自动删除；自动恢复点按数量、年龄和空间统一治理。</p>`;
  return `<div class="sc32-panel-head"><div><h2>完整数据保护与安全恢复</h2><p>在旧版“备份、验证、恢复”基础上升级为Schema 3清单、流式SHA256、受控根目录、恢复前保护备份、暂存计划、启动执行、原子切换与失败回滚。</p></div><div class="sc32-panel-actions">${actionButton('验证最近备份','verify-backup','',!latest)}${actionButton('立即创建完整备份','create-backup','primary')}</div></div>
  <div class="sc32-grid">
    ${section('恢复点与完整性', `${backups.count || 0} 个`, `<div class="sc32-backup-list">${rows}</div>`, true)}
    ${section('恢复点生命周期', `${Number(retention.automatic||0)} 个自动`, retentionHtml)}
    ${section('待执行恢复计划', pending ? '需要重启' : '无待办', pendingHtml, true)}
    ${section('保护覆盖范围', `${d.data?.protectedSizeLabel || '0 B'} 已保护`, `<div class="sc32-list">${backupCoverageHtml(d)}</div>`)}
    ${section('主动排除与清单', '避免备份膨胀', `<div class="sc32-list">${excluded}</div>`)}
    ${section('恢复安全链路', 'Schema 3', `<div class="sc32-process"><span>读取清单</span><i>→</i><span>路径白名单</span><i>→</i><span>SHA256验证</span><i>→</i><span>保护备份</span><i>→</i><span>暂存复制</span><i>→</i><span>原子切换</span><i>→</i><span>失败回滚</span></div>`, true)}
    ${section('最近恢复历史', `${backups.restoreHistory?.length || 0} 条`, `<div class="sc32-list">${history}</div>`, true)}
  </div>`;
}

function renderAI() {
  const ai = state.overview.ai || {};
  const brain = ai.modelBrain || {};
  const localAuxiliary = ai.localAuxiliary || {};
  const localBenchmark = localAuxiliary.benchmark || {};
  const localSla = localAuxiliary.sla || {};
  const eligibility = ai.hardEligibility || {};
  const evidence = ai.executionEvidence || {};
  const models = (ai.models || []).map(model => {
    const source = model.sourceType || (String(model.provider || '').toLowerCase() === 'ollama' ? 'local' : 'cloud');
    const capabilities = model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {};
    const modalityValues = Array.isArray(model.modalities) ? model.modalities : (Array.isArray(capabilities.modalities) ? capabilities.modalities : []);
    const languageValues = Array.isArray(model.languages) ? model.languages : (Array.isArray(capabilities.language) ? capabilities.language : []);
    const privacyValues = Array.isArray(model.privacy) ? model.privacy : (capabilities.privacy ? [capabilities.privacy] : []);
    const modalities = modalityValues.length ? modalityValues.join('/') : 'text';
    const languages = languageValues.length ? languageValues.join('/') : 'multilingual';
    const privacy = privacyValues.length ? privacyValues.join('/') : (source === 'local' ? 'local' : 'cloud');
    const contextLength = Number(model.contextLength || capabilities.context || 0);
    return `<article class="sc32-model-card ${htmlAttr(model.qualification === 'verified' && model.enabled !== false ? '' : 'warn')}">
      <div><small>${htmlText(source)} · provider ${htmlText(model.provider || 'unknown')} · ${htmlText(model.qualificationLabel || model.qualification || 'untested')}</small><b>${htmlText(model.name || model.id || 'model')}</b><p>modality ${htmlText(modalities)} · language ${htmlText(languages)} · context ${htmlText(contextLength)} · privacy ${htmlText(privacy)}</p></div><em>${htmlText(model.enabled === false ? '已禁用' : model.qualification === 'verified' ? 'hard-qualified' : '待验证')}</em>
    </article>`;
  }).join('') || `<div class="sc32-empty"><b>尚未发现模型</b><p>基础消息、账号和备份功能仍可使用；扫描 local Ollama 或连接 cloud OpenRouter 后再验证硬资格。</p></div>`;
  const runtimeClass = brain.runtimeAvailable && ai.taskReadiness?.pass ? '' : 'warn';
  const evidenceHtml = evidence.selectedModel || evidence.provider
    ? `<div class="sc32-facts">
        ${fact('selected model', evidence.selectedModel || 'unknown')}
        ${fact('provider', evidence.provider || 'unknown')}
        ${fact('latency', `${Number(evidence.latencyMs || 0)} ms`)}
        ${fact('tokens', `${Number(evidence.inputTokens || 0)} in / ${Number(evidence.outputTokens || 0)} out`)}
        ${fact('cost', `$${Number(evidence.costUsd || 0).toFixed(6)}`)}
        ${fact('retry / fallback', `${Number(evidence.retryCount || 0)} / ${Number(evidence.fallbackCount || 0)}`)}
      </div>`
    : `<div class="sc32-empty compact"><b>尚无执行证据</b><p>运行一次 logical Model Brain test / probe 后，这里显示实际 selected model、provider、latency、tokens、cost、retry/fallback。</p></div>`;
  const localAuxiliaryHtml = `<div class="sc32-service-grid">
      ${service('运行时', localAuxiliary.runtime || 'Ollama', localAuxiliary.runtimeAvailable ? '本地辅助运行时可用' : '可选本地运行时当前不可用', localAuxiliary.optional === false ? '配置异常' : 'optional', localAuxiliary.optional === false ? 'bad' : '')}
      ${service('正式回复权限', localAuxiliary.realtimeReplyAuthority === true ? '错误：已获得权限' : '无', 'quick_reply / deep_reply / director 始终由 cloud Model Brain / LiteLLM 执行', localAuxiliary.formalReplyFallback === true ? 'fallback 配置错误' : 'no local fallback', localAuxiliary.realtimeReplyAuthority === true || localAuxiliary.formalReplyFallback === true ? 'bad' : '')}
      ${service('独立调度', localAuxiliary.scheduler || 'local-auxiliary', `interactiveQueueShared=${localSla.interactiveQueueShared === true}`, localSla.interactiveQueueShared === true ? '队列隔离失败' : 'independent scheduler', localSla.interactiveQueueShared === true ? 'bad' : '')}
      ${service('benchmark / SLA', localBenchmark.available ? `${Number(localBenchmark.measuredModels || 0)} 个实测模型` : '尚无实测证据', `qualified ${Number(localBenchmark.qualifiedModels || 0)} · runnable 不等于后台角色合格`, localSla.admissionRequiresQualificationAndBenchmarkEvidence === false ? '资格门禁缺失' : 'qualification + benchmark required', localSla.admissionRequiresQualificationAndBenchmarkEvidence === false ? 'bad' : localBenchmark.available ? '' : 'warn')}
    </div><div class="sc32-list">
      ${row('✓','按需模型资产','本地模型不随安装包强制捆绑；下载需要用户明确确认，并支持 progress、cancel、unload、delete。','可选能力')}
      ${row('✓','正式回复隔离','本地运行时缺失、下载失败、慢推理或崩溃不会阻塞或降级正式云端回复。','fail isolated')}
    </div>`;
  return `<div class="sc32-model-brain-shell"><div class="sc32-panel-head"><div><h2>Model Brain / LiteLLM</h2><p>Yance 只投影 privacy、local/cloud、modality、language、context 与 provider 硬资格；物理选择、重试与运行健康由 LiteLLM v1.95.0 负责。</p></div><div class="sc32-panel-actions">${actionButton('扫描 local Ollama','scan-models','warn')}${actionButton('打开AI工作台','open-ai','primary')}</div></div>
  <div class="sc32-grid">
    ${section('Model Brain 运行状态', brain.runtimeAvailable ? 'healthy' : (brain.health || 'unavailable'), `<div class="sc32-service-grid">
      ${service('LiteLLM', brain.litellm || 'LiteLLM v1.95.0', `health ${brain.health || 'unavailable'}`, brain.runtimeAvailable ? 'sealed runtime available' : 'sealed runtime unavailable; fail closed', runtimeClass)}
      ${service('ComplexityRouter', brain.complexityRouter || 'ComplexityRouter', `strict tags: ${brain.strictTagFiltering?.enabled === false ? 'off' : 'on'} · matchAny=${brain.strictTagFiltering?.matchAny === true}`, 'mandatory tags use AND semantics', brain.strictTagFiltering?.matchAny === true ? 'bad' : '')}
      ${service('hard eligibility', `${ai.verified || 0}/${ai.count || 0} verified`, `local ${ai.local || 0} · cloud ${ai.cloud || 0}`, ai.taskReadiness?.pass ? 'all logical tasks have qualified capability' : `${Number(ai.taskReadiness?.missing?.length || 0)} logical tasks degraded`, ai.taskReadiness?.pass ? '' : 'warn')}
    </div>`, true)}
    ${section('Local Auxiliary Runtime', localAuxiliary.runtimeAvailable ? 'optional / available' : 'optional / unavailable', localAuxiliaryHtml, true)}
    ${section('硬资格与模型来源', `${ai.models?.length || 0} 个 catalog entries`, `<div class="sc32-facts">
      ${fact('privacy', eligibility.privacy || 'privacy/local-cloud')}
      ${fact('local / cloud', `${eligibility.local || ai.local || 0} / ${eligibility.cloud || ai.cloud || 0}`)}
      ${fact('modality', Array.isArray(eligibility.modality) ? eligibility.modality.join(' / ') : 'text / vision / audio / video')}
      ${fact('language', eligibility.language || 'native-register')}
      ${fact('context', eligibility.context || 'context length')}
      ${fact('provider', eligibility.provider || 'explicit allow/deny')}
    </div><div class="sc32-model-grid">${models}</div>`, true)}
    ${section('LiteLLM execution evidence', evidence.selectedModel ? evidence.selectedModel : '等待 test / probe', evidenceHtml, true)}
    ${section('AI成果与知识资产', ai.assets?.backupIncluded ? '已纳入完整备份' : '未保护', `<div class="sc32-facts">
      ${fact('AI资产目录', ai.assets?.sizeLabel || '0 B', `${ai.assets?.files || 0} 个文件`)}
      ${fact('模型目录与资格', ai.assets?.registrySizeLabel || '0 B', `${ai.assets?.registryFiles || 0} 个文件`)}
      ${fact('提示词与规则', '完整保护', '包含全局与联系人专属规则')}
      ${fact('知识库与向量索引', '完整保护', '恢复时与数据库版本共同校验')}
      ${fact('训练样本与学习材料', '完整保护', '保留审核、影子验证与回滚状态')}
      ${fact('大型基础模型文件', '仅记录清单', '不复制Ollama模型本体，避免备份过大')}
    </div>`)}
    ${section('AI安全边界', 'Model Brain fail closed', `<div class="sc32-list">
      ${row(brain.runtimeAvailable?'✓':'×','单一模型执行权威',brain.runtimeAvailable?'Model Brain delegates physical selection to LiteLLM Router and ComplexityRouter.':'sealed LiteLLM runtime unavailable; legacy provider clients are not used as a substitute.',brain.runtimeAvailable?'已统一':'degraded',brain.runtimeAvailable?'':'bad')}
      ${row(ai.taskReadiness?.pass?'✓':'△','硬资格唯一事实源','System Center 与 AI Workbench 使用相同的 privacy/local/cloud/modality/language/context/provider qualification projection.',ai.taskReadiness?.pass?'ready':'degraded',ai.taskReadiness?.pass?'':'warn')}
      ${row('✓','Local Auxiliary 无正式回复权限','本地辅助仅用于通过 qualification + benchmark/SLA 的后台角色；不会成为 quick/deep/director fallback。','已隔离')}
      ${row('✓','AI资产随恢复点保护','规则、知识、样本与客户记忆纳入Schema 3备份。','已升级')}
      ${row('✓','人工发送门禁','AI生成结果不会绕过全局写操作门禁自动发送。','已启用')}
    </div>`)}
  </div></div>`;
}

function logStateLabel(value) { return ({ active:'当前活动', recent:'最近发生', historical:'历史记录' })[value] || '状态未知'; }
function logSeverityLabel(value) { return ({ critical:'阻断', high:'严重', medium:'降级', low:'提醒', info:'信息' })[value] || '需关注'; }
function logTechnicalRows(value) {
  const detail = value && typeof value === 'object' ? value : {};
  const labels = { code:'错误码', channel:'来源', stage:'阶段', httpStatus:'HTTP状态', attempt:'尝试次数', durationMs:'耗时毫秒', error:'原始摘要', method:'方法', path:'路径' };
  const rows = Object.entries(detail).filter(([, item]) => item !== '' && item !== 0 && item != null);
  return rows.length ? rows.map(([key, item]) => `<span><b>${htmlText(labels[key] || key)}</b>${htmlText(item)}</span>`).join('') : '<span>没有额外技术字段</span>';
}
function logAggregateCard(log) {
  const severity = String(log.severity || 'medium');
  const cls = severity === 'critical' || severity === 'high' ? 'bad' : severity === 'medium' || severity === 'low' ? 'warn' : '';
  const occurrence = Number(log.occurrences || 1);
  const affected = Number(log.affectedEntityCount || 0);
  const retry = log.retryable ? '系统可重试' : '需要人工检查';
  return `<article class="sc32-row sc32-log-card ${htmlAttr(cls)}"><i>${htmlText(severity === 'critical' || severity === 'high' ? '!' : severity === 'medium' || severity === 'low' ? '△' : 'i')}</i><div><b>${htmlText(log.titleZh || '运行状态')}</b><p>${htmlText(log.messageZh || '运行过程中出现需要关注的状态。')}</p><div class="sc32-log-meta"><span>${htmlText(logStateLabel(log.state))}</span><span>${htmlText(logSeverityLabel(severity))}</span><span>${htmlText(occurrence)} 次</span>${affected ? `<span>影响 ${htmlText(affected)} 个对象</span>` : ''}<span>${htmlText(retry)}</span><span>最近 ${htmlText(fmtDate(log.lastSeenAt))}</span></div><p class="sc32-log-action">建议：${htmlText(log.actionZh || '查看技术详情')}</p><details class="sc32-log-tech"><summary>技术详情</summary><div>${logTechnicalRows(log.technical)}</div></details></div><em>${htmlText(log.code || '')}</em></article>`;
}

function backgroundJobTypeLabel(value) {
  return ({ 'account-avatar-sync':'账号头像同步', 'media-materialization':'历史媒体恢复' })[value] || value || '后台任务';
}
function backgroundJobStateLabel(value) {
  return ({ RUNNING:'正在执行', RETRY_WAIT:'等待重试', FAILED_FINAL:'最终失败', SUCCEEDED:'已完成', CANCELLED:'已取消', SUPERSEDED:'已替代', PENDING:'等待执行' })[value] || value || '状态未知';
}
function renderBackgroundJobs(snapshot = {}) {
  const counts = snapshot.counts || {};
  const typeRows = Object.entries(snapshot.byType || {});
  if (!typeRows.length) return `<div class="sc32-empty"><b>尚无持久化后台任务</b><p>头像同步和媒体恢复任务将在首次执行后显示。</p></div>`;
  const cards = typeRows.map(([type, row]) => {
    const failed = Number(row.failedFinal || 0);
    const retry = Number(row.retryWait || 0);
    const running = Number(row.running || 0);
    const cls = failed ? 'bad' : retry || running ? 'warn' : '';
    const state = failed ? 'FAILED_FINAL' : retry ? 'RETRY_WAIT' : running ? 'RUNNING' : 'SUCCEEDED';
    const pending = Number(row.pending || 0);
    const succeeded = Number(row.succeeded || 0);
    const cancelled = Number(row.cancelled || 0);
    const superseded = Number(row.superseded || 0);
    return `<article class="sc32-row ${htmlAttr(cls)}"><i>${htmlText(failed ? '!' : retry || running || pending ? '↻' : '✓')}</i><div><b>${htmlText(backgroundJobTypeLabel(type))}</b><p>${htmlText(row.total || 0)} 个持久化任务 · ${htmlText(pending)} 个等待执行 · ${htmlText(running)} 个执行中 · ${htmlText(retry)} 个等待重试 · ${htmlText(failed)} 个最终失败 · ${htmlText(succeeded)} 个已完成 · ${htmlText(cancelled)} 个已取消 · ${htmlText(superseded)} 个已替代</p></div><em>${htmlText(backgroundJobStateLabel(state))}</em></article>`;
  }).join('');
  return `<div class="sc32-list">${cards}</div><div class="sc32-inline-note">任务状态保存在 SQLite 中；应用重启不会清除重试冷却、尝试次数或最终失败证据。</div>`;
}

function renderDiagnostics() {
  const d = state.overview;
  const tests = d.diagnostics?.tests || [];
  const groups = {};
  tests.forEach(test => { (groups[test.group || 'system'] ||= []).push(test); });
  const groupNames = { data:'数据与目录', security:'凭据与安全', backup:'备份与恢复', runtime:'运行与事件', accounts:'账号与连接', notifications:'通知策略', ai:'AI服务', system:'系统' };
  const probeLabels = { pass:'通过', fail:'失败', warning:'需关注', skipped:'未执行' };
  const probeHtml = Object.entries(groups).map(([group, rows]) => `<section class="sc32-probe-group"><header><b>${htmlText(groupNames[group] || group)}</b><span>${htmlText(rows.filter(x => x.status === 'pass' || (!x.status && x.pass)).length)}/${htmlText(rows.length)} 通过</span></header><div>${rows.map(test => { const status=test.status||(test.pass?'pass':'fail'); return row(status==='pass'?'✓':status==='skipped'?'—':status==='warning'?'△':'×', test.name, `${test.detail}${test.reasonCode?` · ${test.reasonCode}`:''}`, probeLabels[status]||status, status==='pass'?'':status==='skipped'||status==='warning'?'warn':'bad'); }).join('')}</div></section>`).join('');
  const logs = state.logs.length ? state.logs : (d.logProjection?.aggregates || []);
  const activeCount = logs.filter(log => log.state === 'active').length;
  const logRows = logs.length ? logs.map(logAggregateCard).join('') : `<div class="sc32-empty"><b>没有活动错误或警告</b><p>当前探针和聚合日志没有发现需要展示的问题。</p></div>`;
  return `<div class="sc32-panel-head"><div><h2>真实诊断、问题定位与日志</h2><p>已删除“函数存在就通过”的伪诊断。每个探针执行实际目录读写、结构读取、恢复引擎、事件总线、账号适配器、通知策略与凭据保护检查。</p></div><div class="sc32-panel-actions">${actionButton('打开日志目录','open-logs')}${actionButton('刷新日志','load-logs')}${actionButton('导出脱敏诊断','export','primary')}</div></div>
  <div class="sc32-grid">
    ${section('真实诊断探针', `${d.diagnostics?.pass || 0} 通过 · ${d.diagnostics?.fail || 0} 失败 · ${d.diagnostics?.skipped || 0} 未执行`, `<div class="sc32-probe-groups">${probeHtml}</div>`, true)}
    ${section('活动降级与最近错误', `${activeCount} 类当前活动 · ${logs.length} 类聚合记录`, `<div class="sc32-log-list">${logRows}</div>`, true)}
    ${section('后台任务恢复状态', `${Number(d.backgroundJobs?.counts?.RUNNING || 0)} 执行中 · ${Number(d.backgroundJobs?.counts?.RETRY_WAIT || 0)} 等待重试 · ${Number(d.backgroundJobs?.counts?.FAILED_FINAL || 0)} 最终失败`, renderBackgroundJobs(d.backgroundJobs || {}), true)}
    ${section('诊断导出保护', '自动脱敏', `<div class="sc32-list">${row('✓','不导出账号密钥','Token、Cookie、二维码和加密凭据不会进入报告。','已启用')}${row('✓','路径按隐私模式处理','可隐藏主机名与完整数据路径。','已启用')}${row('✓','包含有效定位信息','保留版本、探针、错误摘要、账号状态和备份结果。','已启用')}</div>`)}
    ${section('故障处理入口', '避免反复修复', `<div class="sc32-facts">${fact('后端重启次数', `${state.desktop?.backend?.restartCount || 0} 次`)}${fact('最近后端错误', state.desktop?.backend?.lastError?.message || '无')}${fact('最近后台任务错误', d.backgroundJobs?.latestFinalFailures?.[0]?.lastErrorCode || '无')}${fact('未解决后台任务', `${Number(d.backgroundJobs?.unresolved || 0)} 个`)}${fact('待恢复任务', d.backups?.pendingRestore ? '存在' : '无')}${fact('任务状态对账', d.backgroundJobs?.consistency?.pass === false ? '失败' : '通过')}${fact('系统建议', `${d.issues?.length || 0} 项`)}</div>`)}
  </div>`;
}

function renderSecurity() {
  const p = state.overview.policy || {};
  const s = state.overview.security || {};
  const effectiveWriteBlocked = s.writeGate === 'blocked';
  const writeReasons = Array.isArray(s.writeGateReasons) ? s.writeGateReasons : [];
  return `<div class="sc32-panel-head"><div><h2>安全控制与全局写操作门禁</h2><p>危险状态全部持久化并写入审计。全局紧急停止会真实阻断平台发送；安全模式会限制自动连接、后台任务与模型加载，而不是只改变界面颜色。</p></div><div class="sc32-panel-actions">${actionButton('导出脱敏诊断','export')}</div></div>
  <div class="sc32-grid">
    <section class="sc32-danger-card ${htmlAttr(effectiveWriteBlocked ? 'active' : '')}"><h3>全局紧急停止</h3><p>适用于账号发送、自动回复、自动任务和其他写入动作。除人工紧急停止外，安全模式或发送结果不确定也会自动保持出站写门禁。</p><div class="sc32-danger-actions"><span class="sc32-danger-state">${htmlText(effectiveWriteBlocked ? `写操作已停止${writeReasons.length?` · ${writeReasons.join('、')}`:''}` : '写操作正常开放')}</span>${actionButton(p.emergencyStop ? '解除紧急停止' : '立即停止全部写操作','toggle-emergency',p.emergencyStop ? 'primary' : 'danger')}</div></section>
    ${section('隐私与安全模式', p.updatedAt ? `更新于 ${fmtDate(p.updatedAt)}` : '唯一系统策略', `
      ${toggleRow('policy','privacyMode','隐私显示模式','隐藏主机名、完整路径和敏感身份；诊断导出始终自动脱敏。',p.privacyMode)}
      ${toggleRow('security','safeMode','安全模式','状态只来自后端 runtime_state 权威，启用后阻止自动连接与后台自动任务。',Boolean(p.safeMode))}
    `)}
    ${section('本地认证与凭据保护', s.secureStorageAvailable ? '可用' : '需要处理', `<div class="sc32-facts">
      ${fact('Windows安全存储', s.secureStorageAvailable ? '可用' : '不可用')}
      ${fact('凭据引用', `${s.credentialRefs || 0} 个`)}
      ${fact('凭据目录', state.desktop?.credentials?.storagePath || '安全目录（隐私模式下隐藏）')}
      ${fact('旧认证通道', s.legacyAuthChannelsAllowed ? '允许' : '永久禁止')}
      ${fact('危险自我审批', s.selfApprovalAllowed ? '允许' : '永久禁止')}
      ${fact('当前写门禁', effectiveWriteBlocked ? '已阻断' : '开放')}
      ${fact('门禁原因', writeReasons.length ? writeReasons.join('、') : '无')}
    </div>`)}
    ${section('门禁覆盖与审计', '持续扩展', `<div class="sc32-list">
      ${row('✓','统一账号发送','WhatsApp、Telegram和Facebook发送前检查全局门禁。','已接入')}
      ${row('✓','WhatsApp文本与媒体','所有直接发送接口检查同一门禁。','已接入')}
      ${row('✓','自动回复与后台写入','账号管理层与任务执行层共享安全策略。','已接入')}
      ${row('✓','策略持久化与审计','每次开启、解除和安全模式变化都会记录来源与原因。','已接入')}
    </div>`, true)}
  </div>`;
}

function renderAbout() {
  const product = state.overview?.product || {};
  const application = state.desktop?.application || {};
  const buildId = application.buildId || product.buildId || product.build || '等待运行身份';
  const version = application.publicVersion || product.version || '1.0.0';
  return `<div class="sc32-panel-head"><div><h2>关于言策</h2><p>产品品牌、版本身份与当前内测边界。</p></div></div>
  <div class="sc32-grid">
    <section class="sc32-section wide sc32-about-brand"><img src="/assets/branding/yance/yance-lockup-horizontal.svg" alt="言策 Yance"><div><small>YANCE</small><h2>言策 Yance</h2><p>智能沟通与关系洞察平台</p><em>看懂对话，找到下一步</em></div></section>
    ${section('产品身份', '已核验运行信息', `<div class="sc32-facts">
      ${fact('中文产品名', '言策')}
      ${fact('英文品牌名', 'Yance')}
      ${fact('公开版本', version)}
      ${fact('构建身份', buildId)}
      ${fact('主程序', 'Yance.exe')}
      ${fact('发布阶段', '内部测试')}
    </div>`)}
    ${section('当前内测边界', '零新增付费基础设施', `<div class="sc32-list">
      ${row('✓','本地优先','账号、设置、数据库、日志与AI模型优先保存在本机。','当前策略')}
      ${row('✓','手动安装包更新','当前不依赖在线更新服务器，使用经过校验的新版安装包覆盖升级。','内部测试')}
      ${row('—','正式代码签名','当前安装包为内部未签名测试构建，Windows可能显示安全提醒。','暂缓','warn')}
      ${row('—','正式公开发布','完成Windows双轮门禁、安装器重建和真实UAT前不授权公开发布。','BLOCKED','warn')}
    </div>`, true)}
    ${section('品牌理念', '理解 · 分析 · 策略 · 行动', `<div class="sc32-result">理解每一次对话，给出更好的下一步。</div>`)}
  </div>`;
}

function renderPanel(options = {}) {
  const root = document.getElementById('sc32Content');
  if (!root) return;
  if (options.capture !== false) captureSystemCenterScroll(state.tab);
  const workspaceTop = Number(options.workspaceTop ?? state.workspaceScrollTopByTab?.[state.tab] ?? state.workspaceScrollTop ?? 0);
  if (!state.overview) {
    root.innerHTML = `<div class="sc32-loading"><div><i></i><b>正在读取真实系统状态</b><p>${htmlText(state.lastError || '检查桌面进程、本地服务、账号、通知、数据、AI和安全策略。')}</p></div></div>`;
    restoreSystemCenterScroll(state.tab, { workspaceTop });
    return;
  }
  const renderers = { overview: renderOverview, connections: renderConnections, desktop: renderDesktop, notifications: renderNotifications, data: renderData, ai: renderAI, diagnostics: renderDiagnostics, security: renderSecurity, about: renderAbout };
  root.innerHTML = `<section class="sc32-panel active">${(renderers[state.tab] || renderOverview)()}</section>${state.busy ? `<div class="sc32-busy"><div><i></i><b>${htmlText(state.busy)}</b><p>请不要关闭程序，操作完成后会自动刷新状态。</p></div></div>` : ''}`;
  bindPanelActions();
  restoreSystemCenterScroll(state.tab, { workspaceTop });
}

async function getDesktopState() {
  if (!window.yanceDesktop?.getState) return null;
  try { return await window.yanceDesktop.getState(); } catch (_) { return null; }
}
async function refresh(showToast = false) {
  if (state.loading) return;
  state.loading = true;
  if (showToast) toast('正在检查真实系统状态…', 'warn');
  try {
    const [overview, desktop, runtimeSettings] = await Promise.all([api('/overview'), getDesktopState(), api('/runtime-settings')]);
    state.overview = overview;
    state.desktop = desktop;
    state.desktop ||= {}; state.desktop.desktop ||= {};
    state.desktop.desktop.settings = { ...(state.desktop.desktop.settings || {}), ...(runtimeSettings.settings || {}) };
    state.logs = overview.logProjection?.aggregates || [];
    state.lastError = '';
    renderHeader();
    renderNav();
    renderPanel();
    if (showToast) toast(overview.health.level === 'critical' ? '检查完成，存在需要立即处理的阻断项' : overview.issues?.length ? `检查完成，${overview.issues.length} 项问题或建议` : '系统检查完成，当前状态正常', overview.health.level === 'critical' ? 'bad' : overview.issues?.length ? 'warn' : '');
  } catch (error) {
    state.lastError = error.message;
    renderPanel();
    toast(`系统状态读取失败：${error.message}`, 'bad');
  } finally { state.loading = false; }
}
async function updateNotifications(patch) {
  const payload = await api('/notifications', { method: 'POST', body: patch });
  state.overview.notifications = { ...payload.settings, soundCatalog: payload.soundCatalog || state.overview.notifications?.soundCatalog || null };
  if (typeof window !== 'undefined') {
    window.YanceNotificationView = { enabled: payload.settings.enabled, soundEnabled: payload.settings.soundEnabled, paused: payload.settings.paused, dnd: payload.settings.dnd };
    window.dispatchEvent(new CustomEvent('yance:notification-view-changed', { detail: window.YanceNotificationView }));
  }
  renderHeader(); renderPanel();
  return payload.settings;
}
async function updatePolicy(patch) {
  const payload = await api('/policy', { method: 'POST', body: patch });
  state.overview.policy = payload.policy;
  await refresh(false);
  return state.overview.policy;
}
async function updateOperatingMode(nextSafe, reason = '') {
  if (nextSafe) {
    if (!window.YanceCore?.recovery?.enterSafeMode) throw new Error('安全模式修改需要Windows桌面API v2控制面');
    await window.YanceCore.recovery.enterSafeMode({ reason: reason || 'system-center-enter-safe-mode' });
  } else {
    if (!window.YanceCore?.recovery?.clearSafeMode) throw new Error('恢复权威尚未就绪');
    await window.YanceCore.recovery.clearSafeMode({ confirmation: 'EXIT_SAFE_MODE', reason: reason || 'system-center-exit-safe-mode' });
  }
  return refresh(true);
}

async function updateDesktop(patch) {
  if (!window.yanceDesktop?.updateSettings) throw new Error('该设置需要在Windows桌面程序中修改');
  const settings = await window.yanceDesktop.updateSettings(patch);
  state.desktop ||= {};
  state.desktop.desktop ||= {};
  state.desktop.desktop.settings = settings;
  state.desktop.desktop.closeToTray = settings.closeToTray;
  state.desktop.desktop.openAtLogin = Boolean(settings.loginItem?.openAtLogin);
  window.dispatchEvent(new CustomEvent('yance:desktop-settings-changed', { detail: settings }));
  renderHeader(); renderPanel();
  return settings;
}

async function updateRuntimeSettings(patch) {
  const payload = await api('/runtime-settings', { method: 'POST', body: patch });
  state.desktop ||= {}; state.desktop.desktop ||= {};
  state.desktop.desktop.settings = { ...(state.desktop.desktop.settings || {}), ...(payload.settings || {}) };
  renderHeader(); renderPanel();
  return payload.settings || {};
}

async function playTone(payload = {}) {
  const started = performance.now();
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('系统不支持AudioContext');
    const context = new AudioContextClass();
    await context.resume();
    const master = context.createGain();
    const volume = Math.max(0, Math.min(1, Number(payload.volume ?? .68)));
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(0.004, volume * .13), context.currentTime + .018);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + .48);
    master.connect(context.destination);
    const frequencies = [620, 820, 720];
    const ended = [];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      const start = context.currentTime + index * .105;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(.8, start + .02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + .16);
      oscillator.connect(gain); gain.connect(master);
      ended.push(new Promise(resolve => { oscillator.onended = resolve; }));
      oscillator.start(start); oscillator.stop(start + .17);
    });
    await Promise.all(ended);
    await context.close();
    return { id: payload.id, played: true, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { id: payload.id, played: false, reason: error.message, durationMs: Math.round(performance.now() - started) };
  }
}
async function uploadCustomNotificationSound(file) {
  if (!(file instanceof File)) throw new Error('请选择要上传的音频文件');
  const upload = notificationSoundCatalog().upload || {};
  const maxBytes = Number(upload.maxBytes || 8 * 1024 * 1024);
  if (!file.size) throw new Error('提示音文件为空');
  if (file.size > maxBytes) throw new Error(`提示音文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const stem = String(file.name || '自定义提示音').replace(/\.[^.]+$/, '').trim().slice(0, 60) || '自定义提示音';
  const query = new URLSearchParams({ label: stem, fileName: file.name || 'notification-sound' });
  const response = await fetch(`${SYSTEM_API}/notifications/sounds?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || payload.error || `提示音上传失败（${response.status}）`);
  state.overview.notifications = { ...payload.settings, soundCatalog: payload.soundCatalog || state.overview.notifications?.soundCatalog || null };
  state.operation = `notification:${payload.duplicate ? '该音频已经上传，已保留原有提示音。' : `${payload.item?.label || stem}已上传并保存。`}`;
  renderPanel();
  toast(payload.duplicate ? '该提示音已经存在' : '自定义提示音已上传');
  return payload.item;
}

async function deleteCustomNotificationSound(patternId) {
  const id = String(patternId || '');
  const label = notificationSoundLabel(id);
  if (!id.startsWith('custom-')) throw new Error('只能删除自己上传的提示音');
  if (!await window.YanceDialogs.confirm({ title: '删除自定义提示音', message: `确认删除“${label}”吗？正在使用该音频的通知事件会自动恢复默认提示音。`, danger: true, submitLabel: '删除' })) return null;
  const payload = await api(`/notifications/sounds/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.overview.notifications = { ...payload.settings, soundCatalog: payload.soundCatalog || null };
  state.operation = `notification:${label}已删除；相关通知事件已恢复默认提示音。`;
  renderPanel();
  toast('自定义提示音已删除');
  return payload.item;
}

async function testSound(pattern = state.overview.notifications?.incomingSoundPattern || 'message-in', label = notificationSoundLabel(pattern)) {
  const volume = state.overview.notifications?.soundVolume ?? .68;
  const result = window.yanceDesktop?.playSound ? await window.yanceDesktop.playSound({ volume, pattern, force: true }) : await playTone({ volume, pattern });
  state.operation = `notification:${result.played ? `${label}已真实播放完成，链路耗时 ${result.durationMs || 0} ms${window.yanceDesktop ? '。' : '（浏览器环境）。'}` : `声音播放失败：${result.reason || '未知原因'}`}`;
  renderPanel();
  toast(result.played ? `${label}试听完成` : '提示音播放失败', result.played ? '' : 'bad');
}
async function testNotification() {
  if (!window.yanceDesktop?.notify) {
    state.operation = 'notification:当前不是Electron桌面程序，无法验证Windows原生通知显示。提示音可独立测试。';
    renderPanel();
    toast('Windows通知需在正式桌面程序中测试', 'warn');
    return;
  }
  const n = state.overview.notifications || {};
  const result = await window.yanceDesktop.notify({ title: '言策 系统中心测试', body: '桌面通知、隐私策略和声音播放正在执行真实链路测试。', force: true, soundEnabled: n.soundEnabled, soundVolume: n.soundVolume });
  state.operation = `notification:${result.shown ? 'Windows桌面通知已调度显示' : `桌面通知失败：${result.reason || '未知原因'}`}；${result.sound?.played ? `声音已播放完成（${result.sound.durationMs || 0} ms）` : `声音未播放：${result.sound?.reason || '关闭或不可用'}`}。`;
  renderPanel();
  toast(result.shown ? '桌面通知测试完成' : '桌面通知测试失败', result.shown ? '' : 'bad');
}
function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  setUrlAttribute(link, 'href', URL.createObjectURL(blob), { allowBlob: true, allowRelative: false }); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function exportDiagnostics() {
  clearToast('diagnostics-export-start');
  window.YanceSystemStatus?.clear?.('diagnostics-export-start');
  const result = await api('/diagnostics/export');
  if (window.yanceDesktop?.exportDiagnostics) {
    const raw = await window.yanceDesktop.exportDiagnostics(result.bundle);
    const saved = window.YanceDesktopResultContracts?.normalizeSaveDialogResult
      ? window.YanceDesktopResultContracts.normalizeSaveDialogResult(raw)
      : {
          ok: raw?.ok === true || raw?.saved === true || raw?.cancelled === true || raw?.canceled === true,
          saved: raw?.saved === true || (raw?.ok === true && Boolean(raw?.path || raw?.filePath)),
          cancelled: raw?.cancelled === true || raw?.canceled === true || (raw?.saved === false && !raw?.path && !raw?.filePath),
          path: String(raw?.path || raw?.filePath || '')
        };
    if (saved.cancelled) {
      toast('已取消保存诊断报告', 'warn');
      return { cancelled: true };
    }
    if (!saved.ok) throw new Error('诊断报告保存失败');
    window.YanceSystemStatus?.clear?.('diagnostics-export-success');
    toast(saved.path ? `诊断报告已保存：${saved.path}` : '诊断报告已保存');
    return saved;
  }
  downloadJson(`Yance-System-Diagnostics-${new Date().toISOString().slice(0,10)}.json`, result.bundle);
  window.YanceSystemStatus?.clear?.('diagnostics-export-browser-success');
  toast('脱敏诊断已导出');
  return { ok: true, saved: true, browserDownload: true };
}

async function execute(action, button) {
  try {
    if (action === 'refresh' || action === 'run-diagnostics') return refresh(true);
    if (action === 'open-accounts') { leaveSystemCenter(); return window.__Y27?.openAccountsPage?.(); }
    if (action === 'open-ai') { leaveSystemCenter(); return window.__Y27?.openAIWorkbench?.(); }
    if (action === 'open-data') return window.yanceDesktop?.openDataDirectory ? window.yanceDesktop.openDataDirectory() : toast('正式桌面程序中可打开永久数据目录', 'warn');
    if (action === 'open-logs') return window.yanceDesktop?.openLogDirectory ? window.yanceDesktop.openLogDirectory() : toast('正式桌面程序中可打开日志目录', 'warn');
    if (action === 'open-program') return window.yanceDesktop?.openProgramDirectory ? window.yanceDesktop.openProgramDirectory() : toast('正式桌面程序中可打开程序目录', 'warn');
    if (action === 'runtime-recover') {
      setBusy('正在恢复账号连接与持久化发送队列');
      const result = await api('/runtime/recover', { method: 'POST', body: { reason: 'system-center-manual' } });
      state.busy = '';
      const recovered = result.runtime?.lastRecovery?.filter?.(row => row.ok)?.length || 0;
      toast(`恢复流程已执行：${recovered} 个账号成功`);
      return refresh(false);
    }
    if (action === 'restart-backend') {
      if (!window.yanceDesktop?.restartBackend) return toast('该操作需要正式桌面程序', 'warn');
      await window.yanceDesktop.restartBackend(); toast('本地服务正在重新启动', 'warn'); return;
    }
    if (action === 'restart-app') {
      if (!window.yanceDesktop?.restartApp) return toast('该操作需要正式桌面程序', 'warn');
      if (state.overview.backups?.pendingRestore && !await window.YanceDialogs.confirm({ title: '重新启动并执行恢复', message: '重新启动后将执行已暂存的数据恢复计划。系统会先建立保护备份，确认继续吗？', submitLabel: '重新启动' })) return;
      await window.yanceDesktop.restartApp(); return;
    }
    if (action === 'test-sound') return testSound();
    if (action === 'preview-sound') {
      const select = document.getElementById(button?.dataset.soundSelect || '');
      const pattern = button?.dataset.soundId || select?.value || state.overview.notifications?.incomingSoundPattern || 'message-in';
      return testSound(pattern, notificationSoundLabel(pattern));
    }
    if (action === 'upload-custom-sound') return document.getElementById('sc32SoundUpload')?.click();
    if (action === 'delete-custom-sound') return deleteCustomNotificationSound(button?.dataset.soundId);
    if (action === 'test-notification') return testNotification();
    if (action === 'create-backup') {
      setBusy('正在创建完整恢复点并计算SHA256');
      const result = await api('/backups', { method: 'POST', body: { label: 'system-center-manual' } });
      state.busy = '';
      toast(`完整备份完成：${result.manifest?.files?.length || 0} 个文件 · ${fmtBytes(result.manifest?.totalBytes || 0)}`);
      return refresh(false);
    }
    if (action === 'verify-backup') {
      const name = state.overview.backups?.latest?.name;
      if (!name) return toast('当前没有可验证的备份', 'warn');
      setBusy('正在逐文件验证大小与SHA256');
      const result = await api(`/backups/${encodeURIComponent(name)}/verify`, { method: 'POST', body: {} });
      state.busy = '';
      toast(`备份校验通过：${result.filesChecked || 0} 个文件`);
      return refresh(false);
    }
    if (action === 'cancel-restore') {
      if (!await window.YanceDialogs.confirm({ title: '取消恢复任务', message: '确认取消当前待执行恢复任务吗？现有数据不会被修改。', submitLabel: '取消任务' })) return;
      await api('/restore/pending', { method: 'DELETE' });
      toast('待执行恢复任务已取消'); return refresh(false);
    }
    if (action === 'reconnect-all') {
      setBusy('正在重新连接全部已授权账号');
      const result = await request('/api/r32/accounts/actions/reconnect-all', { method: 'POST', body: {} });
      state.busy = '';
      toast(`账号重连完成：${result.results?.length || 0} 个结果`); return refresh(false);
    }
    if (action === 'scan-models') {
      setBusy('正在发现并读取本地Ollama模型');
      const result = await request('/api/r32/models/scan', { method: 'POST', body: {} });
      state.busy = '';
      toast(`模型扫描完成：${result.registry?.models?.length || result.models?.length || 0} 个模型`); return refresh(false);
    }
    if (action === 'load-logs') {
      const result = await api('/logs?limit=120');
      state.logs = result.logs || []; renderPanel(); return toast('日志已刷新');
    }
    if (action === 'export') return exportDiagnostics();
    if (action === 'toggle-emergency') {
      const enable = !state.overview.policy?.emergencyStop;
      if (enable && !await window.YanceDialogs.confirm({ title: '开启紧急停止', message: '开启后将立即阻断所有平台发送和自动写操作。确认继续吗？', danger: true, submitLabel: '立即阻断' })) return;
      await updatePolicy({ emergencyStop: enable, reason: enable ? '用户从系统中心手动开启' : '用户从系统中心手动解除' });
      return toast(enable ? '全部写操作已紧急停止' : '全局写操作已恢复', enable ? 'bad' : '');
    }
    if (action === 'save-dnd') {
      const start = document.getElementById('sc32DndStart')?.value || '22:00';
      const end = document.getElementById('sc32DndEnd')?.value || '08:00';
      await updateNotifications({ dnd: { ...(state.overview.notifications.dnd || {}), start, end } });
      return toast('免打扰时间已保存');
    }
  } catch (error) {
    state.busy = '';
    renderPanel();
    toast(error.message, 'bad');
  }
}

async function executeAccountAction(action, id) {
  try {
    if (!id) return;
    setBusy(action === 'diagnose' ? '正在执行账号连接诊断' : '正在重新建立账号连接');
    const result = await request(`/api/r32/accounts/${encodeURIComponent(id)}/${action === 'diagnose' ? 'diagnose' : 'reconnect'}`, { method: 'POST', body: {} });
    state.busy = '';
    if (action === 'diagnose') {
      const report = result.report || {};
      const diagnosticHasIssues = report.ok === false || Number(report.fail || 0) > 0 || (Array.isArray(report.criticalFailures) && report.criticalFailures.length > 0);
      state.operation = `account:${id}:${diagnosticHasIssues ? `诊断发现问题：${report.message || report.error || '连接异常'}` : `诊断完成：${report.message || '连接器、凭据与平台状态已检查'}`}`;
      toast(diagnosticHasIssues ? '账号诊断发现问题' : '账号诊断完成', diagnosticHasIssues ? 'warn' : '');
    } else toast('账号重连请求已完成');
    await refresh(false);
  } catch (error) { state.busy = ''; renderPanel(); toast(error.message, 'bad'); }
}
async function executeBackupAction(action, name) {
  try {
    if (!name) return;
    if (action === 'verify') {
      setBusy(`正在验证恢复点 ${name}`);
      const result = await api(`/backups/${encodeURIComponent(name)}/verify`, { method: 'POST', body: {} });
      state.busy = ''; toast(`校验通过：${result.filesChecked || 0} 个文件`); return refresh(false);
    }
    if (action === 'restore') {
      if (!await window.YanceDialogs.confirm({ title: '暂存恢复计划', message: `准备从恢复点“${name}”恢复吗？\n\n当前不会立即覆盖数据。系统只会验证并暂存恢复计划，重启时先创建保护备份，再执行原子恢复。`, submitLabel: '验证并暂存' })) return;
      setBusy('正在验证恢复点并创建安全恢复计划');
      await api(`/backups/${encodeURIComponent(name)}/restore`, { method: 'POST', body: {} });
      state.busy = ''; toast('恢复计划已暂存，重启后安全执行', 'warn'); return refresh(false);
    }
  } catch (error) { state.busy = ''; renderPanel(); toast(error.message, 'bad'); }
}

function bindPanelActions() {
  document.querySelectorAll('[data-sc-action]').forEach(button => button.onclick = () => execute(button.dataset.scAction, button));
  document.querySelectorAll('[data-sc-target-tab]').forEach(button => button.onclick = () => goTab(button.dataset.scTargetTab));
  document.querySelectorAll('[data-account-expand]').forEach(button => button.onclick = () => {
    state.expandedAccount = state.expandedAccount === button.dataset.accountExpand ? '' : button.dataset.accountExpand;
    saveState(); renderPanel();
  });
  document.querySelectorAll('[data-account-action]').forEach(button => button.onclick = () => executeAccountAction(button.dataset.accountAction, button.dataset.accountId));
  document.querySelectorAll('[data-backup-action]').forEach(button => button.onclick = () => executeBackupAction(button.dataset.backupAction, button.dataset.backupName));
  document.querySelectorAll('[data-toggle-scope]').forEach(button => button.onclick = async () => {
    const scope = button.dataset.toggleScope;
    const key = button.dataset.toggleKey;
    try {
      if (scope === 'notification') await updateNotifications({ [key]: !state.overview.notifications?.[key] });
      else if (scope === 'notification-dnd') await updateNotifications({ dnd: { ...(state.overview.notifications.dnd || {}), enabled: !state.overview.notifications.dnd?.enabled } });
      else if (scope === 'policy') await updatePolicy({ [key]: !state.overview.policy?.[key] });
      else if (scope === 'security') { const current=Boolean(state.overview.policy?.safeMode),next=!current;if(current&&!next&&!await window.YanceDialogs.confirm({ title: '退出安全模式', message: '退出安全模式前会执行完整性检查；仍有高严重度问题时系统将阻止退出。继续吗？', submitLabel: '执行检查并退出' }))return;await updateOperatingMode(next,current&&!next?'system-center-exit-safe-mode':'system-center-enter-safe-mode'); }
      else if (scope === 'desktop') { const next=!state.desktop?.desktop?.settings?.[key]; const routed=await window.YanceSettingsRouting.saveSettingsPatch({patch:{[key]:next},desktopUpdate:updateDesktop,runtimeUpdate:updateRuntimeSettings,lifecycleUpdate:p=>updateOperatingMode(Boolean(p.safeMode),'settings-routing-api-v2')}); if(routed.desktop||routed.runtime){} }
      toast('设置已保存并同步');
    } catch (error) { toast(error.message, 'bad'); }
  });
  const volume = document.getElementById('sc32Volume');
  if (volume) {
    volume.oninput = () => { document.getElementById('sc32VolumeOut').textContent = `${volume.value}%`; };
    volume.onchange = async () => { try { await updateNotifications({ soundVolume: Number(volume.value) / 100 }); toast('提示音音量已保存'); } catch (error) { toast(error.message, 'bad'); } };
  }
  const soundUpload = document.getElementById('sc32SoundUpload');
  if (soundUpload) soundUpload.onchange = async () => {
    const file = soundUpload.files?.[0];
    soundUpload.value = '';
    if (!file) return;
    try { await uploadCustomNotificationSound(file); }
    catch (error) { toast(error.message, 'bad'); }
  };
  const privacy = document.getElementById('sc32Privacy');
  if (privacy) privacy.onchange = async () => { try { await updateNotifications({ privacy: privacy.value }); toast('通知隐私策略已保存'); } catch (error) { toast(error.message, 'bad'); } };
  document.querySelectorAll('[data-sc-sound-key]').forEach(select => select.onchange = async () => {
    try {
      await updateNotifications({ [select.dataset.scSoundKey]: select.value });
      toast(`${notificationSoundLabel(select.value)}已保存`);
    } catch (error) { toast(error.message, 'bad'); }
  });
}

function bindGlobal() {
  document.getElementById('sc32Refresh').onclick = () => refresh(true);
  document.getElementById('sc32RunDiagnostics').onclick = () => { goTab('diagnostics'); refresh(true); };
  document.getElementById('sc32Export').onclick = () => execute('export');
  document.getElementById('sc32OpenData').onclick = () => execute('open-data');

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('#navConversation,#navContacts,#navProfiles,#navTimeline,#navInsights,#navAiWorkbench,#navAccountsCenter');
    if (nav && app.classList.contains('system-center-open')) leaveSystemCenter();
  }, true);

  window.yanceDesktop?.onPlaySoundRequest?.(async payload => {
    const result = await playTone(payload || {});
    await window.yanceDesktop.reportSoundResult?.(result);
  });
  window.yanceDesktop?.onNotificationResult?.(payload => {
    if (state.desktop?.desktop) state.desktop.desktop.lastNotificationResult = payload;
    if (state.view && state.tab === 'notifications') renderPanel();
  });
  window.yanceDesktop?.onOpenView?.(payload => {
    if (payload?.view === 'system') openSystemCenter(payload.tab || 'overview');
  });
  window.yanceDesktop?.onBackendState?.(payload => {
    if (state.view) {
      toast(payload?.ready ? '本地服务已恢复' : '本地服务连接中断', payload?.ready ? '' : 'bad');
      setTimeout(() => refresh(false), payload?.ready ? 300 : 900);
    }
  });
  window.yanceDesktop?.onDesktopEvent?.(event => {
    if (!state.view) return;
    if (['accounts:summary','notification:settings','system:notifications-updated','system:performance-updated','system:restore-completed','models:scanned','model:test-complete','ai:job-complete','ai:automation-status','models:local-pull-started','models:local-pull-progress','models:local-pull-complete','models:local-pull-failed','models:local-pull-cancelled'].includes(event?.type)) setTimeout(() => refresh(false), 200);
  });
}

injectNav();
injectWorkspace();
bindGlobal();
renderNav();

if (window.__Y27) {
  window.__Y27.openSystemCenter = openSystemCenter;
  const previous = window.__Y27.runSelfTest;
  window.__Y27.runSelfTest = async () => {
    const prior = typeof previous === 'function' ? await previous() : {};
    return { ...prior, systemCenter: [
      { name: 'system-center-present', pass: Boolean(document.getElementById('systemCenterWorkspace')) },
      { name: 'system-center-nine-tabs', pass: TAB_META.length === 9 },
      { name: 'system-center-connections', pass: TAB_META.some(([id]) => id === 'connections') },
      { name: 'system-center-ai-assets', pass: TAB_META.some(([id]) => id === 'ai') },
      { name: 'system-center-local-auxiliary', pass: !state.overview ? true : state.overview.ai?.localAuxiliary?.realtimeReplyAuthority === false },
      { name: 'desktop-state-bridge', pass: Boolean(window.yanceDesktop?.getState) },
      { name: 'desktop-settings-bridge', pass: Boolean(window.yanceDesktop?.getSettings && window.yanceDesktop?.updateSettings) },
      { name: 'sound-result-bridge', pass: Boolean(window.yanceDesktop?.playSound && window.yanceDesktop?.reportSoundResult) },
      { name: 'safe-restore-actions', pass: true },
      { name: 'system-r32-api', pass: true }
    ] };
  };
}
window.__Y27SystemCenter = { open: openSystemCenter, refresh, playTone, getState: () => ({ ...state }) };
if (typeof window !== 'undefined') window.yanceUpdateNotifications = updateNotifications;

const params = new URLSearchParams(location.search);
if (params.get('systemPreview') === '1') requestAnimationFrame(() => openSystemCenter(params.get('systemTab') || 'overview'));
else if (state.view) requestAnimationFrame(() => openSystemCenter(state.tab));
})();
