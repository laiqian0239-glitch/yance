(() => {
'use strict';

const SIMPLE_ONBOARDING_VERSION = 'stage6.4.5.2';

const app = document.querySelector('.app');
const navMenu = document.getElementById('navMenu');
if (!app || !navMenu || document.getElementById('navAccountsCenter')) return;

const API = '/api/r32/accounts';
const STORAGE_KEY = 'yance27-r32-account-center';
const PLATFORM = {
  whatsapp: { label: 'WhatsApp', icon: 'W', auth: '二维码 / 手机号配对码', accent: 'whatsapp' },
  telegram: { label: 'Telegram', icon: 'T', auth: '二维码优先 / 手机号备用', accent: 'telegram' },
  facebook: { label: 'Facebook', icon: 'f', auth: '公共主页 / 个人身份 / Personal Messenger', accent: 'facebook' }
};

const FACEBOOK_ACCOUNT_TYPES = Object.freeze({
  page: { accountKind: 'page', driverId: 'facebook-page-official', label: 'Facebook 公共主页（官方）' },
  'personal-identity': { accountKind: 'personal-identity', driverId: 'facebook-personal-identity-official', label: 'Facebook 个人身份（官方，仅身份）' },
  'personal-messenger': { accountKind: 'personal-messenger', driverId: 'facebook-personal-messenger-mautrix-meta', label: 'Facebook 个人 Messenger' }
});
function facebookAccountType(value = 'page') {
  const normalized = String(value || '').trim().toLowerCase();
  return FACEBOOK_ACCOUNT_TYPES[normalized] || Object.values(FACEBOOK_ACCOUNT_TYPES).find(row => row.driverId === normalized) || FACEBOOK_ACCOUNT_TYPES.page;
}
function selectedFacebookType() { return facebookAccountType(document.getElementById('ac32FormFacebookKind')?.value || 'page'); }
function driverContract(driverId) { return state.data.driverContracts?.[driverId] || null; }

const CAP_LABELS = {
  text: '文本', image: '图片', video: '视频', gif: 'GIF', animatedSticker: '动态贴纸', voice: '语音', file: '文件',
  quote: '引用回复', reaction: '消息回应', revoke: '消息撤回', readReceipt: '平台已读回执', typingSend: '发送输入状态', incomingTyping: '接收对方输入状态', terminalPresence: '联系人上线/离线提醒', contacts: '联系人同步',
  groups: '群聊', proactiveSend: '主动发送', historySync: '历史同步'
};

const state = Object.assign({
  view: false,
  selectedId: '',
  filter: 'all',
  tab: 'overview',
  search: '',
  scroll: 0,
  scrollByView: {},
  data: { accounts: [], summary: {}, defaults: {}, bindings: {}, audit: [], capabilityMatrix: {} },
  diagnostics: {},
  avatarDiagnostics: {},
  avatarImportSessions: {},
  avatarImportStatusLoading: {},
  loading: false,
  lastError: '',
  socket: null,
  refreshTimer: null,
  awaitingQrAccountId: '',
  qrPollTokens: {},
  migrationPath: '',
  migrationPlan: null,
  facebookFlow: null,
  authPollToken: 0,
  qrChallenges: {},
  authNotices: {}
}, loadLocal());

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; }
}
function saveLocal() {
  const safe = { view: state.view, selectedId: state.selectedId, filter: state.filter, tab: state.tab, search: state.search, scroll: state.scroll, scrollByView: state.scrollByView || {}, migrationPath: state.migrationPath };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}
const { escapeHtmlText: htmlText, escapeHtmlAttribute: htmlAttr, escapeUrlAttribute: urlAttr, setUrlAttribute } = window.YanceSecurity;
const businessPresentation = window.YanceBusinessPresentation || {};
function businessPlatform(value) { return businessPresentation.label?.('platform', value, platformInfo(value).label) || platformInfo(value).label; }
function businessIdentity(value, options = {}) { return businessPresentation.businessIdentity?.(value, options) || String(value || options.fallback || '身份待确认'); }
function fmtDate(value) {
  if (!value) return '尚无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}
function accountById(id = state.selectedId) { return state.data.accounts.find(row => row.id === id) || null; }
function platformInfo(platform) { return PLATFORM[platform] || { label: platform || '未知平台', icon: '?', accent: '' }; }
function accountAvatarUrl(account = {}) {
  return account.user?.avatarUrl || account.user?.avatar_url || account.metadata?.liveUser?.avatarUrl || account.metadata?.liveUser?.avatar_url || account.page?.picture || account.page?.pictureUrl || account.page?.avatarUrl || account.metadata?.pagePicture || account.metadata?.picture || '';
}
function accountAvatarRecord(account = {}, p = platformInfo(account?.platform)) {
  const user = { ...(account.metadata?.liveUser || {}), ...(account.user || {}) };
  const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || (user.username ? `@${user.username}` : '');
  const displayName = userName || account.identityLabel || account.displayName || account.page?.name || p.label;
  return {
    ...user,
    id: account.id || '',
    name: displayName,
    displayName,
    avatarUrl: accountAvatarUrl(account),
    avatar_url: accountAvatarUrl(account),
    platform: account.platform || '',
    allowRemoteAvatar: true
  };
}
function accountAvatarMarkup(account, p = platformInfo(account?.platform)) {
  return `<i class="ac32-platform-icon ${htmlAttr(p.accent)}" data-account-avatar-host="${htmlAttr(account?.id || '')}"><span>${htmlText(p.icon)}</span></i>`;
}
function bindAccountAvatarFallbacks(root = document) {
  root.querySelectorAll?.('[data-account-avatar-host]').forEach(host => {
    const account = accountById(host.dataset.accountAvatarHost);
    if (!account) return;
    const record = accountAvatarRecord(account);
    const avatarUrl = accountAvatarUrl(account);
    if (avatarUrl) {
      const image = document.createElement('img');
      image.alt = `${record.displayName}头像`;
      image.onerror = () => {
        image.remove();
        window.YanceAvatarRuntime?.mountAvatar?.(host, { ...record, avatarUrl: '', avatar_url: '' });
      };
      if (setUrlAttribute(image, 'src', avatarUrl, { allowHttp: true, allowHttps: true, allowBlob: true, allowDataImage: true, allowRelative: true })) {
        host.replaceChildren(image);
        return;
      }
    }
    window.YanceAvatarRuntime?.mountAvatar?.(host, record);
  });
}
function statusClass(value) { return String(value || '').replace(/[^a-z-]/g, ''); }
function healthLabel(value) { return ({ healthy:'健康', usable:'基本可用', attention:'需要关注', unconfigured:'未配置', failed:'已失效' })[value] || '需要处理'; }
function accountCapability(account = {}, name, fallback = false) {
  const runtime = window.YancePlatformCapabilityRuntime;
  if (runtime?.resolveCapability) return runtime.resolveCapability(account, name, fallback);
  const value = account?.capabilities?.[name];
  const supported = value === true || ['supported','partial','policy','permission'].includes(String(value || '').toLowerCase());
  return { name, state: supported ? 'supported' : 'unsupported', supported, fullySupported: supported, note: '', constraints: [], source: 'legacy-fallback' };
}
function accountCapabilityLabel(account = {}, name, fallback = false) {
  const row = accountCapability(account, name, fallback);
  return ({ supported:'支持', partial:'部分支持', policy:'受平台政策限制', permission:'需要额外权限', unsupported:'不支持', unavailable:'当前账号不可用', unknown:'能力待确认' })[row.state] || '能力待确认';
}

function capValue(value) {
  if (value === true) return ['可用', ''];
  if (value === false) return ['不支持', 'no'];
  if (value === 'partial') return ['部分支持', 'partial'];
  if (value === 'permission') return ['需要权限', 'partial'];
  if (value === 'policy') return ['受平台政策限制', 'partial'];
  if (value === 'platform') return ['平台决定', 'partial'];
  return [String(value || '未知'), 'partial'];
}

async function api(path = '', options = {}) {
  if (!window.YanceCore?.accountRequest) throw Object.assign(new Error('全局核心框架尚未就绪'), { code: 'CORE_RUNTIME_UNAVAILABLE' });
  return window.YanceCore.accountRequest(path, options);
}

function toast(message, type = 'success') {
  return window.YanceNotificationLayoutAuthority.show({ message, tone: type, timeoutMs: type === 'error' ? 5200 : type === 'warning' ? 3600 : 2600 });
}

function safeModeActive() {
  return window.YanceSafeMode?.isActive?.() === true || document.documentElement.hasAttribute('data-yance-safe-mode');
}
function safeModeError(error = {}) {
  const code = String(error.reasonCode || error.code || '').toUpperCase();
  const message = String(error.message || '');
  return code.includes('SAFE_MODE') || /安全模式|safe\s*mode/i.test(message);
}
function openSafeModeRecovery() {
  document.getElementById('ac32AccountDialog')?.close?.();
  window.YanceR32SettingsRecovery?.open?.('desktop');
}
function setAccountDialogStatus(message = '', type = 'error', options = {}) {
  const host = document.getElementById('ac32AccountDialogStatus');
  if (!host) return;
  host.replaceChildren();
  if (!message) {
    host.hidden = true;
    host.className = 'ac32-dialog-status';
    return;
  }
  host.hidden = false;
  host.className = `ac32-dialog-status ${type === 'warning' ? 'warn' : type === 'success' ? 'success' : 'bad'}`;
  const copy = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = type === 'warning' ? '当前操作已暂停' : type === 'success' ? '操作完成' : '连接未完成';
  const text = document.createElement('p');
  text.textContent = String(message);
  copy.append(title, text);
  host.appendChild(copy);
  if (options.showRecovery === true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ac32-button';
    button.textContent = '打开恢复中心退出安全模式';
    button.onclick = openSafeModeRecovery;
    host.appendChild(button);
  }
}
function setAccountDialogBusy(busy, label = '正在连接…') {
  const button = document.getElementById('ac32AccountSave');
  if (!button) return;
  if (busy) {
    button.dataset.busy = '1';
    button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return;
  }
  button.dataset.busy = '';
  const dialog = document.getElementById('ac32AccountDialog');
  const editing = Boolean(dialog?.dataset.accountId) && dialog?.dataset.credentialsOnly !== '1';
  const platform = document.getElementById('ac32FormPlatform')?.value || accountById(dialog?.dataset.accountId)?.platform || '';
  updateAccountDialogAction(platform, editing);
}
function setAuthNotice(account, message, type = 'error', options = {}) {
  if (!account?.id) return;
  state.authNotices ||= {};
  state.authNotices[account.id] = {
    message: String(message || '平台登录未完成'),
    type,
    showRecovery: options.showRecovery === true,
    at: new Date().toISOString()
  };
  state.selectedId = account.id;
  state.tab = 'login';
  if (state.view) renderWorkbench();
}
function clearAuthNotice(accountId) {
  if (state.authNotices && accountId) delete state.authNotices[accountId];
}
function ensureAccountAuthAllowed(account, actionLabel = '连接平台账号', options = {}) {
  if (!safeModeActive()) return true;
  const message = `安全模式正在阻止“${actionLabel}”。账号连接、二维码生成和平台授权已暂停；退出安全模式后再重试。`;
  if (options.dialog === true) setAccountDialogStatus(message, 'warning', { showRecovery: true });
  else if (account) setAuthNotice(account, message, 'warning', { showRecovery: true });
  toast('安全模式已暂停账号连接，请先打开恢复中心退出安全模式', 'warning');
  return false;
}
function authNoticeMarkup(account) {
  const notice = state.authNotices?.[account?.id];
  if (!notice) return '';
  return `<div class="ac32-auth-notice ${htmlAttr(notice.type === 'warning' ? 'warn' : 'bad')}" role="alert"><div><b>${htmlText(notice.type === 'warning' ? '账号连接已暂停' : '账号连接未完成')}</b><p>${htmlText(notice.message)}</p></div>${notice.showRecovery ? '<button class="ac32-button" data-panel-action="open-safe-mode-recovery">打开恢复中心</button>' : '<button class="ac32-button" data-panel-action="dismiss-auth-notice">知道了</button>'}</div>`;
}

function injectNav() {
  const button = document.createElement('button');
  button.className = 'icon'; button.id = 'navAccountsCenter'; button.title = '统一账号中心'; button.setAttribute('aria-label', '统一账号中心');
  button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7.5h16v9H4z"/><path d="M7 5v2.5M17 5v2.5M7 16.5V19M17 16.5V19"/><circle cx="8" cy="12" r="1.7"/><path d="M12 10h5M12 13h4"/></svg><b>统一账号中心</b>';
  (window.YanceConversationCenterV2?.registerNavEntry?.(button, { group: 'system', order: 10 }) || (document.getElementById('navSystemEntries') || navMenu).appendChild(button));
  button.onclick = () => openAccountCenter(state.selectedId);
}

function injectWorkspace() {
  const section = document.createElement('section');
  section.className = 'account-center-workspace ui-route-scroll-root';
  section.id = 'accountCenterWorkspace';
  section.setAttribute('aria-label', '统一账号中心');
  section.innerHTML = `
    <header class="ac32-hero">
      <div class="ac32-title"><small>REAL MULTI-PLATFORM ACCOUNT HUB</small><h1>统一账号中心</h1><p>WhatsApp、Telegram 与 Facebook 公共主页共用同一状态模型、凭据安全、同步诊断、通知、会话路由与防误发保护。</p></div>
      <div class="ac32-hero-actions"><button class="ac32-button" id="ac32ReconnectAll">全部重连</button><button class="ac32-button" id="ac32RunAllDiagnostics">全部诊断</button><button class="ac32-button primary" id="ac32AddAccount">添加账号</button></div>
    </header>
    <div class="ac32-summary" id="ac32Summary"></div>
    <div class="ac32-offline" id="ac32Offline">当前网络离线。已登录的本地状态仍可查看，云端授权、重连和诊断将在网络恢复后继续。</div>
    <main class="ac32-main ui-master-detail-shell">
      <aside class="ac32-directory ui-master-pane">
        <header class="ac32-directory-head"><h2>平台与账号</h2><p>账号状态、未读、来源和发送资格来自真实适配器。</p></header>
        <div class="ac32-tools"><label class="ac32-search"><i>⌕</i><input id="ac32Search" placeholder="搜索账号、号码、主页或状态"></label><div class="ac32-filters" id="ac32Filters"></div></div>
        <div class="ac32-account-list ui-route-scroll-surface" id="ac32AccountList"></div>
      </aside>
      <section class="ac32-workbench ui-detail-pane ui-route-scroll-surface" id="ac32Workbench"></section>
    </main>`;
  app.appendChild(section);
  section.addEventListener('scroll', event => {
    if (event.target?.id !== 'accountCenterWorkspace') return;
    const workbench = document.getElementById('ac32Workbench');
    captureAccountCenterScroll(workbench?.dataset.renderedAccountId || state.selectedId, workbench?.dataset.renderedTab || state.tab);
    clearTimeout(section._scrollSaveTimer);
    section._scrollSaveTimer = setTimeout(saveLocal, 120);
  }, { passive: true, capture: true });

  const accountDialog = document.createElement('dialog');
  accountDialog.id = 'ac32AccountDialog'; accountDialog.className = 'ac32-dialog';
  accountDialog.innerHTML = '<header><h3 id="ac32AccountDialogTitle">添加账号</h3><button class="ac32-button" data-close>关闭</button></header><main><div id="ac32AccountDialogBody"></div><div class="ac32-dialog-status" id="ac32AccountDialogStatus" role="alert" aria-live="assertive" hidden></div></main><footer><button class="ac32-button" data-close>取消</button><button class="ac32-button primary" id="ac32AccountSave">保存并连接</button></footer>';
  document.body.appendChild(accountDialog);

  const detailDialog = document.createElement('dialog');
  detailDialog.id = 'ac32DetailDialog'; detailDialog.className = 'ac32-dialog';
  detailDialog.innerHTML = '<header><h3 id="ac32DetailDialogTitle">详情</h3><button class="ac32-button" data-close>关闭</button></header><main id="ac32DetailDialogBody"></main><footer><button class="ac32-button primary" data-close>完成</button></footer>';
  document.body.appendChild(detailDialog);

  document.querySelectorAll('.ac32-dialog [data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
}

function setActiveNav() {
  ['navConversation','navContacts','navProfiles','navTimeline','navInsights','navAiWorkbench','navAccountsCenter','navSystemCenter'].forEach(id => document.getElementById(id)?.classList.toggle('active', id === 'navAccountsCenter'));
}
function closeOtherViews() {
  app.classList.remove('immersive','contacts-hidden','ai-hidden','compact','ai-open-small','contact-page-open','profile-page-open','timeline-page-open','insights-page-open','aiwork-page-open','system-center-open','settings-recovery-open','theme-workspace-open');
}
function openAccountCenter(id = '') {
  if (window.YanceWorkspaceRouteAuthority?.applyRoute) window.YanceWorkspaceRouteAuthority.applyRoute(app, 'accounts', { source: 'r32-account-center' });
  else { closeOtherViews(); app.classList.add('account-center-open'); }
  state.view = true;
  if (id && state.data.accounts.some(row => row.id === id)) state.selectedId = id;
  setActiveNav();
  saveLocal();
  refreshAccounts(false).then(() => restoreAccountCenterScroll(state.selectedId, state.tab, 0));
}
function leaveAccountCenter() {
  captureAccountCenterScroll();
  state.view = false; saveLocal(); app.classList.remove('account-center-open','theme-workspace-open');
}
function accountCenterScrollKey(accountId = state.selectedId, tab = state.tab) {
  return `${String(accountId || 'none')}:${String(tab || 'overview')}`;
}
function captureAccountCenterScroll(accountId = state.selectedId, tab = state.tab) {
  const authority = window.YanceWorkspaceRouteAuthority;
  const top = authority?.captureScroll?.(app, 'accounts') || 0;
  state.scrollByView ||= {};
  state.scrollByView[accountCenterScrollKey(accountId, tab)] = top;
  state.scroll = top; // compatibility with saved Fix17 state
}
function restoreAccountCenterScroll(accountId = state.selectedId, tab = state.tab, explicitTop) {
  const authority = window.YanceWorkspaceRouteAuthority;
  const key = accountCenterScrollKey(accountId, tab);
  const saved = state.scrollByView?.[key];
  const legacyTop = Object.keys(state.scrollByView || {}).length ? 0 : Number(state.scroll || 0);
  const top = Number(explicitTop ?? saved ?? legacyTop);
  authority?.restoreScroll?.(app, 'accounts', top);
}

function renderSummary() {
  const s = state.data.summary || {};
  const platform = Object.fromEntries((s.platforms || []).map(row => [row.platform, row]));
  document.getElementById('ac32Summary').innerHTML = [
    ['已连接账号', `${s.connected || 0}/${s.total || 0}`, s.abnormal ? `${s.abnormal} 个异常需要处理` : (s.limited ? `${s.limited} 个账号仅部分能力可用` : '当前没有异常账号')],
    ['WhatsApp', `${platform.whatsapp?.connected || 0}/${platform.whatsapp?.total || 0}`, platform.whatsapp?.abnormal ? `异常 ${platform.whatsapp.abnormal}` : '二维码与多设备会话'],
    ['Telegram', `${platform.telegram?.connected || 0}/${platform.telegram?.total || 0}`, state.data.platformAuth?.telegram?.available === true ? (platform.telegram?.abnormal ? `异常 ${platform.telegram.abnormal}` : '扫码或手机号登录') : '当前安装包尚未启用'],
    ['Facebook', `${platform.facebook?.connected || 0}/${platform.facebook?.total || 0}`, state.data.platformAuth?.facebook?.available === true ? (platform.facebook?.abnormal ? `异常 ${platform.facebook.abnormal}` : '公共主页与个人身份授权') : '当前安装包尚未启用'],
    ['总未读', String(s.unread || 0), '按平台与来源账号严格隔离'],
    ['最近同步', s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString('zh-CN',{hour12:false}) : '尚无', s.paused ? `${s.paused} 个账号已暂停` : '自动重连与状态恢复已启用']
  ].map(row => `<article class="ac32-stat"><span>${htmlText(row[0])}</span><b>${htmlText(row[1])}</b><small>${htmlText(row[2])}</small></article>`).join('');
}

function renderFilters() {
  const filters = [['all','全部'],['whatsapp','WhatsApp'],['telegram','Telegram'],['facebook','Facebook'],['abnormal','异常'],['paused','已暂停']];
  document.getElementById('ac32Filters').innerHTML = filters.map(([id,label]) => `<button data-filter="${htmlAttr(id)}" class="${htmlAttr(state.filter===id?'active':'')}">${htmlText(label)}</button>`).join('');
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { state.filter = button.dataset.filter; saveLocal(); renderFilters(); renderAccountList(); });
}

function filteredAccounts() {
  const q = state.search.trim().toLowerCase();
  return state.data.accounts.filter(account => {
    if (state.filter === 'abnormal' && !['error','reauthorize','credential-expiring'].includes(account.state)) return false;
    if (state.filter === 'paused' && account.state !== 'paused') return false;
    if (['whatsapp','telegram','facebook'].includes(state.filter) && account.platform !== state.filter) return false;
    if (!q) return true;
    return [account.displayName,account.identityLabel,account.stateLabel,account.platform,account.user?.username,account.user?.phone,account.page?.name].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}

function renderAccountList() {
  const list = filteredAccounts();
  const root = document.getElementById('ac32AccountList');
  if (!list.length) {
    root.innerHTML = '<div class="ac32-empty ui-empty-state-fill"><b>没有匹配的账号</b><p>调整筛选条件，或添加新的平台账号。</p></div>';
    return;
  }
  root.innerHTML = list.map(account => {
    const p = platformInfo(account.platform);
    const identity = account.user?.phone || account.user?.username || account.page?.name || account.identityLabel || '尚未验证';
    return `<button class="ac32-account ${htmlAttr(account.id===state.selectedId?'active':'')}" data-account-id="${htmlAttr(account.id)}">
      ${accountAvatarMarkup(account,p)}
      <span class="ac32-account-copy"><b>${htmlText(account.displayName)}</b><p>${htmlText(identity)}</p><span class="ac32-account-meta"><span>${htmlText(p.label)}</span>${account.isDefaultSend?'<span>默认发送</span>':''}${account.notificationsEnabled===false?'<span>通知关闭</span>':''}</span></span>
      <span class="ac32-account-side"><span class="ac32-state ${htmlAttr(statusClass(account.state))}"><i></i>${htmlText(account.stateLabel)}</span>${account.unread?`<span class="ac32-unread">${htmlText(account.unread)}</span>`:''}</span>
    </button>`;
  }).join('');
  bindAccountAvatarFallbacks(root);
  root.querySelectorAll('[data-account-id]').forEach(button => button.onclick = () => { state.selectedId = button.dataset.accountId; state.tab = 'overview'; state.scroll = 0; state.scrollByView ||= {}; state.scrollByView[accountCenterScrollKey(state.selectedId, state.tab)] = 0; saveLocal(); renderAccountList(); renderWorkbench(); });
}

function detailHeader(account) {
  const p = platformInfo(account.platform);
  const identity = account.user?.phone || account.user?.username || account.page?.name || account.identityLabel || '尚未验证';
  return `<header class="ac32-detail-hero"><div class="ac32-detail-id">${accountAvatarMarkup(account,p)}<div><h2>${htmlText(account.displayName)}</h2><p>${htmlText(identity)}</p><div class="ac32-detail-tags"><span>${htmlText(p.label)}</span><span>${htmlText(account.stateLabel)}</span><span>${htmlText(healthLabel(account.health))}</span>${account.isDefaultSend?'<span>默认发送账号</span>':''}</div></div></div><div class="ac32-detail-actions"><button class="ac32-button" data-action="diagnose">诊断</button><button class="ac32-button" data-action="${htmlAttr(account.state==='paused'?'resume':'reconnect')}">${htmlText(account.state==='paused'?'恢复':'重新连接')}</button><button class="ac32-button primary" data-action="open-conversations">查看来源会话</button></div></header>`;
}
function tabsHtml() {
  return `<nav class="ac32-tabs">${[['overview','总览'],['login','登录与凭据'],['capabilities','能力矩阵'],['sync','同步与队列'],['notifications','通知'],['bindings','会话绑定'],['diagnostics','诊断'],['history','操作历史'],['migration','旧账号迁移']].map(([id,label])=>`<button data-tab="${htmlAttr(id)}" class="${htmlAttr(state.tab===id?'active':'')}">${htmlText(label)}</button>`).join('')}</nav>`;
}

function renderWorkbench() {
  const root = document.getElementById('ac32Workbench');
  const previousAccountId = root?.dataset.renderedAccountId || '';
  const previousTab = root?.dataset.renderedTab || '';
  if (previousAccountId && previousTab) captureAccountCenterScroll(previousAccountId, previousTab);
  const account = accountById();
  if (!account) {
    root.innerHTML = '<div class="ac32-empty ui-empty-state-fill"><b>请选择一个账号</b><p>统一账号中心会在这里显示登录、能力、同步、通知、路由和诊断。</p></div>';
    root.dataset.renderedAccountId = '';
    root.dataset.renderedTab = '';
    return;
  }
  root.dataset.renderedAccountId = account.id;
  root.dataset.renderedTab = state.tab;
  root.innerHTML = `${detailHeader(account)}${tabsHtml()}<div class="ac32-scroll" id="ac32Scroll"><section class="ac32-panel active" id="ac32Panel"></section></div>`;
  bindAccountAvatarFallbacks(root);
  root.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { state.tab = button.dataset.tab; state.scrollByView ||= {}; state.scrollByView[accountCenterScrollKey(state.selectedId, state.tab)] = 0; saveLocal(); renderWorkbench(); });
  root.querySelectorAll('[data-action]').forEach(button => button.onclick = () => accountAction(button.dataset.action, account));
  renderPanel(account);
  if (account.platform === 'facebook' && state.tab === 'diagnostics' && !state.avatarImportSessions?.[account.id]) setTimeout(() => refreshFacebookAvatarImportSession(account, true), 0);
  restoreAccountCenterScroll(account.id, state.tab);
}

function renderPanel(account) {
  const panel = document.getElementById('ac32Panel');
  if (!panel) return;
  const renderers = { overview: renderOverview, login: renderLogin, capabilities: renderCapabilities, sync: renderSync, notifications: renderNotifications, bindings: renderBindings, diagnostics: renderDiagnostics, history: renderHistory, migration: renderMigration };
  panel.innerHTML = (renderers[state.tab] || renderOverview)(account);
  bindPanel(account);
}

function renderOverview(account) {
  const p = platformInfo(account.platform);
  return `<div class="ac32-grid">
    <article class="ac32-section wide"><header><h3>账号运行状态</h3><span>${htmlText(p.label)}</span></header><div class="ac32-section-body"><div class="ac32-health">
      <article><span>连接状态</span><b>${htmlText(account.stateLabel)}</b></article><article><span>账号健康</span><b>${htmlText(healthLabel(account.health))}</b></article><article><span>发送能力</span><b>${htmlText(account.sendVerified?'真实ACK已验证':account.canAttemptSend?'可尝试·待ACK':'不可发送')}</b></article><article><span>接收能力</span><b>${htmlText(account.canReceive?'可接收':'不可接收')}</b></article><article><span>未读消息</span><b>${htmlText(account.unread || 0)}</b></article>
    </div></div></article>
    <article class="ac32-section"><header><h3>账号资料</h3><span>登录后自动识别</span></header><div class="ac32-section-body"><div class="ac32-fact-grid">
      <article class="ac32-fact"><span>账号名称</span><b>${htmlText(account.displayName)}</b></article><article class="ac32-fact"><span>平台身份</span><b>${htmlText(account.identityLabel || '尚未登录')}</b></article>
      <article class="ac32-fact"><span>最近连接</span><b>${htmlText(fmtDate(account.connectedAt))}</b></article><article class="ac32-fact"><span>最近同步</span><b>${htmlText(fmtDate(account.lastSyncAt))}</b></article>
    </div></div></article>
    <article class="ac32-section"><header><h3>下一步</h3><span>${htmlText(account.health)}</span></header><div class="ac32-section-body"><div class="ac32-action-list">
      ${account.lastError?`<article class="ac32-action-row"><i>!</i><div><b>最近错误</b><p>${htmlText(account.lastError)}</p></div><em>需要处理</em></article>`:''}
      <article class="ac32-action-row"><i>1</i><div><b>${htmlText(account.state==='connected'?'账号已经完整连接':account.state==='limited'?'账号仅部分能力可用':'完成平台登录')}</b><p>${account.state==='connected'?`连接已建立；发送前置：${account.canAttemptSend?'就绪':'未就绪'}；真实ACK：${account.sendVerified?'已验证':'待验证'}。`:account.state==='limited'?`当前可尝试发送：${account.canAttemptSend?'是':'否'}；真实ACK：${account.sendVerified?'已验证':'待验证'}；可接收：${account.canReceive?'是':'否'}。请处理上方权限或连接提示。`:`使用 ${htmlText(p.auth)} 登录，不需要填写内部账号ID。`}</p></div><em>${htmlText(account.state==='connected'?'完成':account.state==='limited'?'受限':'待处理')}</em></article>
      <article class="ac32-action-row"><i>2</i><div><b>来源账号防误发</b><p>每个会话仍会绑定真实平台账号，发送前继续执行强校验。</p></div><em>${htmlText(account.isDefaultSend?'默认账号':'按会话路由')}</em></article>
    </div></div></article>
    <article class="ac32-section wide"><header><h3>快捷操作</h3><span>普通设置保持简单</span></header><div class="ac32-section-body" style="display:flex;gap:7px;flex-wrap:wrap"><button class="ac32-button" data-panel-action="edit">修改账号名称</button><button class="ac32-button" data-panel-action="default">设为默认发送</button><button class="ac32-button" data-panel-action="pause">${htmlText(account.state==='paused'?'恢复账号':'暂停账号')}</button><button class="ac32-button danger" data-panel-action="logout">退出登录</button><button class="ac32-button danger" data-panel-action="delete">删除账号</button></div></article>
  </div>`;
}

function facebookFlowDiagnostics(flow) {
  const diagnostics = flow?.diagnostics && typeof flow.diagnostics === 'object' ? flow.diagnostics : null;
  if (!diagnostics) return '';
  const primaryCount = Number(diagnostics.primaryCount || 0);
  const targetIds = Array.isArray(diagnostics.debugToken?.targetIds) ? diagnostics.debugToken.targetIds : [];
  const recoveredCount = Number(diagnostics.recoveredCount || 0);
  const directTokenChecks = Array.isArray(diagnostics.directPageTokenChecks) ? diagnostics.directPageTokenChecks : [];
  const directTokenAvailable = directTokenChecks.filter(row => row?.tokenAvailable === true).length;
  const source = diagnostics.resolutionSource === 'granular_target_direct_page_token'
    ? '已通过授权目标定向恢复 Page Token'
    : diagnostics.resolutionSource === 'debug_user_accounts'
      ? '已通过显式用户 accounts 恢复'
      : diagnostics.resolutionSource === 'granular_scope_target_ids'
        ? '已通过授权目标安全恢复'
        : diagnostics.resolutionSource === 'me_accounts'
          ? '由 /me/accounts 返回'
          : '尚未解析到主页';
  const targetText = targetIds.length ? targetIds.join(', ') : '无';
  return `主页发现：/me/accounts ${primaryCount} 条 · target_ids ${targetText} · 定向 Token ${directTokenAvailable}/${directTokenChecks.length} · 恢复 ${recoveredCount} 条 · ${source}`;
}

function renderLogin(account) {
  const p = platformInfo(account.platform);
  const authConfig = state.data.platformAuth || {};
  let auth = '';
  let actions = '';
  if (account.platform === 'whatsapp') {
    const challenge = state.qrChallenges[account.id];
    const waitingForQr = state.awaitingQrAccountId === account.id;
    auth = `<div class="${htmlAttr(waitingForQr?'ac32-hint warn':'ac32-hint')}">${htmlText(waitingForQr?'正在启动 WhatsApp 并等待真实二维码，生成后会自动弹出。请不要重复点击。':'点击下面按钮后，直接用手机 WhatsApp 扫描二维码。')}</div>${challenge?.dataUrl?`<div class="ac32-qr" style="margin-top:10px"><img src="${urlAttr(challenge.dataUrl,{allowDataImage:true})}" alt="WhatsApp二维码"><p>手机 WhatsApp → 已连接的设备 → 连接设备。二维码将在 ${htmlText(fmtDate(challenge.expiresAt))} 前有效。</p></div>`:''}`;
    actions = `<button class="ac32-button primary" data-panel-action="connect" ${waitingForQr?'disabled':''}>${htmlText(waitingForQr?'正在生成二维码…':['connected','limited'].includes(account.state)?'重新连接 WhatsApp':'显示二维码并连接')}</button><button class="ac32-button" data-panel-action="diagnose">检查连接</button>`;
  }
  if (account.platform === 'telegram') {
    const available = authConfig.telegram?.available === true;
    const challenge = state.qrChallenges[account.id];
    auth = `${available?'<div class="ac32-hint">选择扫码登录，或在下方改用手机号接收验证码。</div>':'<div class="ac32-hint bad">当前安装包尚未启用 Telegram 登录。请安装包含 Telegram 平台服务的正式升级包。</div>'}
      ${challenge?.dataUrl?`<div class="ac32-qr" style="margin-top:10px"><img src="${urlAttr(challenge.dataUrl,{allowDataImage:true})}" alt="Telegram登录二维码"><p>Telegram → 设置 → 设备 → 连接桌面设备。二维码将在 ${htmlText(fmtDate(challenge.expiresAt))} 前有效。</p></div>`:''}
      ${account.step==='code'?'<div class="ac32-form" style="margin-top:10px"><label>Telegram 验证码<input id="ac32TelegramCode" autocomplete="one-time-code" placeholder="输入收到的验证码"></label><button class="ac32-button primary" data-panel-action="submit-code">确认验证码</button></div>':''}
      ${account.step==='password'?'<div class="ac32-form" style="margin-top:10px"><label>两步验证密码<input type="password" id="ac32TelegramPassword" autocomplete="current-password" placeholder="输入两步验证密码"></label><button class="ac32-button primary" data-panel-action="submit-password">继续登录</button></div>':''}
      ${available?`<details style="margin-top:10px"><summary>无法扫码？使用手机号登录</summary><div class="ac32-form" style="margin-top:10px"><label>手机号<input id="ac32TelegramPhone" autocomplete="tel" placeholder="+49…"></label><div style="display:flex;gap:7px"><button class="ac32-button" data-panel-action="telegram-phone">发送验证码</button>${['qr','code','password'].includes(account.step)?'<button class="ac32-button" data-panel-action="telegram-cancel">取消登录</button>':''}</div></div></details>`:''}`;
    actions = `<button class="ac32-button primary" data-panel-action="telegram-qr" ${available?'':'disabled'}>${htmlText(available?'扫描二维码登录':'Telegram 登录尚未启用')}</button><button class="ac32-button" data-panel-action="diagnose">检查连接</button>`;
  }
  if (account.platform === 'facebook') {
    const available = authConfig.facebook?.available === true;
    const type = facebookAccountType(account.accountKind || account.driverId);
    const flow = state.facebookFlow?.accountId === account.id ? state.facebookFlow : null;
    const pages = flow?.pages || [];
    if (type.accountKind === 'personal-identity') {
      auth = `${available?'<div class="ac32-hint">使用官方 Facebook Login 读取当前个人身份、名称和头像。个人身份登录不提供 Messenger 私信读取或发送能力。</div>':'<div class="ac32-hint bad">当前安装包尚未启用 Facebook 登录。</div>'}
        ${flow?`<div class="ac32-hint warn" style="margin-top:10px">身份授权状态：${htmlText(flow.status || '等待浏览器确认')}</div>`:''}
        ${account.state==='connected'?'<div class="ac32-hint" style="margin-top:10px">官方个人身份已连接；消息能力保持关闭，避免把身份授权伪装成 Messenger 接入。</div>':''}`;
      actions = `<button class="ac32-button primary" data-panel-action="facebook-oauth" ${available?'':'disabled'}>${htmlText(available?'使用官方 Facebook Login':'Facebook 登录尚未启用')}</button>${flow?'<button class="ac32-button" data-panel-action="facebook-cancel">取消授权</button>':''}<button class="ac32-button" data-panel-action="diagnose">检查身份状态</button>`;
    } else if (type.accountKind === 'personal-messenger') {
      const messengerStep = flow?.step || flow || null;
      const messengerFields = Array.isArray(messengerStep?.user_input?.fields) ? messengerStep.user_input.fields : Array.isArray(messengerStep?.fields) ? messengerStep.fields : [];
      const loginProcessId = String(flow?.login_process_id || flow?.loginProcessId || messengerStep?.login_process_id || messengerStep?.loginProcessId || '').trim();
      const stepId = String(messengerStep?.step_id || messengerStep?.stepId || flow?.step_id || flow?.stepId || '').trim();
      const stepType = String(messengerStep?.type || flow?.type || '').trim().toLowerCase();
      const fieldMarkup = messengerFields.map(field => { const name=String(field.id||field.name||field.key||'').trim(); if(!name) return ''; const label=field.label||field.name||name; const secret=/password|secret|token/i.test(String(field.type||name)); return `<label>${htmlText(label)}<input ${secret?'type="password" autocomplete="current-password"':'autocomplete="off"'} data-facebook-messenger-field="${htmlAttr(name)}" placeholder="${htmlAttr(field.description||field.placeholder||'')}"></label>`; }).join('');
      auth = `<div class="ac32-hint"><b>mautrix/meta · messenger-lite：</b>Facebook 协议、登录挑战、会话与恢复由固定版本 mautrix/meta 持有；言策只消费每账号独立的 Matrix/Synapse 会话。密码与挑战输入不会写入账号元数据。</div>
        ${flow?`<div class="ac32-hint warn" style="margin-top:10px">登录步骤：${htmlText(messengerStep?.instructions||messengerStep?.description||stepType||'等待输入')}</div>`:''}
        ${fieldMarkup?`<div class="ac32-form" style="margin-top:10px">${fieldMarkup}<button class="ac32-button primary" data-panel-action="facebook-messenger-submit" data-login-process-id="${htmlAttr(loginProcessId)}" data-step-id="${htmlAttr(stepId)}">继续</button></div>`:''}
        ${stepType==='display_and_wait'?`<div style="margin-top:10px"><button class="ac32-button primary" data-panel-action="facebook-messenger-wait" data-login-process-id="${htmlAttr(loginProcessId)}" data-step-id="${htmlAttr(stepId)}">我已完成上游确认</button></div>`:''}`;
      actions = `${flow?'':`<button class="ac32-button primary" data-panel-action="facebook-messenger-start">开始 Personal Messenger 登录</button>`}${flow?'<button class="ac32-button" data-panel-action="facebook-messenger-cancel">取消登录</button>':''}<button class="ac32-button" data-panel-action="diagnose">检查连接</button>`;
    } else {
      auth = `${available?'<div class="ac32-hint">使用拥有公共主页管理权限的个人 Facebook 账号授权。授权结果必须包含 pages_read_engagement，才能同步 Meta Business Suite 的新联系人、最近会话和公共主页后台发送消息。</div>':'<div class="ac32-hint bad">当前安装包尚未启用 Facebook 登录。请安装包含 Facebook 平台服务的正式升级包。</div>'}
        ${account.credentialReady&&account.historySyncAvailable===false?`<div class="ac32-hint bad" style="margin-top:10px"><b>当前 Facebook 绑定不完整：</b>${htmlText(account.historySyncReason||'缺少 pages_read_engagement，Business Suite 会话无法补拉')}。请点击下方授权按钮重新授权。</div>`:''}
        ${flow?`<div class="ac32-hint warn" style="margin-top:10px">授权状态：${htmlText(flow.status || '等待浏览器确认')}</div>`:''}
        ${flow?.diagnostics?`<div class="ac32-hint ${htmlAttr(flow.status==='error'?'bad':'warn')}" style="margin-top:10px">${htmlText(facebookFlowDiagnostics(flow))}</div>`:''}
        ${pages.length?`<div class="ac32-page-choice" style="margin-top:10px">${pages.map(page=>{const missingBase=page.permissionReady===false;const missingHistory=page.historySyncAvailable===false;const blocked=missingBase;const detail=missingBase?`授权范围不足：${(page.missingPermissions||[]).join(', ')}`:missingHistory?`可完成绑定；缺少 pages_read_engagement 时历史对账受限`:(page.username?`@${page.username}`:page.id);return `<button class="ac32-account" data-facebook-page="${htmlAttr(page.id)}" ${blocked?'disabled':''}><span class="ac32-account-copy"><b>${htmlText(page.name)}</b><p>${htmlText(detail)}</p></span><span class="ac32-state ${htmlAttr(blocked?'error':missingHistory?'limited':'connected')}"><i></i>${htmlText(missingBase?'需要重新授权':missingHistory?'选择并以受限模式连接':'选择此主页')}</span></button>`}).join('')}</div>`:''}`;
      actions = `<button class="ac32-button primary" data-panel-action="facebook-oauth" ${available?'':'disabled'}>${htmlText(available?'使用主页管理员个人账号授权':'Facebook 登录尚未启用')}</button>${flow?'<button class="ac32-button" data-panel-action="facebook-cancel">取消授权</button>':''}<button class="ac32-button" data-panel-action="diagnose">检查连接</button>`;
    }
  }
  const notice = authNoticeMarkup(account);
  return `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>${htmlText(p.label)} 登录</h3><span>普通用户登录</span></header><div class="ac32-section-body">${notice}${auth}<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:11px">${actions}</div></div></article><article class="ac32-section"><header><h3>当前状态</h3><span>${htmlText(account.stateLabel)}</span></header><div class="ac32-section-body"><div class="ac32-fact-grid"><article class="ac32-fact"><span>平台</span><b>${htmlText(p.label)}</b></article><article class="ac32-fact"><span>账号</span><b>${htmlText(account.identityLabel || account.displayName || '尚未登录')}</b></article><article class="ac32-fact"><span>最近连接</span><b>${htmlText(fmtDate(account.connectedAt))}</b></article><article class="ac32-fact"><span>发送状态</span><b>${htmlText(account.sendVerified?'真实ACK已验证':account.canAttemptSend?'允许尝试·待ACK':'尚不可发送')}</b></article></div></div></article></div>`;
}

function renderCapabilities(account) {
  const caps = account.capabilities || {};
  return `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>账号能力矩阵</h3><span>由后端协议契约、公开接口与真实适配器共同决定</span></header><div class="ac32-section-body"><div class="ac32-cap-grid">${Object.entries(caps).map(([key,value])=>{const availability=account.capabilityAvailability?.[key],base=capValue(value),label=availability&&value!==false&&!availability.availableNow?'平台支持，当前账号不可用':base[0],cls=availability&&value!==false&&!availability.availableNow?'partial':base[1],contract=account.capabilityContracts?.[key]||{};return `<article class="ac32-cap"><b>${htmlText(CAP_LABELS[key]||key)}</b><i class="${htmlAttr(cls)}">${htmlText(label)}</i>${contract.note?`<small>${htmlText(contract.note)}</small>`:''}</article>`}).join('')}</div></div></article><article class="ac32-section"><header><h3>生产资格</h3><span>防止点击后才失败</span></header><div class="ac32-section-body"><div class="ac32-fact-grid"><article class="ac32-fact"><span>发送前置</span><b>${htmlText(account.canAttemptSend?'允许尝试':'禁止')}</b><em>${htmlText(account.stateLabel)}</em></article><article class="ac32-fact"><span>真实发送ACK</span><b>${htmlText(account.sendVerified?'已验证':'未验证')}</b><em>${htmlText(account.lastDeliveryAckAt?fmtDate(account.lastDeliveryAckAt):account.sendReadiness||'待验证')}</em></article><article class="ac32-fact"><span>接收资格</span><b>${htmlText(account.canReceive?'允许':'禁止')}</b><em>${htmlText(account.stateLabel)}</em></article><article class="ac32-fact"><span>默认发送</span><b>${htmlText(account.isDefaultSend?'是':'否')}</b></article><article class="ac32-fact"><span>自动重连</span><b>${htmlText(account.autoReconnect?'启用':'关闭')}</b></article></div></div></article><article class="ac32-section"><header><h3>平台差异说明</h3><span>${htmlText(platformInfo(account.platform).label)}</span></header><div class="ac32-section-body"><div class="ac32-hint warn">“平台不支持”“需要权限”“受平台政策限制”不会被伪装成可用。账号实际权限变化后，能力矩阵与发送路由会同步更新。</div></div></article></div>`;
}

function renderSync(account) {
  const historyFallback = account.historySyncAvailable === true || account.capabilities?.historySync === true;
  const historyCapability = accountCapability(account, 'historySync', historyFallback);
  const historyLabel = accountCapabilityLabel(account, 'historySync', historyFallback);
  const historyReason = historyCapability.note || account.historySyncReason || '';
  const facebookPageAccount = account.platform === 'facebook' && facebookAccountType(account.accountKind || account.driverId).accountKind === 'page';
  const facebookCloud = facebookPageAccount ? `<article class="ac32-section wide"><header><h3>Facebook 云端离线队列</h3><span>Cloudflare Worker · D1 · R2</span></header><div class="ac32-section-body"><div class="ac32-health"><article><span>Worker 状态</span><b>${htmlText(account.workerStatus || '尚未连接')}</b></article><article><span>等待同步</span><b>${htmlText(account.pendingEvents || 0)}</b></article><article><span>死信事件</span><b>${htmlText(account.deadLetter || 0)}</b></article><article><span>最近 ACK</span><b>${htmlText(account.lastAckAt ? fmtDate(account.lastAckAt) : '尚无')}</b></article><article><span>Page Token</span><b>${htmlText(account.tokenStatus === 'active' ? '云端有效' : account.tokenStatus || '尚未验证')}</b></article></div><div class="ac32-hint" style="margin-top:10px">电脑关闭时，Meta Webhook 由 Cloudflare Worker 接收并暂存到 D1；图片和附件临时保存到 R2。言策上线后按租约拉取，只有成功写入本机 SQLite 后才确认 ACK。Page Token 不会下发到 Windows。</div></div></article>` : '';
  const facebookReconciliation = facebookPageAccount ? `<article class="ac32-section wide"><header><h3>Business Suite 会话对账</h3><span>${htmlText(account.reconciliationActive?'自动补偿已运行':account.historySyncAvailable===true?'等待启动':'权限阻断')}</span></header><div class="ac32-section-body"><div class="ac32-health"><article><span>历史权限</span><b>${htmlText(account.historySyncAvailable===true?'已授权':'缺少 pages_read_engagement')}</b></article><article><span>周期对账</span><b>${htmlText(account.reconciliationActive?'运行中':'未运行')}</b></article><article><span>当前任务</span><b>${htmlText(account.reconciliationRunning?'正在同步':'空闲')}</b></article><article><span>最近对账</span><b>${htmlText(account.reconciliationLastAt?fmtDate(account.reconciliationLastAt):'尚无')}</b></article><article><span>最近错误</span><b>${htmlText(account.reconciliationLastError||'无')}</b></article></div>${account.historySyncAvailable===true?`<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px"><button class="ac32-button primary" data-panel-action="facebook-sync-now" ${account.reconciliationRunning?'disabled':''}>${htmlText(account.reconciliationRunning?'正在执行对账…':'立即执行会话对账')}</button></div>`:`<div class="ac32-hint bad" style="margin-top:10px">${htmlText(account.historySyncReason||'缺少 pages_read_engagement，无法读取 Meta Business Suite 最近会话')}。请到“登录与凭据”重新授权；未补齐前，旧会话仍可能显示，但新联系人和公共主页后台消息不能保证进入言策。</div>`}</div></article>` : '';
  return facebookCloud + facebookReconciliation + `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>同步与断线恢复</h3><span>账号独立队列，不阻塞其他平台</span></header><div class="ac32-section-body"><div class="ac32-health"><article><span>实时连接</span><b>${htmlText(account.stateLabel)}</b></article><article><span>最近成功同步</span><b>${htmlText(account.lastSyncAt?new Date(account.lastSyncAt).toLocaleTimeString('zh-CN',{hour12:false}):'尚无')}</b></article><article><span>历史补拉</span><b>${htmlText(historyLabel)}</b>${!historyCapability.supported&&historyReason?`<small>${htmlText(historyReason)}</small>`:''}</article><article><span>当前未读</span><b>${htmlText(account.unread||0)}</b></article><article><span>自动重连</span><b>${htmlText(account.autoReconnect?'开启':'关闭')}</b></article></div></div></article><article class="ac32-section"><header><h3>断线恢复保护</h3><span>幂等</span></header><div class="ac32-section-body"><div class="ac32-action-list"><article class="ac32-action-row"><i>✓</i><div><b>消息去重与乱序恢复</b><p>平台账号、原始会话ID和原始消息ID组成幂等键。</p></div><em>启用</em></article><article class="ac32-action-row"><i>✓</i><div><b>未读与通知去重</b><p>历史补拉不会重复累计未读或重复弹出桌面通知。</p></div><em>启用</em></article><article class="ac32-action-row"><i>✓</i><div><b>媒体任务恢复</b><p>${htmlText(facebookPageAccount?'R2 媒体在本地落盘成功前保留，可重复拉取。':'下载失败保留状态，可重试而不删除聊天记录。')}</p></div><em>启用</em></article></div></div></article><article class="ac32-section"><header><h3>限流与队列</h3><span>平台级隔离</span></header><div class="ac32-section-body"><div class="ac32-fact-grid"><article class="ac32-fact"><span>Flood Wait</span><b>${htmlText(account.floodWaitSeconds?`${account.floodWaitSeconds} 秒`:'无')}</b></article><article class="ac32-fact"><span>发送队列</span><b>独立账号队列</b></article><article class="ac32-fact"><span>失败重试</span><b>指数退避</b></article><article class="ac32-fact"><span>连续失败</span><b>自动暂停路由</b></article></div></div></article></div>`;
}

function renderNotifications(account) {
  return `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>账号级通知</h3><span>与桌面托盘和当前会话联动</span></header><div class="ac32-section-body"><div class="ac32-form two"><label>桌面通知<select id="ac32NotifyEnabled"><option value="true" ${account.notificationsEnabled!==false?'selected':''}>启用</option><option value="false" ${account.notificationsEnabled===false?'selected':''}>关闭</option></select></label><label>自动重连<select id="ac32AutoReconnect"><option value="true" ${account.autoReconnect!==false?'selected':''}>启用</option><option value="false" ${account.autoReconnect===false?'selected':''}>关闭</option></select></label></div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px"><button class="ac32-button primary" data-panel-action="save-notifications">保存账号设置</button><button class="ac32-button" data-panel-action="test-notification">测试桌面通知</button></div></div></article><article class="ac32-section"><header><h3>通知生命周期</h3><span>不会重复打扰</span></header><div class="ac32-section-body"><div class="ac32-action-list"><article class="ac32-action-row"><i>1</i><div><b>正在查看的会话不重复通知</b><p>当前会话由通知策略识别。</p></div><em>启用</em></article><article class="ac32-action-row"><i>2</i><div><b>点击通知定位正确来源</b><p>携带平台、账号和原始会话ID。</p></div><em>启用</em></article><article class="ac32-action-row"><i>3</i><div><b>隐私摘要</b><p>可隐藏正文，只显示发送者或“收到新消息”。</p></div><em>支持</em></article></div></div></article><article class="ac32-section"><header><h3>托盘联动</h3><span>全平台总览</span></header><div class="ac32-section-body"><div class="ac32-hint">系统托盘显示已连接账号、异常账号、各平台状态与总未读；右键可打开账号中心、重连全部账号或暂停全部通知。</div></div></article></div>`;
}

function renderBindings(account) {
  const bindings = Object.values(state.data.bindings || {}).filter(row => row.accountId === account.id);
  return `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>会话来源账号绑定</h3><span>${htmlText(bindings.length)} 条绑定</span></header><div class="ac32-section-body"><div class="ac32-binding-list">${bindings.length?bindings.map(row=>`<article class="ac32-binding-row"><span></span><div><b>${htmlText(businessPlatform(row.platform))} 会话 · ${htmlText(businessIdentity(row.externalConversationId||row.conversationId,{platform:row.platform,fallback:'目标待确认'}))}</b><p>通过 ${htmlText(account.displayName||account.identityLabel||platformInfo(account.platform).label)} 绑定 · ${htmlText(fmtDate(row.updatedAt))}</p><details class="ac32-technical-details"><summary>查看技术详情</summary><dl><dt>会话标识</dt><dd>${htmlText(row.conversationId||'未记录')}</dd><dt>平台原始会话</dt><dd>${htmlText(row.externalConversationId||'未记录')}</dd><dt>账号实例</dt><dd>${htmlText(row.accountId||account.id||'未记录')}</dd></dl></details></div><em>已绑定</em></article>`).join(''):'<div class="ac32-empty ui-empty-state-fill"><b>尚无会话绑定</b><p>从该账号接收或发送真实消息后，会自动保存平台、账号和原始会话ID。</p></div>'}</div></div></article><article class="ac32-section"><header><h3>防误发门禁</h3><span>发送前强校验</span></header><div class="ac32-section-body"><div class="ac32-action-list"><article class="ac32-action-row"><i>✓</i><div><b>联系人平台匹配</b><p>确认当前会话属于该平台和账号。</p></div><em>必检</em></article><article class="ac32-action-row"><i>✓</i><div><b>账号在线与权限</b><p>退出、限流或权限不足时阻止发送。</p></div><em>必检</em></article><article class="ac32-action-row"><i>✓</i><div><b>同名联系人识别</b><p>不以显示名称作为唯一发送依据。</p></div><em>必检</em></article></div></div></article><article class="ac32-section"><header><h3>输入框来源提示</h3><span>始终可见</span></header><div class="ac32-section-body"><div class="ac32-hint">正式会话输入框会固定显示“通过 ${htmlText(platformInfo(account.platform).label)} · ${htmlText(account.displayName)} 发送”，切换来源账号时必须人工确认。</div></div></article></div>`;
}

function facebookAvatarRootCauseLabel(code='') {
  return ({
    READY:'头像链路正常',
    META_CONTACT_PROFILE_ACCESS_DENIED:'Meta 拒绝联系人头像访问',
    META_CONTACT_AVATAR_UNSUPPORTED_GET:'Meta 当前不支持读取联系人头像',
    IDENTITY_UNRESOLVED:'联系人身份未解析',
    PERSISTED_IDENTITY_WRONG_MESSAGE_ID_READY:'持久化身份错误，消息身份可用',
    PERSISTED_AND_MESSAGE_IDENTITIES_REJECTED:'两个身份均被 Worker 拒绝',
    WORKER_REJECTS_MESSAGE_DERIVED_IDENTITY:'Worker 联系人头像请求失败',
    WORKER_AVATAR_REQUEST_FAILED:'Worker 头像请求失败',
    WORKER_OK_BUT_AVATAR_NOT_PERSISTED:'头像未写入 SQLite',
    LOCAL_CACHE_INVALID:'本地头像缓存无效',
    AVATAR_STATUS_NOT_READY:'头像状态未就绪'
  })[String(code||'')]||String(code||'未知原因');
}
function avatarDiagnosticRows(report = {}) {
  return (report.contacts || []).map(row => {
    const edge = row.workerProbe?.pictureEdge || {};
    const genericPicture = row.workerProbe?.identityPicture || {};
    const profile = row.workerProbe?.messengerProfile || {};
    const formatAttempt = value => value.code
      ? `${value.code}${value.metaCode?` / Meta ${value.metaCode}${value.metaSubcode?`:${value.metaSubcode}`:''}`:''}${value.metaReason?` / ${value.metaReason}`:''}`
      : '未返回';
    const provenance = row.identityProvenance || {};
    const derived = provenance.workerProbe || {};
    const provenanceText = provenance.attempted
      ? (provenance.messageDerivedResolved
        ? `消息身份 ${provenance.differsFromPersisted?'与持久化身份不同':'与持久化身份相同'} · Worker ${derived.ok?`${derived.bytes||0} 字节`:(derived.error||'失败')}`
        : `消息身份未解析 · ${provenance.error||'无非主页消息身份'}`)
      : `未执行消息身份对照 · ${provenance.externalConversationIdPresent?'':'缺少原始会话ID'}`;
    const accessDenied=row.rootCause==='META_CONTACT_PROFILE_ACCESS_DENIED';
    const unsupportedGet=row.rootCause==='META_CONTACT_AVATAR_UNSUPPORTED_GET';
    const action=row.capability?.action||(accessDenied?'检查 Meta 应用 Advanced Access、业务验证和联系人资料接口；无需反复重新连接。':'');
    return `<article class="ac32-diagnostic-row ${htmlAttr(row.rootCause==='READY'?'':'fail')}"><i>${htmlText(row.rootCause==='READY'?'✓':'×')}</i><div><b>${htmlText(row.displayName||'Facebook 联系人')}</b><p>身份 ${htmlText(row.identity?.resolved?`已解析 · ${row.identity.source}`:'未解析')} · Worker ${htmlText(row.workerProbe?.ok?`${row.workerProbe.bytes||0} 字节`:(row.workerProbe?.error||'未执行'))} · SQLite ${htmlText(row.sqlite?.avatarUrlPresent?row.sqlite.avatarStatus||'有头像':'无头像')} · 缓存 ${htmlText(row.cache?.valid?`${row.cache.bytes||0} 字节有效`:(row.cache?.errorCode||'无'))}</p><p>身份来源对照：${htmlText(provenanceText)}</p>${row.workerProbe?.ok?'':`<p>Messenger Profile：${htmlText(formatAttempt(profile))}<br>Generic id,picture：${htmlText(formatAttempt(genericPicture))}<br>Picture Edge：${htmlText(formatAttempt(edge))}</p>`}${action?`<p><b>处理建议：</b>${htmlText(action)}</p>`:''}</div><em title="${htmlAttr(row.rootCause||'UNKNOWN')}">${htmlText(facebookAvatarRootCauseLabel(row.rootCause))}</em></article>`;
  }).join('');
}

function facebookAvatarImportMarkup(account) {
  const session = state.avatarImportSessions?.[account.id] || { active:false };
  const preview = session.preview || {};
  const reconciliation = session.reconciliation || {};
  const imported = session.imported || {};
  const active = session.active === true;
  return `<article class="ac32-section wide"><header><h3>言策网页伴侣 · Facebook</h3><span>头像补全 · 增量扫描 · 会话差异预览</span></header><div class="ac32-section-body">
    <div class="ac32-hint ${htmlAttr(active?'':'warn')}">${active?`网页伴侣窗口已开启。到 Meta Business Suite 收件箱点击“言策网页伴侣”，扩展会自动滚动当前联系人列表，对比头像和最近消息摘要，只导入新增或变化头像。窗口将在 ${htmlText(fmtDate(session.expiresAt))} 到期。`:'首次使用请运行材料包中的 INSTALL_FACEBOOK_AVATAR_IMPORTER.cmd 安装扩展，然后在这里开启 10 分钟网页伴侣窗口。扩展只处理你主动扫描到的网页可见内容，不读取登录凭据，也不会直接把网页消息写入数据库。'}</div>
    <div class="ac32-health" style="margin-top:10px"><article><span>伴侣窗口</span><b>${htmlText(active?'已开启':'未开启')}</b></article><article><span>扩展连接</span><b>${htmlText(session.extensionConnected?'已连接':active?'等待连接':'未连接')}</b></article><article><span>扫描</span><b>${htmlText(preview.scanned||0)}</b></article><article><span>新增头像</span><b>${htmlText(preview.new||0)}</b></article><article><span>头像变化</span><b>${htmlText(preview.changed||0)}</b></article><article><span>无需更新</span><b>${htmlText(preview.unchanged||0)}</b></article><article><span>潜在新会话</span><b>${htmlText(reconciliation.potentialNewConversations||preview.unmatched||0)}</b></article><article><span>消息摘要差异</span><b>${htmlText(reconciliation.messagePreviewDifferences||0)}</b></article><article><span>歧义</span><b>${htmlText(preview.ambiguous||0)}</b></article><article><span>累计导入</span><b>${htmlText(imported.imported||0)}</b></article><article><span>跳过</span><b>${htmlText(imported.skipped||0)}</b></article><article><span>失败</span><b>${htmlText(imported.failed||0)}</b></article></div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px"><button class="ac32-button primary" data-panel-action="facebook-avatar-import-start">${htmlText(active?'延长网页伴侣窗口':'开启网页伴侣')}</button><button class="ac32-button" data-panel-action="facebook-avatar-import-refresh">刷新伴侣状态</button>${active?'<button class="ac32-button danger" data-panel-action="facebook-avatar-import-stop">关闭网页伴侣窗口</button>':''}</div>
    <div class="ac32-hint" style="margin-top:10px"><b>数据治理：</b>头像写入本地缓存和 SQLite，并记录网页来源、导入时间、匹配依据与用户确认状态；网页最近消息仅用于差异预览，正式消息仍由 Meta API / Worker 对账确认。</div>
  </div></article>`;
}

function renderDiagnostics(account) {
  const report = state.diagnostics[account.id];
  const avatar = state.avatarDiagnostics[account.id];
  const baseMarkup = `<article class="ac32-section wide"><header><h3>账号健康诊断</h3><span>凭据、平台、会话、收发、通知和路由</span></header><div class="ac32-section-body"><div style="display:flex;gap:7px;margin-bottom:10px"><button class="ac32-button primary" data-panel-action="diagnose">运行真实诊断</button><button class="ac32-button" data-panel-action="connect">先连接再诊断</button></div>${report?`<div class="ac32-health"><article><span>健康等级</span><b>${htmlText(report.health)}</b></article><article><span>通过</span><b>${htmlText(report.pass)}</b></article><article><span>需处理</span><b>${htmlText(report.fail)}</b></article><article><span>平台</span><b>${htmlText(platformInfo(report.platform).label)}</b></article><article><span>检测时间</span><b>${htmlText(new Date(report.at).toLocaleTimeString('zh-CN',{hour12:false}))}</b></article></div><div class="ac32-diagnostic-list" style="margin-top:9px">${report.tests.map(test=>`<article class="ac32-diagnostic-row ${htmlAttr(test.pass?'':'fail')}"><i>${htmlText(test.pass?'✓':'×')}</i><div><b>${htmlText(test.name)}</b><p>${htmlText(test.detail)}</p></div><em>${htmlText(test.pass?'通过':'失败')}</em></article>`).join('')}</div>`:'<div class="ac32-empty ui-empty-state-fill"><b>尚未运行诊断</b><p>诊断会真实检查凭据、平台服务、登录会话、接收、发送、同步、通知和会话路由。</p></div>'}</div></article>`;
  const facebook = account.platform === 'facebook' ? `<article class="ac32-section wide"><header><h3>Facebook Avatar Closure 专项诊断</h3><span>身份 → Worker → 图片字节 → SQLite → 本地缓存</span></header><div class="ac32-section-body"><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px"><button class="ac32-button primary" data-panel-action="facebook-avatar-diagnose">诊断并生成证据</button>${avatar?'<button class="ac32-button" data-panel-action="facebook-avatar-export">导出本次证据</button>':''}</div>${avatar?`<div class="ac32-health"><article><span>公共主页头像</span><b>${htmlText(avatar.worker?.pageProbe?.ok?'正常':'失败')}</b></article><article><span>联系人身份</span><b>${htmlText(`${avatar.summary?.identityResolved||0}/${avatar.summary?.conversationsScanned||0} 已解析`)}</b></article><article><span>联系人头像访问</span><b>${htmlText(avatar.summary?.contactAvatarCapability==='meta-access-denied'?'Meta 拒绝':avatar.summary?.contactAvatarCapability==='meta-api-unavailable'?'Meta 不支持':avatar.summary?.contactAvatarCapability==='ready'?'正常':'降级')}</b></article><article><span>Worker返回头像</span><b>${htmlText(avatar.summary?.workerAvatarReady||0)}</b></article><article><span>SQLite有头像</span><b>${htmlText(avatar.summary?.sqliteAvatarPresent||0)}</b></article><article><span>本地缓存有效</span><b>${htmlText(avatar.summary?.localCacheValid||0)}</b></article><article><span>完整通过</span><b>${htmlText(avatar.summary?.fullyReady||0)}</b></article><article><span>身份不一致</span><b>${htmlText(avatar.summary?.persistedIdentityDiffers||0)}</b></article></div><div class="ac32-hint ${htmlAttr(avatar.summary?.contactAvatarCapability==='ready'?'':'bad')}" style="margin-top:9px">消息收发与公共主页头像可正常时，联系人头像仍可能被 Meta 单独限制。当前：Worker 合同 ${htmlText(avatar.worker?.publicHealth?.contract?.version??'未返回')} · 签名 ${htmlText(avatar.worker?.signedHealth?.ok?'通过':avatar.worker?.signedHealth?.error||'失败')} · 联系人头像 ${htmlText(avatar.summary?.contactAvatarCapability==='meta-access-denied'?'Meta missing_permission；重新连接通常无效':avatar.summary?.contactAvatarCapability==='meta-api-unavailable'?'Meta unsupported_get；不再自动重试':avatar.summary?.contactAvatarCapability||'未判定')}</div>${avatar.summary?.contactAvatarCapability==='meta-access-denied'?'<div class="ac32-hint warn" style="margin-top:9px"><b>账号不是整体失效：</b>消息收发、历史、公共主页头像与联系人头像访问必须分开判断。请检查 Meta 应用 Advanced Access、业务验证及当前 Graph 联系人资料接口。</div>':avatar.summary?.contactAvatarCapability==='meta-api-unavailable'?'<div class="ac32-hint warn" style="margin-top:9px"><b>确定性限制：</b>Meta 对当前联系人身份返回 unsupported_get。言策不会自动重复请求，也不会清空已有历史头像；只有人工诊断会再次探测。</div>':''}<div class="ac32-diagnostic-list" style="margin-top:9px">${avatarDiagnosticRows(avatar)}</div>`:'<div class="ac32-empty ui-empty-state-fill"><b>尚未采集头像专项证据</b><p>该诊断会使用本机设备签名真实请求生产 Worker，但不会写入头像、不会改数据库，也不会导出 Token、Cookie、完整 PSID 或凭据。</p></div>'}</div></article>${facebookAvatarImportMarkup(account)}` : '';
  return `<div class="ac32-grid">${baseMarkup}${facebook}</div>`;
}

function accountAuditActionLabel(action = '') {
  return ({
    'account-diagnosed': '账号诊断完成',
    'account-connect': '账号连接完成',
    'account-updated': '账号资料已更新',
    'facebook-avatar-closure-diagnosed': 'Facebook 头像专项诊断完成',
    'facebook-business-suite-avatar-import-session-started': 'Facebook 网页伴侣窗口已开启',
    'facebook-business-suite-avatar-import-session-stopped': 'Facebook 网页伴侣窗口已关闭',
    'facebook-business-suite-avatar-import-completed': 'Facebook 网页伴侣头像补全完成',
    'facebook-web-companion-preview-completed': 'Facebook 网页伴侣对账预览完成',
    'account-reconnect': '账号重新连接',
    'account-logout': '账号已退出',
    'account-created': '账号已创建',
    'account-deleted': '账号已删除'
  })[action] || action || '账号操作';
}
function accountAuditSummary(row = {}, account = {}) {
  const detail = row.detail || {};
  if (row.action === 'account-diagnosed') return `健康状态：${detail.health || '已完成'} · 通过 ${detail.pass ?? 0} · 需处理 ${detail.fail ?? 0}`;
  if (row.action === 'account-connect' || row.action === 'account-reconnect') return `连接结果：${detail.resultState || detail.state || '已完成'} · ${platformInfo(detail.platform || account.platform).label}`;
  if (row.action === 'account-updated') return `更新内容：${Array.isArray(detail.fields) ? detail.fields.join('、') : '账号资料'}`;
  if (row.action === 'facebook-avatar-closure-diagnosed') return `扫描会话 ${detail.conversationsScanned ?? 0} · 身份解析 ${detail.identityResolved ?? 0} · Worker 返回头像 ${detail.workerAvatarReady ?? 0} · 完整通过 ${detail.fullyReady ?? 0}`;
  if (row.action === 'facebook-business-suite-avatar-import-completed') return `导入 ${detail.imported ?? 0} · 跳过 ${detail.skipped ?? 0} · 失败 ${detail.failed ?? 0}`;
  if (row.action === 'facebook-web-companion-preview-completed') return `扫描 ${detail.scanned ?? 0} · 新增头像 ${detail.new ?? 0} · 头像变化 ${detail.changed ?? 0} · 潜在新会话 ${detail.potentialNewConversations ?? 0} · 消息摘要差异 ${detail.messagePreviewDifferences ?? 0}`;
  return `${account.displayName || platformInfo(account.platform).label} · 操作已记录`;
}
function renderHistory(account) {
  const rows = (state.data.audit || []).filter(row => !row.detail?.accountId || row.detail.accountId === account.id);
  return `<div class="ac32-grid"><article class="ac32-section wide"><header><h3>账号操作审计</h3><span>最近 ${htmlText(rows.length)} 条</span></header><div class="ac32-section-body"><div class="ac32-history">${rows.length?rows.map(row=>`<article class="ac32-history-row"><div><b>${htmlText(accountAuditActionLabel(row.action))}</b><p>${htmlText(accountAuditSummary(row, account))}</p><details class="ac32-technical-details"><summary>查看技术详情</summary><pre>${htmlText(JSON.stringify(row.detail||{}, null, 2))}</pre></details></div><time>${htmlText(fmtDate(row.at))}</time></article>`).join(''):'<div class="ac32-empty ui-empty-state-fill"><b>暂无操作记录</b><p>添加、授权、重连、默认账号切换、暂停、退出和会话绑定都会留下审计记录。</p></div>'}</div></div></article></div>`;
}

function renderMigration() {
  const plan = state.migrationPlan;
  const candidates = plan?.candidates || [];
  const platformName = value => platformInfo(value).label;
  return `<div class="ac32-grid">
    <article class="ac32-section wide"><header><h3>旧版本账号迁移</h3><span>先扫描、预览、备份，再确认导入</span></header><div class="ac32-section-body">
      <div class="ac32-hint warn">旧版本目录只读扫描，不会被删除或改写。WhatsApp会话凭据复制到新的隔离目录；Telegram和Facebook只迁移账号元数据，敏感凭据必须重新写入Windows安全存储。</div>
      <div class="ac32-migration-path"><input id="ac32MigrationPath" value="${htmlAttr(state.migrationPath || '')}" placeholder="选择早期言策或其他旧版本数据目录"><button class="ac32-button" id="ac32ChooseMigrationDir">选择目录</button><button class="ac32-button primary" id="ac32ScanMigration">扫描旧账号</button></div>
    </div></article>
    ${plan ? `<article class="ac32-section wide"><header><h3>迁移预览</h3><span>扫描 ${htmlText(plan.scannedFiles || 0)} 个文件 · 发现 ${htmlText(candidates.length)} 个候选账号</span></header><div class="ac32-section-body">
      <div class="ac32-migration-warnings">${(plan.warnings||[]).map(text=>`<p>• ${htmlText(text)}</p>`).join('')}</div>
      <div class="ac32-migration-list">${candidates.length ? candidates.map(row=>`<label class="ac32-migration-row"><input type="checkbox" data-migration-id="${htmlAttr(row.id)}" checked><i class="ac32-platform-icon ${htmlAttr(platformInfo(row.platform).accent)}">${htmlText(platformInfo(row.platform).icon)}</i><span><b>${htmlText(row.displayName)}</b><p>${htmlText(platformName(row.platform))} · ${htmlText(row.identityHint)} · ${htmlText(row.requiresSecureReentry?'需要重新输入安全凭据':'可迁移隔离会话凭据')}</p></span><em>${htmlText(row.canMigrateCredential?'可复制会话':'仅元数据')}</em></label>`).join('') : '<div class="ac32-empty ui-empty-state-fill"><b>没有找到可迁移账号</b><p>请确认选择的是旧版本数据目录，而不是安装程序或压缩包。</p></div>'}</div>
      ${candidates.length?'<div class="ac32-migration-actions"><button class="ac32-button" id="ac32ClearMigration">清除预览</button><button class="ac32-button primary" id="ac32ImportMigration">创建备份并导入选中账号</button></div>':''}
    </div></article>` : `<article class="ac32-section"><header><h3>迁移安全规则</h3><span>默认不破坏</span></header><div class="ac32-section-body"><div class="ac32-action-list"><article class="ac32-action-row"><i>1</i><div><b>只读扫描旧目录</b><p>识别平台、会话目录和元数据，不回写旧版本。</p></div><em>安全</em></article><article class="ac32-action-row"><i>2</i><div><b>导入前自动备份</b><p>新工作区先创建恢复点，再写入账号元数据。</p></div><em>可恢复</em></article><article class="ac32-action-row"><i>3</i><div><b>密钥重新安全录入</b><p>普通JSON中的Telegram和Facebook密钥不会直接搬运。</p></div><em>隔离</em></article></div></div></article>
    <article class="ac32-section"><header><h3>重复账号保护</h3><span>按来源追踪</span></header><div class="ac32-section-body"><div class="ac32-hint">已经迁移过的来源会被识别并跳过。导入后账号仍显示“待验证”，只有真实连接成功才会进入生产路由。</div></div></article>`}
  </div>`;
}

function bindPanel(account) {
  document.querySelectorAll('[data-panel-action]').forEach(button => button.onclick = () => panelAction(button.dataset.panelAction, account));
  document.getElementById('ac32ChooseMigrationDir')?.addEventListener('click', chooseMigrationDirectory);
  document.getElementById('ac32ScanMigration')?.addEventListener('click', scanLegacyAccounts);
  document.getElementById('ac32ImportMigration')?.addEventListener('click', importLegacyAccounts);
  document.getElementById('ac32ClearMigration')?.addEventListener('click', () => { state.migrationPlan = null; renderPanel(account); });
  document.getElementById('ac32MigrationPath')?.addEventListener('input', event => { state.migrationPath = event.target.value; saveLocal(); });
  document.querySelectorAll('[data-facebook-page]').forEach(button => button.addEventListener('click', () => selectFacebookPage(account, button.dataset.facebookPage)));
}


async function chooseMigrationDirectory() {
  if (!window.yanceDesktop?.selectDirectory) return toast('请在Electron桌面版中选择旧版本目录', 'warning');
  const selected = await window.yanceDesktop.selectDirectory();
  if (!selected) return;
  state.migrationPath = selected;
  saveLocal();
  const input = document.getElementById('ac32MigrationPath');
  if (input) input.value = selected;
}
async function scanLegacyAccounts() {
  const sourceDir = document.getElementById('ac32MigrationPath')?.value.trim() || state.migrationPath;
  if (!sourceDir) return toast('请先选择旧版本数据目录', 'warning');
  try {
    toast('正在只读扫描旧版本账号…', 'warning');
    const data = await api('/migration/scan', { method:'POST', body:{ sourceDir } });
    state.migrationPath = sourceDir;
    state.migrationPlan = data.plan;
    saveLocal();
    renderPanel(accountById());
    toast(`扫描完成，发现 ${data.plan.candidates.length} 个候选账号`);
  } catch (error) { toast(error.message, 'error'); }
}
async function importLegacyAccounts() {
  const plan = state.migrationPlan;
  if (!plan) return toast('请先扫描旧版本账号', 'warning');
  const selectedIds = [...document.querySelectorAll('[data-migration-id]:checked')].map(node => node.dataset.migrationId);
  if (!selectedIds.length) return toast('请至少选择一个候选账号', 'warning');
  if (!await window.YanceDialogs.confirm({ title: '导入旧版本账号', message: `将创建恢复点并导入 ${selectedIds.length} 个账号。旧版本目录不会被修改，是否继续？`, submitLabel: '创建恢复点并导入' })) return;
  try {
    toast('正在创建备份并迁移账号…', 'warning');
    const result = await api('/migration/import', { method:'POST', body:{ confirmToken:plan.confirmToken, selectedIds } });
    state.migrationPlan = null;
    await refreshAccounts(false);
    state.tab = 'history';
    renderWorkbench();
    toast(`迁移完成：导入 ${result.imported.length}，跳过 ${result.skipped.length}`, result.skipped.length?'warning':'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function accountAction(action, account) {
  if (action === 'diagnose') return runDiagnostics(account);
  if (action === 'reconnect') {
    if (!ensureAccountAuthAllowed(account, '重新连接平台账号')) return;
    clearAuthNotice(account.id);
    return mutate(`/`+encodeURIComponent(account.id)+'/reconnect', 'POST', {}, '正在重新连接…');
  }
  if (action === 'resume') return mutate(`/`+encodeURIComponent(account.id)+'/resume', 'POST', {}, '正在恢复账号…');
  if (action === 'open-conversations') return openConversations(account);
}

async function panelAction(action, account) {
  if (action === 'open-safe-mode-recovery') return openSafeModeRecovery();
  if (action === 'dismiss-auth-notice') { clearAuthNotice(account?.id); return renderWorkbench(); }
  if (action === 'edit') return openAccountDialog(account, false);
  if (action === 'credentials') return openAccountDialog(account, true);
  if (action === 'connect') return connectAccount(account);
  if (action === 'diagnose') return runDiagnostics(account);
  if (action === 'default') return mutate(`/${encodeURIComponent(account.id)}/default`, 'POST', {}, '正在设置默认发送账号…');
  if (action === 'pause') return account.state === 'paused' ? mutate(`/${encodeURIComponent(account.id)}/resume`, 'POST', {}, '正在恢复账号…') : mutate(`/${encodeURIComponent(account.id)}/pause`, 'POST', {}, '正在暂停账号…');
  if (action === 'logout') return logoutAccount(account);
  if (action === 'delete') return deleteAccount(account);
  if (action === 'submit-code') return submitTelegramCode(account);
  if (action === 'submit-password') return submitTelegramPassword(account);
  if (action === 'telegram-qr') return startTelegramQr(account);
  if (action === 'telegram-phone') return startTelegramPhone(account);
  if (action === 'telegram-cancel') return cancelTelegramLogin(account);
  if (action === 'facebook-oauth') return startFacebookOAuth(account);
  if (action === 'facebook-messenger-start') return startFacebookMessengerLogin(account);
  if (action === 'facebook-messenger-submit') return submitFacebookMessengerStep(account);
  if (action === 'facebook-messenger-wait') return waitFacebookMessengerStep(account);
  if (action === 'facebook-messenger-cancel') return cancelFacebookMessengerLogin(account);
  if (action === 'facebook-cancel') return cancelFacebookOAuth(account);
  if (action === 'facebook-sync-now') return mutate(`/${encodeURIComponent(account.id)}/sync`, 'POST', {}, '正在读取 Meta Business Suite 最近会话并执行对账…');
  if (action === 'facebook-avatar-diagnose') return runFacebookAvatarDiagnostics(account);
  if (action === 'facebook-avatar-export') return exportFacebookAvatarDiagnostics(account);
  if (action === 'facebook-avatar-import-start') return startFacebookAvatarImportSession(account);
  if (action === 'facebook-avatar-import-refresh') return refreshFacebookAvatarImportSession(account, true);
  if (action === 'facebook-avatar-import-stop') return stopFacebookAvatarImportSession(account);
  if (action === 'save-notifications') return saveNotificationSettings(account);
  if (action === 'test-notification') return testNotification(account);
}

async function mutate(path, method, body, pending) {
  try { toast(pending, 'warning'); await api(path, { method, body }); await refreshAccounts(false); toast('操作完成'); }
  catch (error) { toast(error.message, 'error'); }
}

async function discardPendingAuthorization(accountId, reason) {
  if (!accountId) return false;
  try {
    const result = await api(`/${encodeURIComponent(accountId)}/authorization/discard-pending`, {
      method:'POST', body:{ reason: String(reason || 'authorization-abandoned') }
    });
    if (result.removed) {
      if (state.selectedId === accountId) state.selectedId = '';
      delete state.qrChallenges[accountId];
      await refreshAccounts(false);
      return true;
    }
  } catch (error) {
    if (error?.code !== 'ACCOUNT_NOT_FOUND') console.warn('[Yance pending authorization cleanup]', error.message || error);
  }
  return false;
}

function completeQrAuthorization(account, platform = '') {
  if (!account?.id || !['connected','limited'].includes(String(account.state || ''))) return false;
  const label = platform === 'telegram' || account.platform === 'telegram' ? 'Telegram' : 'WhatsApp';
  state.awaitingQrAccountId = '';
  state.qrPollTokens = state.qrPollTokens && typeof state.qrPollTokens === 'object' ? state.qrPollTokens : {};
  state.qrPollTokens[account.id] = Number(state.qrPollTokens[account.id] || 0) + 1;
  delete state.qrChallenges[account.id];
  clearAuthNotice(account.id);
  const dialog = document.getElementById('ac32DetailDialog');
  if (dialog?.open && (!dialog.dataset.authAccountId || dialog.dataset.authAccountId === account.id)) {
    const body = document.getElementById('ac32DetailDialogBody');
    if (body) body.innerHTML = `<div class="ac32-auth-success"><i>✓</i><b>${htmlText(label)} 关联成功</b><p>正在同步账号、联系人和最近会话。此窗口将自动关闭。</p></div>`;
    setTimeout(() => { if (dialog.open) dialog.close(); }, 900);
  }
  state.tab = 'overview';
  toast(`${label} 已关联成功，正在同步`, 'success');
  return true;
}

function reconcileAuthorizationCompletion(accounts = state.data.accounts || []) {
  for (const account of accounts) {
    const pending = state.awaitingQrAccountId === account.id || Boolean(state.qrChallenges?.[account.id]);
    if (pending && ['connected','limited'].includes(String(account.state || ''))) completeQrAuthorization(account, account.platform);
  }
}

async function pollAuthChallenge(accountId, platform, timeoutMs = 30000) {
  state.qrPollTokens = state.qrPollTokens && typeof state.qrPollTokens === 'object' ? state.qrPollTokens : {};
  const token = Number(state.qrPollTokens[accountId] || 0) + 1;
  state.qrPollTokens[accountId] = token;
  const started = Date.now();
  while (token === state.qrPollTokens[accountId] && Date.now() - started < timeoutMs) {
    try {
      const [challengeData, runtimeData] = await Promise.all([
        api(`/${encodeURIComponent(accountId)}/auth-challenge`),
        api(`/${encodeURIComponent(accountId)}/runtime`)
      ]);
      const challenge = challengeData.challenge;
      const account = runtimeData.account;
      if (challenge?.dataUrl) {
        state.tab = 'login';
        const previous = state.qrChallenges[accountId];
        state.qrChallenges[accountId] = challenge;
        clearAuthNotice(accountId);
        if (!previous || previous.dataUrl !== challenge.dataUrl) showQr(challenge.dataUrl, accountId, challenge, platform);
        renderWorkbench();
      }
      if (account && ['connected','limited'].includes(account.state)) {
        completeQrAuthorization(account, platform);
        await refreshAccounts(false);
        renderWorkbench();
        return true;
      }
      if (platform === 'telegram' && ['password','code'].includes(account?.step)) {
        state.awaitingQrAccountId = '';
        delete state.qrChallenges[accountId];
        await refreshAccounts(false);
        return true;
      }
      const pollingDecision = window.YanceAccountAuthPollPolicy?.classify?.({
        account,
        accountId,
        platform,
        awaitingQrAccountId: state.awaitingQrAccountId
      }) || { decision: 'continue' };
      if (pollingDecision.decision === 'stop') return false;
    } catch (error) {
      if (error?.code === 'ACCOUNT_NOT_FOUND' || error?.code === 'AUTH_CHALLENGE_UNSUPPORTED') return false;
    }
    const elapsed = Date.now() - started;
    const delayMs = elapsed < 5000 ? 900 : elapsed < 15000 ? 1400 : 2200;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  if (state.awaitingQrAccountId === accountId) {
    state.awaitingQrAccountId = '';
    renderWorkbench();
  }
  return false;
}

async function connectAccount(account) {
  if (!ensureAccountAuthAllowed(account, '生成 WhatsApp 登录二维码')) return;
  clearAuthNotice(account.id);
  let qrPoll = null;
  try {
    toast('正在调用真实平台连接…', 'warning');
    if (account.platform === 'whatsapp') {
      state.awaitingQrAccountId = account.id;
      state.tab = 'login';
      renderWorkbench();
      qrPoll = new Promise(resolve => setTimeout(resolve, 180)).then(() => pollAuthChallenge(account.id, 'whatsapp', 45000));
    }
    const data = await api(`/${encodeURIComponent(account.id)}/connect`, { method:'POST', body:{}, timeoutMs:60000 });
    await refreshAccounts(false);
    const updated = data.account || accountById(account.id);
    if (account.platform === 'whatsapp' && !['connected','limited'].includes(updated?.state)) {
      qrPoll.then(async found => {
        if (!found) {
          await discardPendingAuthorization(account.id, 'whatsapp-qr-timeout');
          const message = updated?.lastError || 'WhatsApp 未生成二维码。连接已停止，请检查网络后点击重试。临时授权账号已清理。';
          setAuthNotice(account, message, 'error');
          toast(message, 'error');
        }
      });
    }
    if (updated?.step === 'code') { state.tab = 'login'; renderWorkbench(); toast('Telegram验证码已发送', 'warning'); }
    else if (updated?.step === 'password') { state.tab = 'login'; renderWorkbench(); toast('请输入Telegram两步验证密码', 'warning'); }
    else toast(`账号状态：${updated?.stateLabel || '已更新'}`);
  } catch (error) {
    if (account.platform === 'whatsapp') {
      (qrPoll || pollAuthChallenge(account.id, 'whatsapp', 45000)).then(async found => {
        if (!found) {
          state.awaitingQrAccountId = '';
          await discardPendingAuthorization(account.id, error?.code || 'whatsapp-connect-failed');
          renderWorkbench();
        }
      });
    } else {
      state.awaitingQrAccountId = '';
    }
    setAuthNotice(account, error.message, safeModeError(error) ? 'warning' : 'error', { showRecovery: safeModeError(error) });
    toast(error.message, 'error');
  }
}

async function runDiagnostics(account) {
  try {
    toast('正在运行真实账号诊断…', 'warning');
    const data = await api(`/${encodeURIComponent(account.id)}/diagnose`, { method:'POST', body:{} });
    state.diagnostics[account.id] = data.report;
    state.tab = 'diagnostics';
    await refreshAccounts(false);
    renderWorkbench();
    toast(`诊断完成：${data.report.health}`, data.report.fail ? 'warning' : 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function runFacebookAvatarDiagnostics(account) {
  try {
    toast('正在真实请求 Facebook Worker 并检查本地头像链路…', 'warning');
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/avatar-closure/diagnose`, { method:'POST', body:{ limit:2 }, timeoutMs:300000 });
    state.avatarDiagnostics[account.id] = data.report;
    state.tab = 'diagnostics';
    renderWorkbench();
    const summary = data.report?.summary || {};
    toast(`头像诊断完成：完整通过 ${summary.fullyReady||0}/${summary.conversationsScanned||0}`, summary.fullyReady===summary.conversationsScanned&&summary.conversationsScanned?'success':'warning');
  } catch (error) { toast(error.message, 'error'); }
}
function exportFacebookAvatarDiagnostics(account) {
  const report = state.avatarDiagnostics[account.id];
  if (!report) return toast('请先运行 Facebook 头像专项诊断', 'warning');
  const blob = new Blob([JSON.stringify(report,null,2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  setUrlAttribute(link,'href',url,{allowBlob:true,allowRelative:false});
  link.download = `Yance-Facebook-Avatar-Closure-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  link.style.display='none'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Facebook 头像专项证据已导出');
}

async function refreshFacebookAvatarImportSession(account, rerender = false) {
  if (!account || account.platform !== 'facebook') return null;
  state.avatarImportStatusLoading ||= {};
  if (state.avatarImportStatusLoading[account.id]) return state.avatarImportSessions?.[account.id] || null;
  state.avatarImportStatusLoading[account.id] = true;
  try {
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/avatar-import/session`);
    state.avatarImportSessions ||= {};
    state.avatarImportSessions[account.id] = data.session || { active:false };
    if (rerender && state.view && state.selectedId === account.id && state.tab === 'diagnostics') renderPanel(accountById(account.id) || account);
    return data.session;
  } catch (error) {
    if (rerender) toast(error.message || '读取 Facebook 网页伴侣状态失败', 'error');
    return null;
  } finally { state.avatarImportStatusLoading[account.id] = false; }
}
async function startFacebookAvatarImportSession(account) {
  try {
    toast('正在开启 10 分钟 Facebook 网页伴侣窗口…', 'warning');
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/avatar-import/session`, { method:'POST', body:{} });
    state.avatarImportSessions ||= {};
    state.avatarImportSessions[account.id] = data.session;
    renderPanel(account);
    toast('网页伴侣已开启，请到 Business Suite 点击“言策网页伴侣”');
  } catch (error) { toast(error.message || '开启导入窗口失败', 'error'); }
}
async function stopFacebookAvatarImportSession(account) {
  try {
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/avatar-import/session/stop`, { method:'POST', body:{} });
    state.avatarImportSessions ||= {};
    state.avatarImportSessions[account.id] = data.session || { active:false };
    renderPanel(account);
    toast('Facebook 网页伴侣窗口已关闭');
  } catch (error) { toast(error.message || '关闭导入窗口失败', 'error'); }
}

async function startTelegramQr(account) {
  if (!ensureAccountAuthAllowed(account, '生成 Telegram 登录二维码')) return;
  clearAuthNotice(account.id);
  try {
    toast('正在生成 Telegram 登录二维码…', 'warning');
    state.awaitingQrAccountId = account.id;
    delete state.qrChallenges[account.id];
    state.tab = 'login';
    renderWorkbench();
    await api(`/${encodeURIComponent(account.id)}/telegram/qr/start`, { method:'POST', body:{} });
    await refreshAccounts(false);
    const found = await pollAuthChallenge(account.id, 'telegram');
    if (found) toast('请使用已登录的 Telegram 手机应用扫描二维码');
    else {
      await discardPendingAuthorization(account.id, 'telegram-qr-timeout');
      if (state.awaitingQrAccountId === account.id) {
        const message = '尚未取得 Telegram 二维码，临时授权已清理，请查看账号诊断与连接日志。';
        setAuthNotice(account, message, 'warning');
        toast(message, 'warning');
      }
    }
  } catch (error) {
    state.awaitingQrAccountId = '';
    await discardPendingAuthorization(account.id, error?.code || 'telegram-qr-failed');
    setAuthNotice(account, error.message, safeModeError(error) ? 'warning' : 'error', { showRecovery: safeModeError(error) });
    toast(error.message, 'error');
  }
}
async function startTelegramPhone(account) {
  if (!ensureAccountAuthAllowed(account, '发送 Telegram 登录验证码')) return;
  clearAuthNotice(account.id);
  const phoneNumber = document.getElementById('ac32TelegramPhone')?.value.trim() || '';
  if (!phoneNumber) return toast('请输入 Telegram 手机号', 'warning');
  try {
    toast('正在发送 Telegram 验证码…', 'warning');
    await api(`/${encodeURIComponent(account.id)}/telegram/phone/start`, { method:'POST', body:{ phoneNumber } });
    await refreshAccounts(false); state.tab='login'; renderWorkbench();
  } catch (error) { toast(error.message, 'error'); }
}
async function cancelTelegramLogin(account) {
  await mutate(`/${encodeURIComponent(account.id)}/telegram/cancel`, 'POST', {}, '正在取消 Telegram 登录…');
}
function facebookMessengerFlowIds(flow = state.facebookFlow || {}) {
  const step = flow?.step || flow || {};
  return {
    loginProcessId: String(flow?.login_id || flow?.loginId || flow?.login_process_id || flow?.loginProcessId || step?.login_id || step?.loginId || step?.login_process_id || step?.loginProcessId || '').trim(),
    stepId: String(step?.step_id || step?.stepId || flow?.step_id || flow?.stepId || '').trim(),
    txnId: String(step?.txn_id || step?.txnId || flow?.txn_id || flow?.txnId || '').trim()
  };
}
async function startFacebookMessengerLogin(account) {
  if (!ensureAccountAuthAllowed(account, '启动 Facebook Personal Messenger 登录')) return;
  clearAuthNotice(account.id);
  try {
    toast('正在启动 mautrix/meta messenger-lite 登录…', 'warning');
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/messenger/start`, { method:'POST', body:{} });
    state.facebookFlow = { accountId: account.id, mode:'personal-messenger', ...(data.flow||{}) };
    state.tab='login'; await refreshAccounts(false); renderWorkbench();
  } catch (error) { setAuthNotice(account,error.message,safeModeError(error)?'warning':'error',{showRecovery:safeModeError(error)}); toast(error.message,'error'); }
}
async function submitFacebookMessengerStep(account) {
  const { loginProcessId, stepId, txnId } = facebookMessengerFlowIds();
  if (!loginProcessId || !stepId) return toast('当前 mautrix/meta 登录步骤缺少 continuation 标识，请重新开始登录。','error');
  const input = {};
  document.querySelectorAll('[data-facebook-messenger-field]').forEach(node => { input[node.dataset.facebookMessengerField] = node.value; });
  try {
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/messenger/input`, { method:'POST', body:{ loginProcessId, stepId, txnId, input } });
    state.facebookFlow = data.completed ? null : { accountId:account.id, mode:'personal-messenger', ...(data.flow||{}) };
    await refreshAccounts(false); state.tab='login'; renderWorkbench(); toast(data.completed?'Facebook Personal Messenger 已连接':'已提交登录步骤');
  } catch(error) { toast(error.message,'error'); }
}
async function waitFacebookMessengerStep(account) {
  const { loginProcessId, stepId, txnId } = facebookMessengerFlowIds();
  if (!loginProcessId || !stepId) return toast('当前 mautrix/meta 等待步骤缺少 continuation 标识。','error');
  try {
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/messenger/wait`, { method:'POST', body:{ loginProcessId, stepId, txnId } });
    state.facebookFlow = { accountId:account.id, mode:'personal-messenger', ...(data.flow||{}) };
    await refreshAccounts(false); state.tab='login'; renderWorkbench();
  } catch(error) { toast(error.message,'error'); }
}
async function cancelFacebookMessengerLogin(account) {
  const { loginProcessId } = facebookMessengerFlowIds();
  let data;
  try { data = await api(`/${encodeURIComponent(account.id)}/facebook/messenger/cancel`, { method:'POST', body:{ loginProcessId } }); } catch(error) { toast(error.message,'error'); return; }
  state.facebookFlow=null; if (!data?.removed) await discardPendingAuthorization(account.id,'facebook-messenger-cancelled'); await refreshAccounts(false); state.tab='login'; renderWorkbench(); toast('已取消 Facebook Personal Messenger 登录');
}

async function startFacebookOAuth(account) {
  const type = facebookAccountType(account.accountKind || account.driverId);
  if (!ensureAccountAuthAllowed(account, type.accountKind === 'personal-identity' ? '启动 Facebook 个人身份授权' : '启动 Facebook 公共主页授权')) return;
  clearAuthNotice(account.id);
  try {
    toast(type.accountKind === 'personal-identity' ? '正在打开官方 Facebook Login 读取个人身份…' : '正在打开系统浏览器完成 Facebook 公共主页授权…', 'warning');
    const data = await api(`/${encodeURIComponent(account.id)}/facebook/oauth/start`, { method:'POST', body:{} });
    state.facebookFlow = { accountId: account.id, mode: data.flow?.mode || (type.accountKind === 'personal-identity' ? 'identity' : 'page'), ...data.flow, pages: [] };
    state.tab = 'login'; renderWorkbench();
    if (!window.yanceDesktop?.openAuthUrl) throw new Error('当前桌面桥不支持打开安全授权页面');
    await window.yanceDesktop.openAuthUrl(data.flow.authorizationUrl, 'facebook');
    pollFacebookOAuth(account, data.flow.flowId);
  } catch (error) {
    setAuthNotice(account, error.message, safeModeError(error) ? 'warning' : 'error', { showRecovery: safeModeError(error) });
    toast(error.message, 'error');
  }
}
async function pollFacebookOAuth(account, flowId) {
  const token = ++state.authPollToken;
  const started = Date.now();
  const maximumWaitMs = 30 * 60 * 1000;
  while (token === state.authPollToken && Date.now() - started < maximumWaitMs) {
    try {
      const data = await api(`/${encodeURIComponent(account.id)}/facebook/oauth/status?flowId=${encodeURIComponent(flowId)}`);
      state.facebookFlow = { accountId: account.id, flowId, ...data.flow };
      renderWorkbench();
      if (data.flow.status === 'completed' && data.flow.mode === 'identity') {
        state.authPollToken += 1;
        state.facebookFlow = null;
        await refreshAccounts(false);
        state.tab = 'login';
        renderWorkbench();
        toast('Facebook 个人身份登录完成。该账号只提供身份与头像，不提供 Messenger 私信。');
        return;
      }
      if (data.flow.status === 'authorized') { toast('授权完成，请选择要连接的公共主页'); return; }
      if (['denied','error','cancelled'].includes(data.flow.status)) {
        await cancelFacebookOAuth(account, { silent:true, reason:`facebook-oauth-${data.flow.status}` });
        toast(data.flow.error || 'Facebook 授权未完成，临时授权已清理', 'error');
        return;
      }
    } catch (error) {
      const code = String(error?.reasonCode || error?.code || '').toUpperCase();
      if (code === 'FACEBOOK_OAUTH_FLOW_NOT_FOUND') {
        // The secured start command and first status probe can cross desktop runtime contexts.
        // Preserve the issued flow and let the normal backoff continue through its callback TTL.
      } else if (code !== 'REQUEST_FAILED') toast(error.message, 'warning');
    }
    const elapsed = Date.now() - started;
    const delayMs = elapsed < 15000 ? 1300 : elapsed < 60000 ? 2500 : 5000;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  if (token === state.authPollToken) {
    state.authPollToken += 1;
    await cancelFacebookOAuth(account, { silent:true, reason:'facebook-oauth-timeout' });
    toast('浏览器未返回 Facebook 授权结果。请确认授权页是否已完成；若回调失败，言策会显示 /me/accounts 与 target_ids 的安全诊断。不要反复修改 App Domains。', 'error');
  }
}
async function selectFacebookPage(account, pageId) {
  const flowId = state.facebookFlow?.flowId;
  if (!flowId) return toast('授权流程已过期，请重新开始', 'warning');
  try {
    toast('正在保存公共主页授权…', 'warning');
    await api(`/${encodeURIComponent(account.id)}/facebook/oauth/select-page`, { method:'POST', body:{ flowId, pageId } });
    state.authPollToken += 1; state.facebookFlow = null;
    await refreshAccounts(false); state.tab='login'; renderWorkbench(); toast('Facebook 公共主页已连接');
  } catch (error) { toast(error.message, 'error'); }
}
async function cancelFacebookOAuth(account, options = {}) {
  const flowId = state.facebookFlow?.flowId;
  state.authPollToken += 1;
  let cancelledByBackend = false;
  if (flowId) {
    cancelledByBackend = await api(`/${encodeURIComponent(account.id)}/facebook/oauth/cancel`, { method:'POST', body:{ flowId } })
      .then(() => true)
      .catch(() => false);
  }
  if (!cancelledByBackend) await discardPendingAuthorization(account.id, options.reason || 'facebook-oauth-cancelled');
  state.facebookFlow = null;
  await refreshAccounts(false).catch(()=>{});
  renderWorkbench();
  if (!options.silent) toast('已取消 Facebook 授权');
}

async function submitTelegramCode(account) {
  const code = document.getElementById('ac32TelegramCode')?.value.trim();
  if (!code) return toast('请输入Telegram验证码', 'warning');
  try {
    toast('正在验证 Telegram 验证码…', 'warning');
    await api(`/${encodeURIComponent(account.id)}/telegram/code`, { method:'POST', body:{ code } });
    await refreshAccounts(false);
    const updated = accountById(account.id);
    if (!completeQrAuthorization(updated, 'telegram')) { state.tab='login'; renderWorkbench(); }
  } catch (error) { toast(error.message, 'error'); }
}
async function submitTelegramPassword(account) {
  const password = document.getElementById('ac32TelegramPassword')?.value || '';
  if (!password) return toast('请输入两步验证密码', 'warning');
  try {
    toast('正在验证 Telegram 两步密码…', 'warning');
    await api(`/${encodeURIComponent(account.id)}/telegram/password`, { method:'POST', body:{ password } });
    await refreshAccounts(false);
    const updated = accountById(account.id);
    if (!completeQrAuthorization(updated, 'telegram')) { state.tab='login'; renderWorkbench(); }
  } catch (error) { toast(error.message, 'error'); }
}
async function saveNotificationSettings(account) {
  const notificationsEnabled = document.getElementById('ac32NotifyEnabled')?.value === 'true';
  const autoReconnect = document.getElementById('ac32AutoReconnect')?.value === 'true';
  await mutate(`/${encodeURIComponent(account.id)}`, 'PATCH', { notificationsEnabled, autoReconnect }, '正在保存账号设置…');
}
async function testNotification(account) {
  try {
    await fetch('/api/r32/system/desktop/notify-test', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ title:`${platformInfo(account.platform).label} · ${account.displayName}`, body:'统一账号中心通知定位测试。', accountId:account.id }) });
    toast('测试通知已触发');
  } catch (error) { toast(error.message, 'error'); }
}
async function logoutAccount(account) {
  if (!await window.YanceDialogs.confirm({ title: '退出账号', message: `确定退出“${account.displayName}”吗？聊天与客户档案会保留，只清除当前登录会话。`, submitLabel: '退出登录' })) return;
  await mutate(`/${encodeURIComponent(account.id)}/logout`, 'POST', {}, '正在安全退出账号…');
}
async function deleteAccount(account) {
  if (!await window.YanceDialogs.confirm({ title: '删除账号绑定', message: `确定删除“${account.displayName}”吗？此操作不会删除统一联系人和客户档案，但会移除账号绑定。`, danger: true, submitLabel: '删除账号' })) return;
  const clearCredentials = await window.YanceDialogs.confirm({ title: '同时删除安全凭据', message: '是否同时从 Windows 安全存储中删除该账号凭据？不删除时，凭据仍由系统加密保存。', submitLabel: '同时删除', cancelLabel: '保留凭据' });
  try {
    await api(`/${encodeURIComponent(account.id)}`, { method:'DELETE', body:{ confirm:account.id, clearCredentials, logout:true } });
    if (clearCredentials && window.yanceDesktop?.deleteCredential) await window.yanceDesktop.deleteCredential(account.credentialRef).catch(()=>{});
    state.selectedId = ''; await refreshAccounts(false); toast('账号已删除');
  } catch (error) { toast(error.message, 'error'); }
}

function openConversations(account) {
  leaveAccountCenter();
  const y = window.__Y27;
  if (y?.openConversationPage) y.openConversationPage(undefined, false);
  document.getElementById('navConversation')?.classList.add('active');
  toast(`已进入会话中心，来源筛选：${account.displayName}`);
}

function accountForm(account, credentialsOnly = false) {
  if (credentialsOnly) {
    return '<div class="ac32-hint bad">平台级发行设置不属于普通用户操作。请返回账号登录页面。</div>';
  }
  if (account) {
    const type = account.platform === 'facebook' ? facebookAccountType(account.accountKind || account.driverId) : null;
    return `<div class="ac32-form"><label>账号显示名称<input id="ac32FormName" value="${htmlAttr(account.displayName || platformInfo(account.platform).label)}" placeholder="例如：我的 WhatsApp"></label><label>备注<input id="ac32FormIdentity" value="${htmlAttr(account.identityLabel || '')}" placeholder="登录后会自动更新，可留空"></label></div>${type?`<div class="ac32-hint" style="margin-top:10px">账号类型：${htmlText(type.label)}。账号类型和驱动在创建后不可伪装切换。</div>`:'<div class="ac32-hint" style="margin-top:10px">平台身份和内部账号 ID 由系统自动维护，无需手工填写。</div>'}`;
  }
  const platform = 'whatsapp';
  const authConfig = state.data.platformAuth || {};
  return `<div class="ac32-form"><label>选择平台<select id="ac32FormPlatform">${Object.entries(PLATFORM).map(([id,row])=>{ const available = id === 'whatsapp' || authConfig[id]?.available === true; return `<option value="${htmlAttr(id)}" ${platform===id?'selected':''}>${htmlText(row.label)}${available?'':'（本安装包未启用）'}</option>`; }).join('')}</select></label></div><div id="ac32PlatformFields" style="margin-top:10px">${platformFields(platform)}</div>`;
}

function facebookTypeSelector(selected = 'page') {
  return `<div class="ac32-form"><label>Facebook 账号类型<select id="ac32FormFacebookKind">${Object.values(FACEBOOK_ACCOUNT_TYPES).map(row => `<option value="${htmlAttr(row.accountKind)}" ${row.accountKind===selected?'selected':''}>${htmlText(row.label)}</option>`).join('')}</select></label></div>`;
}

function platformFields(platform, facebookKind = 'page') {
  const authConfig = state.data.platformAuth || {};
  if (platform === 'whatsapp') return '<div class="ac32-hint">点击“显示二维码并连接”，然后用手机 WhatsApp 扫码。</div>';
  if (platform === 'telegram') return authConfig.telegram?.available === true
    ? '<div class="ac32-hint">可选择扫描二维码登录，也可使用手机号接收验证码。</div>'
    : '<div class="ac32-hint bad">当前安装包尚未启用 Telegram 登录。升级到已启用版本后即可扫码或使用手机号登录。</div>';
  const type = facebookAccountType(facebookKind);
  const contract = driverContract(type.driverId);
  let detail = '';
  if (type.accountKind === 'page') detail = '使用拥有公共主页管理权限的个人 Facebook 账号完成官方授权，随后选择需要连接的公共主页。';
  if (type.accountKind === 'personal-identity') detail = '使用官方 Facebook Login 读取个人身份、名称和头像。个人身份登录不提供 Messenger 私信读取或发送能力。';
  if (type.accountKind === 'personal-messenger') detail = '使用固定版本 mautrix/meta 的 messenger-lite 原生登录；Facebook 协议、挑战、会话恢复由上游持有，言策不保存 Facebook 密码。';
  const available = type.accountKind === 'personal-messenger' ? contract?.onboardingAvailable !== false : authConfig.facebook?.available === true && contract?.onboardingAvailable !== false;
  return `${facebookTypeSelector(type.accountKind)}<div class="ac32-hint">${htmlText(detail)}</div>${type.accountKind!=='personal-messenger'&&authConfig.facebook?.available!==true?`<div class="ac32-hint bad" style="margin-top:8px">当前安装包尚未启用 Facebook 登录。</div>`:''}`;
}

function bindFacebookKindSelector() {
  const select = document.getElementById('ac32FormFacebookKind');
  if (!select) return;
  select.addEventListener('change', event => {
    document.getElementById('ac32PlatformFields').innerHTML = platformFields('facebook', event.target.value);
    bindFacebookKindSelector();
    updateAccountDialogAction('facebook', false);
  });
}

function updateAccountDialogAction(platform, editing = false) {
  const button = document.getElementById('ac32AccountSave');
  if (!button) return;
  if (editing) {
    button.disabled = false;
    button.textContent = '保存';
    return;
  }
  const authConfig = state.data.platformAuth || {};
  if (platform === 'facebook') {
    const type = selectedFacebookType();
    const contract = driverContract(type.driverId);
    const available = type.accountKind === 'personal-messenger' ? contract?.onboardingAvailable !== false : authConfig.facebook?.available === true && contract?.onboardingAvailable !== false;
    button.disabled = !available;
    button.textContent = type.accountKind === 'page' ? (available ? '使用管理员账号授权主页' : 'Facebook 主页登录尚未启用')
      : type.accountKind === 'personal-identity' ? (available ? '使用官方 Facebook Login' : 'Facebook 身份登录尚未启用')
      : (available ? '创建并登录 Personal Messenger' : 'Personal Messenger 登录尚未启用');
    return;
  }
  const available = platform === 'whatsapp' || authConfig[platform]?.available === true;
  button.disabled = !available;
  button.textContent = platform === 'whatsapp' ? '显示二维码并连接' : platform === 'telegram' ? (available ? '扫描二维码登录' : 'Telegram 登录尚未启用') : '连接账号';
}

function openAccountDialog(account = null, credentialsOnly = false) {
  const dialog = document.getElementById('ac32AccountDialog');
  dialog.dataset.accountId = account?.id || '';
  dialog.dataset.credentialsOnly = credentialsOnly ? '1' : '0';
  setAccountDialogStatus('');
  setAccountDialogBusy(false);
  document.getElementById('ac32AccountDialogTitle').textContent = account ? (credentialsOnly ? '开发者配置不可用' : `修改账号名称 · ${account.displayName}`) : '连接平台账号';
  document.getElementById('ac32AccountDialogBody').innerHTML = accountForm(account, credentialsOnly);
  const select = document.getElementById('ac32FormPlatform');
  if (select) {
    select.addEventListener('change', event => {
      document.getElementById('ac32PlatformFields').innerHTML = platformFields(event.target.value);
      bindFacebookKindSelector();
      updateAccountDialogAction(event.target.value, false);
    });
    bindFacebookKindSelector();
    updateAccountDialogAction(select.value, false);
  } else {
    updateAccountDialogAction(account?.platform || '', Boolean(account) && !credentialsOnly);
    if (credentialsOnly) document.getElementById('ac32AccountSave').disabled = true;
  }
  dialog.showModal();
}

async function saveAccountDialog() {
  const dialog = document.getElementById('ac32AccountDialog');
  const existing = accountById(dialog.dataset.accountId);
  const credentialsOnly = dialog.dataset.credentialsOnly === '1';
  if (credentialsOnly) return setAccountDialogStatus('开发者配置已从普通界面移除。', 'warning');
  if (!ensureAccountAuthAllowed(existing, existing ? '保存账号修改' : '添加并连接账号', { dialog: true })) return;
  setAccountDialogStatus('');
  setAccountDialogBusy(true, existing ? '正在保存…' : '正在创建并连接…');
  try {
    if (existing) {
      const data = await api(`/${encodeURIComponent(existing.id)}`, { method:'PATCH', body:{
        displayName: document.getElementById('ac32FormName')?.value.trim() || existing.displayName,
        identityLabel: document.getElementById('ac32FormIdentity')?.value.trim() || existing.identityLabel
      }});
      dialog.close();
      state.selectedId = data.account.id;
      await refreshAccounts(false);
      toast('账号名称已保存');
      return;
    }

    const platform = document.getElementById('ac32FormPlatform')?.value;
    if (!platform) return setAccountDialogStatus('请选择平台。', 'warning');
    const authConfig = state.data.platformAuth || {};
    if (platform === 'telegram' && authConfig.telegram?.available !== true) return setAccountDialogStatus('当前安装包尚未启用 Telegram 登录，请安装已启用平台服务的版本。', 'warning');
    const p = platformInfo(platform);
    const facebookType = platform === 'facebook' ? selectedFacebookType() : null;
    if (platform === 'facebook' && facebookType?.accountKind !== 'personal-messenger' && authConfig.facebook?.available !== true) return setAccountDialogStatus('当前安装包尚未启用 Facebook 登录，请安装已启用平台服务的版本。', 'warning');
    const contract = facebookType ? driverContract(facebookType.driverId) : null;
    if (facebookType && contract?.onboardingAvailable === false) {
      return setAccountDialogStatus(`当前驱动尚不可登录：${contract.onboardingReason || 'ONBOARDING_UNAVAILABLE'}`, 'warning');
    }
    const accountKind = facebookType?.accountKind || undefined;
    const driverId = facebookType?.driverId || undefined;
    const displayName = facebookType?.label || `${p.label} 账号`;
    const data = await api('', { method:'POST', body:{
      platform, displayName, identityLabel:'登录后自动识别', authorizationPending:true,
      ...(accountKind ? { accountKind, driverId, metadata: { accountKind, driverId } } : {})
    } });
    const account = data.account;
    if (!account) throw new Error('账号创建失败');
    dialog.close();
    state.selectedId = account.id;
    state.tab = 'login';
    clearAuthNotice(account.id);
    await refreshAccounts(false);
    renderWorkbench();
    if (platform === 'whatsapp') await connectAccount(accountById(account.id) || account);
    if (platform === 'telegram') await startTelegramQr(accountById(account.id) || account);
    if (platform === 'facebook' && facebookType?.accountKind === 'personal-messenger') await startFacebookMessengerLogin(accountById(account.id) || account);
    if (platform === 'facebook' && facebookType?.accountKind !== 'personal-messenger') await startFacebookOAuth(accountById(account.id) || account);
  } catch (error) {
    const blocked = safeModeError(error);
    setAccountDialogStatus(error.message || '账号连接未完成', blocked ? 'warning' : 'error', { showRecovery: blocked });
  } finally {
    if (dialog.open) setAccountDialogBusy(false);
  }
}

function showQr(dataUrl, accountId = state.selectedId, challenge = null, platform = '') {
  if (!dataUrl) return;
  const accountPlatform = platform || accountById(accountId)?.platform || challenge?.platform || 'whatsapp';
  const label = accountPlatform === 'telegram' ? 'Telegram' : 'WhatsApp';
  if (accountId) state.qrChallenges[accountId] = challenge || { dataUrl, platform: accountPlatform };
  const dialog = document.getElementById('ac32DetailDialog');
  dialog.dataset.authAccountId = String(accountId || '');
  dialog.dataset.authPlatform = accountPlatform;
  document.getElementById('ac32DetailDialogTitle').textContent = `${label} 登录二维码`;
  const body = document.getElementById('ac32DetailDialogBody');
  body.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'ac32-qr';
  const image = document.createElement('img');
  setUrlAttribute(image, 'src', dataUrl, { allowDataImage: true });
  image.alt = `${label} 登录二维码`;
  const copy = document.createElement('p');
  copy.textContent = accountPlatform === 'telegram'
    ? '打开手机 Telegram → 设置 → 设备 → 连接桌面设备，然后扫描此二维码。二维码只用于短期认证，不写入日志或诊断导出。'
    : '打开手机 WhatsApp → 已连接的设备 → 连接设备，然后扫描此二维码。二维码只用于短期认证，不写入日志或诊断导出。';
  wrapper.append(image, copy);
  body.appendChild(wrapper);
  dialog.showModal();
}



function updateConversationSendSource() {
  const composer = document.querySelector('.composer');
  if (!composer) return;
  let badge = document.getElementById('ac32SendSource');
  if (!badge) {
    badge = document.createElement('button');
    badge.type = 'button';
    badge.id = 'ac32SendSource';
    badge.className = 'ac32-send-source';
    const actions = document.getElementById('composerSendActions') || composer;
    const sendButton = document.getElementById('sendBtn');
    if (sendButton?.parentElement === actions) actions.insertBefore(badge, sendButton); else actions.appendChild(badge);
    badge.onclick = () => openAccountCenter(badge.dataset.accountId || '');
  }

  const contact = window.__Y27?.getActiveContact?.() || window.__Y27?.getState?.()?.contacts?.find?.(row => row.id === window.__Y27?.getState?.()?.activeContactId) || null;
  const boundId = String(contact?.accountId || '').trim();
  const platform = String(contact?.platform || '').toLowerCase();
  const account = boundId ? state.data.accounts.find(row => (
    row.id === boundId ||
    row.canonicalAccountId === boundId ||
    row.adapterAccountId === boundId ||
    row.authAccountKey === boundId
  )) : null;

  badge.dataset.accountId = account?.id || boundId;
  badge.dataset.conversationId = contact?.id || '';
  badge.dataset.routeConflict = '';

  if (!contact?.id) {
    badge.innerHTML = '<i></i><span>未选择会话</span><em>未选择</em>';
    badge.classList.add('blocked');
    return;
  }
  if (!boundId) {
    badge.dataset.routeConflict = 'missing-binding';
    badge.innerHTML = '<i></i><span>未绑定账号</span><em>禁止发送</em>';
    badge.classList.add('blocked');
    return;
  }
  if (!account || (platform && String(account.platform || '').toLowerCase() !== platform)) {
    badge.dataset.routeConflict = 'unresolved-binding';
    badge.innerHTML = `<i></i><span>来源冲突</span><em>禁止发送</em>`;
    badge.classList.add('blocked');
    return;
  }

  const canSend = (account.canAttemptSend === true || (account.canAttemptSend == null && account.canSend === true)) && !['paused','merged','tombstoned','migrating','deleted'].includes(String(account.lifecycleState || account.state || '').toLowerCase());
  badge.classList.toggle('blocked', !canSend);
  if (!canSend) badge.dataset.routeConflict = 'account-not-sendable';
  badge.title = `${platformInfo(account.platform).label} · ${account.displayName} · ${canSend ? (account.sendVerified?'当前会话已绑定，真实发送ACK已验证':'当前会话已绑定，允许发送尝试，真实ACK待验证') : account.stateLabel || '不可发送'}`;
  badge.innerHTML = `<i></i><span>${htmlText(platformInfo(account.platform).label)} · ${htmlText(canSend?(account.sendVerified?'ACK已验证':'可尝试·待ACK'):account.stateLabel || '受限')}</span><em>${htmlText(canSend?'可发送':'不可发送')}</em>`;
}

async function refreshAccounts(showLoading = true) {
  if (state.loading) return;
  state.loading = true;
  if (showLoading) toast('正在读取真实账号状态…', 'warning');
  try {
    const data = await api('');
    state.data = data;
    reconcileAuthorizationCompletion(data.accounts || []);
    for (const accountId of Object.keys(state.qrChallenges)) {
      const account = data.accounts.find(row => row.id === accountId);
      if (!account || !account.qrReady || ['connected','limited','logged-out'].includes(account.state)) delete state.qrChallenges[accountId];
    }
    state.lastError = '';
    if (!state.selectedId || !data.accounts.some(row => row.id === state.selectedId)) state.selectedId = data.accounts[0]?.id || '';
    renderSummary(); renderFilters(); renderAccountList(); renderWorkbench(); updateConversationSendSource(); saveLocal();
  } catch (error) {
    state.lastError = error.message;
    document.getElementById('ac32AccountList').innerHTML = `<div class="ac32-empty ui-empty-state-fill"><b>账号服务暂不可用</b><p>${htmlText(error.message)}</p><button class="ac32-button" id="ac32Retry" style="margin-top:9px">重试</button></div>`;
    document.getElementById('ac32Retry')?.addEventListener('click',()=>refreshAccounts());
    toast(error.message, 'error');
  } finally { state.loading = false; }
}

async function reconnectAll() {
  const account = accountById();
  if (!ensureAccountAuthAllowed(account, '重新连接全部平台账号')) return;
  if (account?.id) clearAuthNotice(account.id);
  try { toast('正在按账号独立队列重连…', 'warning'); const data = await api('/actions/reconnect-all', { method:'POST', body:{} }); await refreshAccounts(false); const failed = data.results.filter(row=>!row.ok).length; toast(failed?`重连完成，${failed} 个账号需要处理`:'全部账号重连完成', failed?'warning':'success'); }
  catch (error) { toast(error.message,'error'); }
}
async function diagnoseAll() {
  const accounts = state.data.accounts.filter(row => row.state !== 'paused');
  let failed = 0;
  for (const account of accounts) {
    try { const data = await api(`/${encodeURIComponent(account.id)}/diagnose`, { method:'POST', body:{} }); state.diagnostics[account.id] = data.report; if (data.report.fail) failed += 1; }
    catch (_) { failed += 1; }
  }
  await refreshAccounts(false); state.tab='diagnostics'; renderWorkbench(); toast(failed?`全部诊断完成，${failed} 个账号需要处理`:'全部账号诊断通过', failed?'warning':'success');
}

function connectEvents() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/events`);
  state.socket = socket;
  socket.onmessage = event => {
    try {
      const row = JSON.parse(event.data);
      if (row.type === 'whatsapp:qr') {
        const payload = row.payload || {};
        const account = state.data.accounts.find(item => item.platform === 'whatsapp' && (item.id === payload.databaseAccountId || item.authAccountKey === payload.accountId || item.adapterAccountId === payload.accountId));
        if (payload.qrDataUrl && (!state.awaitingQrAccountId || account?.id === state.awaitingQrAccountId)) {
          state.awaitingQrAccountId = '';
          state.qrPollTokens = state.qrPollTokens && typeof state.qrPollTokens === 'object' ? state.qrPollTokens : {};
          if (account?.id) state.qrPollTokens[account.id] = Number(state.qrPollTokens[account.id] || 0) + 1;
          if (account) {
            state.selectedId = account.id;
            state.tab = 'login';
            state.qrChallenges[account.id] = { ...(payload.challenge || {}), dataUrl: payload.qrDataUrl };
          }
          showQr(payload.qrDataUrl, account?.id || payload.databaseAccountId || '', payload.challenge ? { ...payload.challenge, dataUrl: payload.qrDataUrl } : null, 'whatsapp');
        }
      }
      if (['account:state','accounts:summary','whatsapp:state','telegram:state','whatsapp:qr','message:inserted','conversation:read'].includes(row.type)) {
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => refreshAccounts(false).then(() => reconcileAuthorizationCompletion()).catch(() => {}), 180);
      }
    } catch (_) {}
  };
  socket.onclose = () => setTimeout(connectEvents, 1800);
  socket.onerror = () => {};
}

function bindGlobal() {
  document.getElementById('ac32Search').oninput = event => { state.search = event.target.value; saveLocal(); renderAccountList(); };
  document.getElementById('ac32AddAccount').onclick = () => openAccountDialog();
  document.getElementById('ac32ReconnectAll').onclick = reconnectAll;
  document.getElementById('ac32RunAllDiagnostics').onclick = diagnoseAll;
  document.getElementById('ac32AccountSave').onclick = saveAccountDialog;
  window.addEventListener('offline', () => document.getElementById('ac32Offline')?.classList.add('show'));
  window.addEventListener('online', () => { document.getElementById('ac32Offline')?.classList.remove('show'); if (state.view) refreshAccounts(false); });
  ['yance:r32-data-ready','yance:r32-contact-selected','yance:r32-active-conversation-changed','yance:r32-conversation-account-changed'].forEach(type => {
    window.addEventListener(type, () => updateConversationSendSource());
  });
  document.getElementById('ac32Offline').classList.toggle('show', !navigator.onLine);

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('#navConversation,#navContacts,#navProfiles,#navTimeline,#navInsights,#navAiWorkbench');
    if (nav && app.classList.contains('account-center-open')) leaveAccountCenter();
  }, true);

  window.yanceDesktop?.onOpenView?.(payload => {
    if (payload?.view === 'accounts') openAccountCenter(payload.accountId || '');
  });
}

injectNav(); injectWorkspace(); bindGlobal(); connectEvents();
if (window.__Y27) {
  window.__Y27.openAccountsPage = openAccountCenter;
  const previous = window.__Y27.runSelfTest;
  window.__Y27.runSelfTest = async () => {
    const prior = typeof previous === 'function' ? await previous() : {};
    return { ...prior, accounts: [
      { name:'account-center-present', pass:Boolean(document.getElementById('accountCenterWorkspace')) },
      { name:'account-platforms', pass:['whatsapp','telegram','facebook'].every(platform => state.data.capabilityMatrix?.[platform]) },
      { name:'account-shared-source', pass:Array.isArray(state.data.accounts) && Boolean(state.data.bindings) },
      { name:'account-secure-bridge', pass:Boolean(window.yanceDesktop?.saveCredential) },
      { name:'account-legacy-migration', pass:Boolean(window.yanceDesktop?.selectDirectory) && typeof renderMigration === 'function' },
      { name:'account-send-source', pass:Boolean(document.getElementById('ac32SendSource')) }
    ] };
  };
}
refreshAccounts(false).then(() => { if (state.view) openAccountCenter(state.selectedId); });
})();
