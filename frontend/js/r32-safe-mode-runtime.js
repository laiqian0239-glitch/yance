(() => {
'use strict';

let banner = null;
let active = false;
let refreshPromise = null;
let lastRefreshAt = 0;
let refreshTimer = 0;

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'yanceSafeModeBanner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');
  banner.innerHTML = '<strong>安全模式</strong><span data-safe-message>系统仅提供只读查看、诊断、备份与恢复。</span><button data-safe-open>打开恢复中心</button>';
  banner.querySelector('[data-safe-open]').onclick = () => {
    window.YanceR32SettingsRecovery?.open?.('desktop');
  };
  document.body.appendChild(banner);
  return banner;
}

function render(state = {}) {
  active = state.active === true;
  const node = ensureBanner();
  node.style.display = active ? 'flex' : 'none';
  node.querySelector('[data-safe-message]').textContent = active
    ? `${state.reason || '系统已进入安全模式'}。账号连接、自动同步、发送、AI自动任务和更新安装已暂停。`
    : '';
  document.documentElement.toggleAttribute('data-yance-safe-mode', active);
  window.dispatchEvent(new CustomEvent('yance:safe-mode', { detail: { active, state } }));
}

async function refresh(options = {}) {
  const force = options?.force === true;
  const now = Date.now();
  if (refreshPromise) return refreshPromise;
  if (!force && now - lastRefreshAt < 5000) return null;
  const task = (async () => {
    try {
      const state = await window.YanceCore?.recovery?.state?.();
      lastRefreshAt = Date.now();
      if (state?.safeMode) render(state.safeMode);
      return state || null;
    } catch (_) { return null; }
  })();
  refreshPromise = task;
  try { return await task; }
  finally { if (refreshPromise === task) refreshPromise = null; }
}
function scheduleRefresh(options = {}) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    refresh(options);
  }, Math.max(0, Number(options.delayMs ?? 120)));
}

window.addEventListener('yance:core-network', event => { if (event.detail?.browserOnline) scheduleRefresh({ force: true }); });
window.addEventListener('focus', () => scheduleRefresh());
setInterval(() => refresh({ force: true }), 30000);
setTimeout(() => scheduleRefresh({ force: true, delayMs: 0 }), 0);
window.YanceSafeMode = Object.freeze({ refresh, scheduleRefresh, isActive: () => active });
})();
