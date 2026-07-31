(() => {
'use strict';
const $ = id => document.getElementById(id);
const button = $('navSettings');
const panel = $('basicSettingsPanel');
if (!panel || window.YanceR32BasicSettings) return;
const closeButton = $('closeBasicSettings');
const saveButton = $('saveBasicSettings');
const stateNode = $('basicSettingsState');
const saveStateNode = $('basicSettingsSaveState');
const state = { loading: false, saving: false, desktop: null, runtime: null, notifications: null };

function setStatus(text, type = '') {
  stateNode.textContent = text;
  stateNode.className = `basic-settings-state${type ? ` ${type}` : ''}`;
}
function setSaveState(text) { if (saveStateNode) saveStateNode.textContent = text; }
function desktopToggle(key) { return panel.querySelector(`[data-basic-desktop="${CSS.escape(key)}"]`); }
function notifyToggle(key) { return panel.querySelector(`[data-basic-notify="${CSS.escape(key)}"]`); }
function render() {
  const desktop = state.desktop || {};
  const runtime = state.runtime || {};
  const notifications = state.notifications || {};
  { const node = desktopToggle('closeToTray'); if (node) node.checked = Boolean(desktop.closeToTray); }
  { const node = desktopToggle('autoConnectAccounts'); if (node) node.checked = Boolean(runtime.autoConnectAccounts); }
  ['desktopEnabled','soundEnabled'].forEach(key => { const node = notifyToggle(key); if (node) node.checked = Boolean(notifications[key]); });
  panel.querySelectorAll('input').forEach(node => { node.disabled = state.loading || state.saving; });
  if (saveButton) saveButton.disabled = state.loading || state.saving;
}
async function request(path, options = {}) {
  const response = await fetch(`/api/r32/system${path}`, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) throw new Error(`设置接口返回异常（${response.status}）`);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.message || payload.error || `请求失败（${response.status}）`);
  return payload;
}
async function load() {
  if (state.loading) return;
  state.loading = true;
  setStatus('正在读取真实设置…');
  render();
  try {
    const [desktop, runtime, notification] = await Promise.all([
      window.yanceDesktop?.getSettings?.() || Promise.resolve({}),
      request('/runtime-settings'),
      request('/notifications')
    ]);
    state.desktop = desktop || {};
    state.runtime = runtime.settings || {};
    state.notifications = notification.settings || {};
    setStatus('设置已从 Electron 与 SQLite 读取', 'ready');
    setSaveState('修改后点击保存');
  } catch (error) {
    setStatus(error.message || '读取设置失败', 'error');
  } finally {
    state.loading = false;
    render();
  }
}
async function save() {
  if (state.loading || state.saving) return;
  const desktopPatch = { closeToTray: Boolean(desktopToggle('closeToTray')?.checked) };
  const backendSettingsPatch = { autoConnectAccounts: Boolean(desktopToggle('autoConnectAccounts')?.checked) };
  const notificationPatch = {
    ...(state.notifications || {}),
    desktopEnabled: Boolean(notifyToggle('desktopEnabled')?.checked),
    soundEnabled: Boolean(notifyToggle('soundEnabled')?.checked)
  };
  state.saving = true;
  setStatus('正在保存设置…');
  setSaveState('保存中');
  panel.querySelectorAll('input').forEach(node => { node.disabled = true; });
  if (saveButton) saveButton.disabled = true;
  try {
    const [settingsResult, notification] = await Promise.all([
      window.YanceSettingsRouting.saveSettingsPatch({
        patch: { ...desktopPatch, ...backendSettingsPatch },
        desktopUpdate: patch => window.yanceDesktop?.updateSettings?.(patch) || Promise.resolve({ ...(state.desktop || {}), ...patch }),
        runtimeUpdate: patch => request('/runtime-settings', { method: 'POST', body: patch }).then(value => value.settings)
      }),
      request('/notifications', { method: 'POST', body: notificationPatch })
    ]);
    state.desktop = settingsResult.desktop || { ...(state.desktop || {}), ...desktopPatch };
    state.runtime = settingsResult.runtime || { ...(state.runtime || {}), ...backendSettingsPatch };
    state.notifications = notification.settings || notificationPatch;
    setStatus('设置已保存，重启后会从持久化配置恢复', 'ready');
    setSaveState('已保存');
  } catch (error) {
    setStatus(error.message || '保存设置失败', 'error');
    setSaveState('保存失败');
  } finally {
    state.saving = false;
    render();
  }
}
function close() {
  panel.hidden = true;
  button?.classList.remove('active');
}
function open() {
  window.YanceR32DisplaySettings?.close?.();
  panel.hidden = false;
  button?.classList.add('active');
  load();
}
function toggle(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (panel.hidden) open(); else close();
}
function route(action) {
  close();
  if (action === 'display') return window.YanceR32DisplaySettings?.open?.();
  if (action === 'theme') return window.YanceThemeMotion?.open?.();
  if (action === 'accounts') return window.__Y27?.openAccountsPage?.();
  if (action === 'system') return window.__Y27SystemCenter?.open?.('overview');
  if (action === 'recovery') return window.YanceR32SettingsRecovery?.open?.('desktop');
}
button?.addEventListener('click', toggle);
closeButton?.addEventListener('click', event => { event.preventDefault(); close(); });
saveButton?.addEventListener('click', save);
panel.querySelectorAll('[data-basic-action]').forEach(node => node.addEventListener('click', event => {
  event.preventDefault(); event.stopPropagation(); route(node.dataset.basicAction);
}));
panel.addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', close);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
document.addEventListener('click', event => {
  const navButton = event.target.closest('#navMenu button');
  if (navButton && navButton !== button) close();
}, true);
window.YanceR32BasicSettings = { open, close, load, save, getState: () => ({ ...state }) };

const testNotificationBtn = $('testNotificationBtn');
const testSoundBtn = $('testSoundBtn');
if (testNotificationBtn) {
  testNotificationBtn.addEventListener('click', async () => {
    testNotificationBtn.disabled = true;
    testNotificationBtn.textContent = '正在发送测试通知…';
    try {
      const result = await request('/desktop/notify-test', { method: 'POST', body: { title: '言策 通知测试', body: '桌面通知链路已触发' } });
      if (result.ok) {
        setStatus('测试通知已发送，请检查系统通知中心', 'ready');
      } else {
        setStatus(`通知未显示：${result.reason || '未知原因'}`, 'error');
      }
    } catch (error) {
      setStatus(error.message || '测试通知发送失败', 'error');
    } finally {
      testNotificationBtn.disabled = false;
      testNotificationBtn.textContent = '测试桌面通知';
    }
  });
}
if (testSoundBtn) {
  testSoundBtn.addEventListener('click', async () => {
    testSoundBtn.disabled = true;
    testSoundBtn.textContent = '正在播放提示音…';
    try {
      const result = await request('/desktop/notify-test', { method: 'POST', body: { title: '言策 提示音测试', body: '消息提示音链路已触发', testSound: true } });
      if (result.ok) {
        setStatus('测试提示音已触发', 'ready');
      } else {
        setStatus(`提示音未播放：${result.reason || '请检查声音设置'}`, 'error');
      }
    } catch (error) {
      setStatus(error.message || '测试提示音失败', 'error');
    } finally {
      testSoundBtn.disabled = false;
      testSoundBtn.textContent = '测试消息提示音';
    }
  });
}
})();
