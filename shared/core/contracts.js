'use strict';

const COMMANDS = Object.freeze({
  LIFECYCLE_GET_STATE: 'lifecycle.getState',
  LIFECYCLE_SET_NETWORK: 'lifecycle.setNetwork',
  LIFECYCLE_SUSPEND: 'lifecycle.suspend',
  LIFECYCLE_RESUME: 'lifecycle.resume',
  LIFECYCLE_ENTER_SAFE_MODE: 'lifecycle.enterSafeMode',
  LIFECYCLE_EXIT_SAFE_MODE: 'lifecycle.exitSafeMode',

  SECURITY_GET_STATE: 'security.getState',
  SECURITY_SAVE_CREDENTIAL: 'security.saveCredential',
  SECURITY_DELETE_CREDENTIAL: 'security.deleteCredential',
  SECURITY_OPEN_AUTH_URL: 'security.openAuthUrl',

  ACCOUNT_LIST: 'account.list',
  ACCOUNT_AUDIT: 'account.audit',
  ACCOUNT_CAPABILITIES: 'account.capabilities',
  ACCOUNT_PLATFORM_AUTH_CONFIGURE: 'account.platformAuth.configure',
  ACCOUNT_PLATFORM_AUTH_CLEAR: 'account.platformAuth.clear',
  ACCOUNT_CREATE: 'account.create',
  ACCOUNT_UPDATE: 'account.update',
  ACCOUNT_REMOVE: 'account.remove',
  ACCOUNT_SET_DEFAULT: 'account.setDefault',
  ACCOUNT_CONNECT: 'account.connect',
  ACCOUNT_RECONNECT: 'account.reconnect',
  ACCOUNT_SYNC: 'account.sync',
  ACCOUNT_SYNC_ALL: 'account.syncAll',
  ACCOUNT_RECONNECT_ALL: 'account.reconnectAll',
  ACCOUNT_PAUSE: 'account.pause',
  ACCOUNT_RESUME: 'account.resume',
  ACCOUNT_LOGOUT: 'account.logout',
  ACCOUNT_DIAGNOSE: 'account.diagnose',
  ACCOUNT_BIND_CONVERSATION: 'account.bindConversation',
  ACCOUNT_GET_RUNTIME: 'account.getRuntime',
  ACCOUNT_GET_AUTH_CHALLENGE: 'account.getAuthChallenge',
  ACCOUNT_GET_CREDENTIAL_STATE: 'account.getCredentialState',
  ACCOUNT_AUTHORIZATION_DISCARD_PENDING: 'account.authorization.discardPending',
  ACCOUNT_AVATAR_LOAD_FAILURE: 'account.avatarLoadFailure',
  ACCOUNT_MIGRATION_SCAN: 'account.migration.scan',
  ACCOUNT_MIGRATION_IMPORT: 'account.migration.import',
  ACCOUNT_TELEGRAM_QR_START: 'account.telegram.qr.start',
  ACCOUNT_TELEGRAM_PHONE_START: 'account.telegram.phone.start',
  ACCOUNT_TELEGRAM_CODE: 'account.telegram.code',
  ACCOUNT_TELEGRAM_PASSWORD: 'account.telegram.password',
  ACCOUNT_TELEGRAM_CANCEL: 'account.telegram.cancel',
  ACCOUNT_FACEBOOK_OAUTH_START: 'account.facebook.oauth.start',
  ACCOUNT_FACEBOOK_OAUTH_STATUS: 'account.facebook.oauth.status',
  ACCOUNT_FACEBOOK_OAUTH_SELECT_PAGE: 'account.facebook.oauth.selectPage',
  ACCOUNT_FACEBOOK_OAUTH_CANCEL: 'account.facebook.oauth.cancel',
  ACCOUNT_FACEBOOK_AVATAR_CLOSURE_DIAGNOSE: 'account.facebook.avatarClosure.diagnose',
  ACCOUNT_FACEBOOK_AVATAR_IMPORT_START: 'account.facebook.avatarImport.start',
  ACCOUNT_FACEBOOK_AVATAR_IMPORT_STATUS: 'account.facebook.avatarImport.status',
  ACCOUNT_FACEBOOK_AVATAR_IMPORT_STOP: 'account.facebook.avatarImport.stop',
  ACCOUNT_FACEBOOK_WEBHOOK_VERIFY: 'account.facebook.webhook.verify',
  ACCOUNT_FACEBOOK_WEBHOOK_HANDLE: 'account.facebook.webhook.handle',

  MESSAGE_SEND_TEXT: 'message.sendText',
  MESSAGE_SEND_MEDIA: 'message.sendMedia',
  MESSAGE_SEND_MEDIA_FILE: 'message.sendMediaFile',
  MESSAGE_SEND_EXPRESSION: 'message.sendExpression',
  MESSAGE_SEND_REACTION: 'message.sendReaction',
  MESSAGE_REVOKE: 'message.revoke',
  MESSAGE_PRESENCE: 'message.presence',
  MESSAGE_TYPING_CANCEL: 'message.typing.cancel',
  MESSAGE_MARK_READ: 'message.markRead',
  MESSAGE_QUEUE_LIST: 'message.queue.list',
  MESSAGE_QUEUE_RETRY: 'message.queue.retry',
  MESSAGE_QUEUE_CANCEL: 'message.queue.cancel',
  MESSAGE_QUEUE_RESOLVE_OUTCOME: 'message.queue.resolveOutcome',

  UPDATE_GET_RUNTIME_BLOCKERS: 'update.getRuntimeBlockers',
  UPDATE_PREFLIGHT: 'update.preflight',
  UPDATE_PREPARE_INSTALL: 'update.prepareInstall',

  RECOVERY_GET_STATE: 'recovery.getState',
  RECOVERY_RUN_INTEGRITY_CHECK: 'recovery.runIntegrityCheck',
  RECOVERY_ENTER_SAFE_MODE: 'recovery.enterSafeMode',
  RECOVERY_CLEAR_SAFE_MODE: 'recovery.clearSafeMode',
  RECOVERY_CREATE_BACKUP: 'recovery.createBackup',
  RECOVERY_VERIFY_BACKUP: 'recovery.verifyBackup',
  RECOVERY_STAGE_RESTORE: 'recovery.stageRestore',
  RECOVERY_CANCEL_RESTORE: 'recovery.cancelRestore',
  RECOVERY_GET_HISTORY: 'recovery.getHistory',
  RECOVERY_EXPORT_DIAGNOSTICS: 'recovery.exportDiagnostics'
});

const WRITE_PREFIXES = Object.freeze([
  'account.create', 'account.update', 'account.remove', 'account.setDefault', 'account.platformAuth.', 'account.authorization.',
  'account.connect', 'account.reconnect', 'account.sync', 'account.pause',
  'account.resume', 'account.logout', 'account.bindConversation', 'account.migration.import',
  'account.telegram.', 'account.facebook.oauth.', 'account.facebook.avatarImport.start', 'account.facebook.avatarImport.stop', 'message.send', 'message.revoke',
  'message.presence', 'message.markRead', 'message.queue.retry', 'message.queue.cancel', 'message.queue.resolveOutcome',
  'security.saveCredential', 'security.deleteCredential', 'update.prepareInstall',
  'lifecycle.enterSafeMode', 'lifecycle.exitSafeMode', 'recovery.enterSafeMode', 'recovery.clearSafeMode',
  'recovery.createBackup', 'recovery.stageRestore', 'recovery.cancelRestore'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function isKnownCommand(command) { return Object.values(COMMANDS).includes(clean(command)); }
function isWriteCommand(command) { const value = clean(command); return WRITE_PREFIXES.some(prefix => value.startsWith(prefix)); }

function assertCommandEnvelope(input) {
  const command = clean(input?.command);
  if (!command || !isKnownCommand(command)) {
    const error = new Error(`未知核心命令：${command || '(empty)'}`);
    error.code = 'CORE_COMMAND_UNKNOWN';
    error.status = 404;
    throw error;
  }
  const payload = input?.payload && typeof input.payload === 'object' ? input.payload : {};
  const context = input?.context && typeof input.context === 'object' ? input.context : {};
  return { command, payload, context };
}

module.exports = { COMMANDS, WRITE_PREFIXES, isKnownCommand, isWriteCommand, assertCommandEnvelope };
