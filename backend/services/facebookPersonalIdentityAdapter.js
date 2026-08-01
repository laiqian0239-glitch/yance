'use strict';

const sessions = new Map();
function clean(value) { return String(value == null ? '' : value).trim(); }
function unsupported(operation = 'messaging') {
  const error = new Error('Facebook 官方个人身份登录不提供个人 Messenger 私信读写能力');
  error.code = 'FACEBOOK_PERSONAL_IDENTITY_MESSAGING_UNSUPPORTED';
  error.status = 409;
  error.operation = operation;
  throw error;
}
function credentialReady(_account, secret = {}) { return Boolean(clean(secret.userId) && clean(secret.identityReceipt)); }
function status(account) {
  const id = clean(account?.id || account);
  return sessions.get(id) || { state: 'unconfigured', canSend: false, canReceive: false, identityOnly: true, lastError: '', reasonCode: '' };
}
async function connect(account, options = {}) {
  const id = clean(account?.id);
  const secret = options.secret || {};
  if (!credentialReady(account, secret)) {
    const error = new Error('Facebook 个人身份 OAuth 凭据尚未完成');
    error.code = 'FACEBOOK_PERSONAL_IDENTITY_CREDENTIAL_REQUIRED'; error.status = 409; throw error;
  }
  const row = {
    state: 'connected', canSend: false, canReceive: false, identityOnly: true,
    user: { id: clean(secret.userId), name: clean(secret.displayName || account?.displayName), avatarUrl: clean(secret.avatarUrl) },
    connectedAt: new Date().toISOString(), lastError: '', reasonCode: '', supportLevel: 'identity-only'
  };
  sessions.set(id, row);
  return { ...row };
}
async function disconnect(account) { const id = clean(account?.id || account); sessions.delete(id); return { state: 'logged-out', identityOnly: true }; }
async function sync(account) {
  const row = status(account);
  if (row.state !== 'connected') { const error = new Error('Facebook 个人身份尚未登录'); error.code = 'FACEBOOK_PERSONAL_IDENTITY_NOT_CONNECTED'; error.status = 409; throw error; }
  return { syncedAt: new Date().toISOString(), identity: row.user, conversations: 0, messages: 0, messagingSupported: false };
}

module.exports = {
  supportLevel: 'identity-only', official: true, messagingSupported: false, riskDisclosureRequired: false,
  credentialReady, status, connect, disconnect, sync,
  sendText() { return unsupported('sendText'); }, sendMedia() { return unsupported('sendMedia'); }, sendPresence() { return unsupported('sendPresence'); }, markRead() { return unsupported('markRead'); }
};
