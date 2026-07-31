(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const statusEl = $('personaBrainStatus');
  const cardEl = $('personaBrainStatusCard');
  if (!statusEl || !cardEl) return;

  const runtimeErrors = window.YanceRuntimeErrors;
  const hasDesktopSession = () => runtimeErrors?.hasDesktopSessionBridge?.(window) || Boolean(window.yanceDesktop?.getState);
  const friendly = (value, fallback) => runtimeErrors?.userMessage?.(value, { rootObject: window, fallback }) || String(value?.message || value || fallback);


  async function fetchWithRetry(url, options = {}) {
    const attempts = Math.max(1, Number(options.attempts || 3));
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 9000));
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    const failure = new Error(lastError?.name === 'AbortError' ? '人物基线服务响应超时' : '人物基线服务暂未连接');
    failure.code = lastError?.name === 'AbortError' ? 'PERSONA_REQUEST_TIMEOUT' : 'PERSONA_SERVICE_UNREACHABLE';
    throw failure;
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (runtimeErrors?.createError) throw runtimeErrors.createError(payload, { status: response.status, rootObject: window, fallback: `Persona 状态读取失败（${response.status}）` });
      throw Object.assign(new Error(payload.message || `Persona 状态读取失败（${response.status}）`), { status: response.status, reasonCode: payload.reasonCode || payload.code || '' });
    }
    return payload;
  }

  async function loadPersonaBrainStatus() {
    if (!hasDesktopSession()) {
      statusEl.textContent = '请从言策桌面应用打开以读取 Persona';
      cardEl.classList.add('warn');
      cardEl.dataset.reasonCode = 'API_SESSION_UNAUTHORIZED';
      return;
    }
    const snapshot = window.YanceActiveContactStore?.getSnapshot?.() || {};
    const contactId = String(snapshot.contactId || '').trim();
    const conversationId = String(window.__YanceActiveConversationId || contactId || '').trim();
    const query = new URLSearchParams();
    if (contactId) query.set('contactId', contactId);
    if (conversationId) query.set('conversationId', conversationId);
    statusEl.textContent = '正在解析当前生效 Persona…';
    cardEl.classList.add('warn');
    delete cardEl.dataset.reasonCode;
    try {
      const effectiveResponse = await fetchWithRetry(`/api/v2/persona/effective?${query.toString()}`);
      if (effectiveResponse.status === 404) {
        statusEl.textContent = '尚未初始化人物基线';
        return;
      }
      const effectivePayload = await readJson(effectiveResponse);
      const effective = effectivePayload.effective || {};
      const profileId = String(effective.profileId || 'owner');
      const pendingResponse = await fetchWithRetry(`/api/v2/persona/${encodeURIComponent(profileId)}/pending-changes?state=pending&limit=100`, { attempts: 2 });
      const pending = pendingResponse.ok ? await pendingResponse.json().catch(() => ({ pendingChanges: [] })) : { pendingChanges: [] };
      const pendingCount = Array.isArray(pending.pendingChanges) ? pending.pendingChanges.length : 0;
      const label = effective.effectiveLabel || `${profileId} · v${Number(effective.baseVersion || 0)}`;
      statusEl.textContent = `${label} · ${pendingCount} 项待确认`;
      cardEl.classList.toggle('warn', pendingCount > 0);
    } catch (error) {
      const code = runtimeErrors?.reasonCode?.(error) || error?.reasonCode || error?.code || '';
      cardEl.dataset.reasonCode = code;
      statusEl.textContent = code === 'API_SESSION_UNAUTHORIZED'
        ? '桌面安全会话已失效，请重启本地服务'
        : friendly(error, 'Persona 服务未连接');
      cardEl.classList.add('warn');
    }
  }

  let debounceTimer = null;
  function debouncedLoad() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadPersonaBrainStatus, 300);
  }

  window.addEventListener('yance:r32-data-ready', debouncedLoad);
  window.addEventListener('yance:r32-active-contact-changed', debouncedLoad);
  loadPersonaBrainStatus();
  const observer = new MutationObserver(() => {
    const workbench = document.querySelector('.aiw30-body');
    if (workbench && !workbench.dataset.personaBound) {
      workbench.dataset.personaBound = '1';
      loadPersonaBrainStatus();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.yanceDesktop?.onDesktopEvent?.(event => {
    if (String(event?.type || '').startsWith('persona.')) debouncedLoad();
  });
  window.YanceR32PersonaBrainStatus = { refresh: loadPersonaBrainStatus };
})();
