(() => {
'use strict';

const CORE_ENDPOINT = '/api/core/command';
let offline = !navigator.onLine;
const listeners = new Set();

function notifyNetwork() {
  const snapshot = networkState();
  for (const listener of listeners) { try { listener(snapshot); } catch (_) {} }
  window.dispatchEvent(new CustomEvent('yance:core-network', { detail: snapshot }));
}
window.addEventListener('online', () => { offline = false; notifyNetwork(); });
window.addEventListener('offline', () => { offline = true; notifyNetwork(); });

function networkState() {
  return { internetOnline: !offline, browserOnline: navigator.onLine, at: new Date().toISOString() };
}

function coreError(payload, status) {
  if (window.YanceRuntimeErrors?.createError) {
    const error = window.YanceRuntimeErrors.createError(payload, { status, rootObject: window, reasonCode: 'CORE_COMMAND_FAILED', fallback: `核心命令失败（HTTP ${status}）` });
    error.correlationId = payload?.correlationId || error.correlationId || '';
    return error;
  }
  const error = new Error(typeof payload?.error === 'string' ? payload.error : (payload?.message || `核心命令失败（HTTP ${status}）`));
  error.code = payload?.code || payload?.error?.reasonCode || 'CORE_COMMAND_FAILED';
  error.correlationId = payload?.correlationId || '';
  error.status = status;
  return error;
}

async function command(commandName, payload = {}, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 15000));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Core command timeout', 'TimeoutError'));
  }, timeoutMs);
  const externalSignal = options.signal;
  const abortExternal = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortExternal();
    else externalSignal.addEventListener('abort', abortExternal, { once: true });
  }
  try {
    const response = await fetch(CORE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(options.headers || {}) },
      body: JSON.stringify({ command: commandName, payload, context: options.context || {} }),
      signal: controller.signal
    });
    let data;
    try {
      data = await response.json();
    } catch (cause) {
      const invalid = new Error('核心服务返回了无法解析的响应');
      invalid.code = 'CORE_INVALID_RESPONSE';
      invalid.status = response.status;
      invalid.cause = cause;
      throw invalid;
    }
    if (!data || typeof data !== 'object') {
      const invalid = new Error('核心服务返回了无效响应');
      invalid.code = 'CORE_INVALID_RESPONSE';
      invalid.status = response.status;
      throw invalid;
    }
    if (!response.ok || data.ok === false) throw coreError(data, response.status);
    return data.result || {};
  } catch (error) {
    if (timedOut) {
      const timeout = new Error(`核心命令等待超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
      timeout.name = 'TimeoutError';
      timeout.code = 'CORE_COMMAND_TIMEOUT';
      timeout.reasonCode = 'CORE_COMMAND_TIMEOUT';
      timeout.command = commandName;
      timeout.timeoutMs = timeoutMs;
      timeout.cause = error;
      throw timeout;
    }
    if (!navigator.onLine || error?.name === 'TypeError') {
      error.code = error.code || 'CORE_NETWORK_UNAVAILABLE';
      error.offline = !navigator.onLine;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortExternal);
  }
}

function uncertainCommandFailure(error) {
  const code = String(error?.code || error?.reasonCode || '').toUpperCase();
  return error?.name === 'TimeoutError' || code === 'CORE_NETWORK_UNAVAILABLE' || code === 'CORE_INVALID_RESPONSE' || code === 'ABORT_ERR';
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }

async function sendTextWithReconciliation(payload = {}) {
  try {
    return await command('message.sendText', payload, { timeoutMs: 240000 });
  } catch (error) {
    if (!String(payload.idempotencyKey || '').trim() || !navigator.onLine || !uncertainCommandFailure(error)) throw error;
    await wait(250);
    try {
      const result = await command('message.sendText', payload, { timeoutMs: 20000 });
      return { ...result, reconciledAfterUncertainResponse: true };
    } catch (reconcileError) {
      reconcileError.initialSendError = { name: error?.name || '', code: error?.code || '', message: error?.message || '' };
      throw reconcileError;
    }
  }
}

function decode(value) { try { return decodeURIComponent(value); } catch (_) { return value; } }

async function accountRequest(path = '', options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body || {};
  const raw = String(path || '');
  const [pathname, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  const parts = pathname.split('/').filter(Boolean).map(decode);
  let name = '';
  let payload = { ...body };
  if (!parts.length) name = method === 'POST' ? 'account.create' : 'account.list';
  else if (parts[0] === 'audit') { name = 'account.audit'; payload = { ...query }; }
  else if (parts[0] === 'capabilities') name = 'account.capabilities';
  else if (parts[0] === 'migration') name = `account.migration.${parts[1]}`;
  else if (parts[0] === 'actions') name = parts[1] === 'sync-all' ? 'account.syncAll' : 'account.reconnectAll';
  else {
    const id = parts[0]; payload = { id, ...body, ...query };
    const tail = parts.slice(1).join('/');
    const map = {
      'default':'account.setDefault','connect':'account.connect','reconnect':'account.reconnect','sync':'account.sync',
      'pause':'account.pause','resume':'account.resume','logout':'account.logout','diagnose':'account.diagnose',
      'authorization/discard-pending':'account.authorization.discardPending',
      'bind-conversation':'account.bindConversation','runtime':'account.getRuntime','auth-challenge':'account.getAuthChallenge',
      'credential-state':'account.getCredentialState',
      'telegram/qr/start':'account.telegram.qr.start','telegram/phone/start':'account.telegram.phone.start',
      'telegram/cancel':'account.telegram.cancel','telegram/code':'account.telegram.code','telegram/password':'account.telegram.password',
      'facebook/oauth/start':'account.facebook.oauth.start','facebook/oauth/status':'account.facebook.oauth.status',
      'facebook/oauth/select-page':'account.facebook.oauth.selectPage','facebook/oauth/cancel':'account.facebook.oauth.cancel',
      'facebook/avatar-closure/diagnose':'account.facebook.avatarClosure.diagnose',
      'facebook/avatar-import/session':method === 'GET' ? 'account.facebook.avatarImport.status' : 'account.facebook.avatarImport.start',
      'facebook/avatar-import/session/stop':'account.facebook.avatarImport.stop',
      'send-text':'message.sendText'
    };
    if (!tail) name = method === 'PATCH' ? 'account.update' : method === 'DELETE' ? 'account.remove' : 'account.getRuntime';
    else name = map[tail] || '';
    if (name === 'account.update') payload = { id, patch: body };
  }
  if (!name) throw Object.assign(new Error(`未映射的账号核心入口：${method} ${path}`), { code: 'CORE_ACCOUNT_ROUTE_UNMAPPED' });
  const result = await command(name, payload, options);
  return { ok: true, ...result };
}

const api = Object.freeze({
  command,
  accountRequest,
  networkState,
  onNetworkChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  lifecycle: Object.freeze({ state: () => command('lifecycle.getState') }),
  security: Object.freeze({ state: () => command('security.getState') }),
  recovery: Object.freeze({
    state: () => command('recovery.getState'),
    integrity: () => command('recovery.runIntegrityCheck'),
    enterSafeMode: payload => {
      if (!window.yanceDesktop?.setOperatingMode) throw Object.assign(new Error('安全模式修改需要Electron API v2控制面'), { code: 'OPERATING_MODE_API_V2_REQUIRED' });
      return window.yanceDesktop.setOperatingMode('safeMode', String(payload?.reason || 'recovery-ui'));
    },
    clearSafeMode: async payload => {
      if (!window.yanceDesktop?.setOperatingMode) throw Object.assign(new Error('安全模式修改需要Electron API v2控制面'), { code: 'OPERATING_MODE_API_V2_REQUIRED' });
      const receipt = await command('recovery.prepareSafeModeExit', {
        confirmation: String(payload?.confirmation || 'EXIT_SAFE_MODE'),
        reason: String(payload?.reason || 'recovery-ui')
      });
      return window.yanceDesktop.setOperatingMode('normal', String(payload?.reason || 'recovery-ui'), {
        exitAuthorizationId: receipt.exitAuthorizationId,
        exitAuthorizationToken: receipt.exitAuthorizationToken
      });
    },
    exportDiagnostics: payload => command('recovery.exportDiagnostics', payload || {}, { timeoutMs: 30000 })
  }),
  accounts: Object.freeze({ list: () => command('account.list') }),
  messages: Object.freeze({
    sendText: payload => sendTextWithReconciliation(payload),
    sendMedia: payload => command('message.sendMedia', payload, { timeoutMs: 60000 }),
    markRead: payload => command('message.markRead', payload),
    presence: payload => command('message.presence', payload),
    cancelTyping: payload => command('message.typing.cancel', payload),
    reaction: payload => command('message.sendReaction', payload),
    revoke: payload => command('message.revoke', payload),
    listQueue: payload => command('message.queue.list', payload || {}),
    retry: id => command('message.queue.retry', { id }),
    cancel: id => command('message.queue.cancel', { id }),
    resolveOutcome: (id, resolution) => command('message.queue.resolveOutcome', { id, resolution })
  })
});

window.YanceCore = api;
})();
