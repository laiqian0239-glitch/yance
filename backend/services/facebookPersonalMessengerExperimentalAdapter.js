'use strict';

const sessions = new Map();
function clean(value) { return String(value == null ? '' : value).trim(); }
function enabled() { return process.env.YANCE_FACEBOOK_PERSONAL_MESSENGER_EXPERIMENTAL === '1'; }
function requireEnabled() {
  if (enabled()) return;
  const error = new Error('Facebook 个人 Messenger 实验驱动未启用');
  error.code = 'FACEBOOK_PERSONAL_MESSENGER_EXPERIMENTAL_DISABLED'; error.status = 409; throw error;
}
function credentialReady(_account, secret = {}) { return Boolean(clean(secret.browserSessionRef)); }
function status(account) {
  const id = clean(account?.id || account);
  return sessions.get(id) || {
    state: enabled() ? 'unconfigured' : 'paused', canSend: false, canReceive: false,
    supportLevel: 'experimental', riskDisclosureRequired: true,
    reasonCode: enabled() ? 'FACEBOOK_PERSONAL_MESSENGER_SESSION_REQUIRED' : 'FACEBOOK_PERSONAL_MESSENGER_EXPERIMENTAL_DISABLED',
    lastError: enabled() ? '需要独立浏览器会话登录' : '实验功能未启用'
  };
}
async function connect(account, options = {}) {
  requireEnabled();
  const id = clean(account?.id);
  const secret = options.secret || {};
  if (!credentialReady(account, secret)) {
    const error = new Error('Facebook 个人 Messenger 需要独立加密浏览器会话');
    error.code = 'FACEBOOK_PERSONAL_MESSENGER_SESSION_REQUIRED'; error.status = 409; throw error;
  }
  const row = {
    state: 'connected', canSend: true, canReceive: true,
    supportLevel: 'experimental', riskDisclosureRequired: true,
    sessionIsolationKey: `facebook-personal:${id}`,
    browserSessionRef: clean(secret.browserSessionRef),
    connectedAt: new Date().toISOString(), lastError: '', reasonCode: ''
  };
  sessions.set(id, row);
  return { ...row, browserSessionRef: '' };
}
async function disconnect(account) { const id = clean(account?.id || account); sessions.delete(id); return { state: 'logged-out', supportLevel: 'experimental' }; }
function assertSession(account) {
  requireEnabled();
  const row = sessions.get(clean(account?.id || account));
  if (!row || row.state !== 'connected') { const error = new Error('Facebook 个人 Messenger 会话不可用'); error.code = 'FACEBOOK_PERSONAL_MESSENGER_REAUTH_REQUIRED'; error.status = 409; throw error; }
  return row;
}
async function sync(account) { const row = assertSession(account); return { syncedAt: new Date().toISOString(), sessionIsolationKey: row.sessionIsolationKey, experimental: true }; }
async function sendText(context, input = {}) {
  const row = assertSession(context.account || context.accountId);
  if (typeof context.browserBridge?.sendText !== 'function') { const error = new Error('Facebook 个人 Messenger 浏览器桥未连接'); error.code = 'FACEBOOK_PERSONAL_MESSENGER_BROWSER_BRIDGE_UNAVAILABLE'; error.status = 503; throw error; }
  return context.browserBridge.sendText({ sessionIsolationKey: row.sessionIsolationKey, target: context.target, text: clean(input.text) });
}
async function sendMedia(context, input = {}) {
  const row = assertSession(context.account || context.accountId);
  if (typeof context.browserBridge?.sendMedia !== 'function') { const error = new Error('Facebook 个人 Messenger 浏览器桥未连接'); error.code = 'FACEBOOK_PERSONAL_MESSENGER_BROWSER_BRIDGE_UNAVAILABLE'; error.status = 503; throw error; }
  return context.browserBridge.sendMedia({ sessionIsolationKey: row.sessionIsolationKey, target: context.target, ...input });
}

module.exports = {
  supportLevel: 'experimental', official: false, messagingSupported: true, riskDisclosureRequired: true,
  enabled, credentialReady, status, connect, disconnect, sync, sendText, sendMedia,
  sendPresence() { const error = new Error('实验驱动暂不承诺输入状态'); error.code = 'FACEBOOK_PERSONAL_MESSENGER_PRESENCE_UNSUPPORTED'; throw error; },
  markRead() { const error = new Error('实验驱动暂不承诺已读回执'); error.code = 'FACEBOOK_PERSONAL_MESSENGER_READ_RECEIPT_UNSUPPORTED'; throw error; }
};
