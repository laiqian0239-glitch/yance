(function () {
  'use strict';

  const desktop = window.yanceDesktop;
  if (!desktop?.getUpdateState) return;

  const root = document.getElementById('r32UpdateCenter');
  if (!root) return;
  const title = root.querySelector('[data-update-title]');
  const detail = root.querySelector('[data-update-detail]');
  const progress = root.querySelector('[data-update-progress]');
  const action = root.querySelector('[data-update-action]');
  const dismiss = root.querySelector('[data-update-dismiss]');
  let state = null;
  let dismissedVersion = '';
  const runtimeErrors = window.YanceRuntimeErrors || {};

  function errorText(error, fallback = '更新服务暂时不可用，不影响当前工作') {
    return runtimeErrors.userMessage?.(error, { rootObject: window, fallback }) || (() => {
      const value = error?.message || error?.error?.message || error?.error || error;
      const text = typeof value === 'string' ? value.trim() : '';
      return text && text !== '[object Object]' ? text : fallback;
    })();
  }

  function reportUpdateError(error, retry) {
    const message = errorText(error);
    render({ ...(state || {}), phase: 'error', error: message });
    window.YanceSystemStatus?.show?.('error', message, {
      actionLabel: typeof retry === 'function' ? '重试' : '',
      action: retry,
      source: 'update-center',
      reason: runtimeErrors.reasonCode?.(error) || 'UPDATE_STATE_FAILED',
      duration: 7000
    });
    return message;
  }

  const phaseLabel = {
    checking: '正在检查更新',
    available: '发现新版本',
    downloading: '正在下载更新',
    downloaded: '更新已就绪',
    verifying: '正在校验更新',
    ready: '新版本已下载并通过验证',
    installing: '正在准备安装',
    rejected: '更新被拒绝',
    error: '更新检查失败',
    unconfigured: '内测版手动更新',
    'up-to-date': '当前已是最新版本'
  };

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  function render(next) {
    state = next || {};
    const phase = state.phase || 'idle';
    const version = state.availablePublicVersion || state.availableVersion || '';
    const visible = ['available', 'downloading', 'downloaded', 'verifying', 'ready', 'rejected', 'error'].includes(phase)
      && !(phase === 'available' && dismissedVersion && dismissedVersion === version);
    root.hidden = !visible;
    if (!visible) return;
    root.dataset.phase = phase;
    title.textContent = `${phaseLabel[phase] || '版本更新'}${version ? ` · v${version}` : ''}`;
    if (phase === 'available') detail.textContent = state.releaseNotes || '新版本已准备好，可由你决定何时下载。';
    else if (phase === 'verifying') detail.textContent = '正在校验安装包完整性与签名信息…';
    else if (phase === 'ready') detail.textContent = '更新包已校验通过，可安全安装。安装前会检查未保存内容、同步任务和待发送队列。';
    else if (phase === 'downloading') detail.textContent = `${Math.round(Number(state.percent || 0))}%${state.total ? ` · ${formatBytes(state.transferred)} / ${formatBytes(state.total)}` : ''}`;
    else if (phase === 'downloaded') detail.textContent = '下载与校验完成。安装前会检查未保存内容、同步任务和待发送队列。';
    else if (phase === 'rejected') detail.textContent = (state.error || '更新包未通过安全校验，已拒绝安装。') + ' 详细原因见脱敏日志。';
    else detail.textContent = state.error || '更新服务暂时不可用，不影响当前工作。';
    progress.hidden = phase !== 'downloading';
    progress.value = Number(state.percent || 0);
    action.hidden = !['available', 'downloading', 'ready', 'rejected'].includes(phase);
    if (phase === 'available') { action.textContent = '下载并安装'; }
    else if (phase === 'downloading') { action.textContent = '下载中…'; }
    else if (phase === 'ready') { action.textContent = '重启并安装'; }
    else if (phase === 'rejected') { action.textContent = '重新检查更新'; }
    else { action.textContent = '更新'; }
    action.disabled = phase === 'downloading' || phase === 'verifying' || phase === 'installing';
    dismiss.hidden = phase === 'downloaded' || phase === 'ready' || phase === 'rejected';
  }

  async function executeUpdatePhase(phase) {
    if (phase === 'available') return desktop.downloadUpdate();
    if (phase === 'ready' || phase === 'downloaded') return desktop.installUpdate();
    return desktop.checkForUpdates();
  }

  async function runAction() {
    const attemptedPhase = state?.phase || 'checking';
    try {
      action.disabled = true;
      await executeUpdatePhase(attemptedPhase);
    } catch (error) {
      reportUpdateError(error, async () => {
        try { await executeUpdatePhase(attemptedPhase); }
        catch (retryError) { reportUpdateError(retryError); }
      });
    } finally {
      action.disabled = false;
    }
  }

  function reportWorkState() {
    const composer = document.getElementById('composerText');
    const unsaved = Boolean(composer?.value?.trim()) || Boolean(document.querySelector('dialog[open] textarea:not(:placeholder-shown), dialog[open] input[data-dirty="true"]'));
    const pending = Boolean(document.querySelector('.candidate'));
    desktop.setUpdateWorkState?.({
      unsavedChanges: unsaved,
      pendingReplyApproval: pending,
      detail: unsaved ? '消息输入框或编辑面板中仍有未保存内容' : ''
    }).catch(() => {});
  }

  action.addEventListener('click', runAction);
  dismiss.addEventListener('click', () => {
    dismissedVersion = state?.availablePublicVersion || state?.availableVersion || '';
    root.hidden = true;
  });
  document.addEventListener('input', reportWorkState, true);
  document.addEventListener('change', reportWorkState, true);
  new MutationObserver(reportWorkState).observe(document.body, { subtree: true, childList: true });
  setInterval(reportWorkState, 5000);
  reportWorkState();

  desktop.onUpdateState?.(render);
  desktop.getUpdateState().then(render).catch(error => reportUpdateError(error, () => desktop.getUpdateState().then(render).catch(retryError => reportUpdateError(retryError))));
}());
