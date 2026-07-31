'use strict';

const accountStore = require('./accountStore');
const platformDrivers = require('./platformDriverRegistry');
const { supports, mediaCapability } = require('./platformCapabilities');
const { executeWithDeadline } = require('./executionDeadline');
const eventBus = require('./eventBus');

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function unsupported(platform, operation) {
  const error = new Error(`${platform || 'unknown'} 不支持此操作：${operation}`);
  error.code = 'PLATFORM_OPERATION_UNSUPPORTED';
  error.status = 409;
  error.platform = platform;
  error.operation = operation;
  return error;
}

function resolveAccount(accountId, platformHint = '', chatJid = '') {
  const id = clean(accountId);
  const accounts = accountStore.list();
  const account = accounts.find(row => row.id === id || row.adapterAccountId === id) || null;
  let platform = clean(platformHint || account?.platform).toLowerCase();
  const targetPlatform = /^telegram:/i.test(chatJid) ? 'telegram' : /^facebook:/i.test(chatJid) ? 'facebook' : '';
  if (!platform) platform = targetPlatform || 'whatsapp';
  const driver = platformDrivers.get(platform);
  if (account && account.platform !== platform) {
    const error = new Error(`账号平台与请求平台不一致：${account.platform} != ${platform}`);
    error.code = 'ACCOUNT_PLATFORM_MISMATCH'; error.status = 409; throw error;
  }
  if (targetPlatform && targetPlatform !== platform) {
    const error = new Error(`会话目标与请求平台不一致：${targetPlatform} != ${platform}`);
    error.code = 'CHAT_PLATFORM_MISMATCH'; error.status = 409; throw error;
  }
  return {
    account,
    driver,
    platform,
    accountId: account?.id || id,
    adapterAccountId: driver.adapterAccountId(account, id)
  };
}

function externalTarget(platform, value) { return platformDrivers.get(platform).externalTarget(value); }
function requireCapability(platform, operation) { if (!supports(platform, operation)) throw unsupported(platform, operation); }
function requireAccount(resolved) {
  if (resolved.platform === 'whatsapp') return resolved;
  if (resolved.account) return resolved;
  const error = new Error('发送账号不存在');
  error.code = 'ACCOUNT_NOT_FOUND';
  error.status = 404;
  throw error;
}
function executionContext(resolved, chatJid) {
  return {
    platform: resolved.platform,
    account: resolved.account,
    accountId: resolved.accountId,
    adapterAccountId: resolved.adapterAccountId,
    target: resolved.driver.externalTarget(chatJid)
  };
}
async function execute(input, operation, capability, options = {}) {
  const resolved = requireAccount(resolveAccount(input.accountId, input.platform || options.platform, input.chatJid));
  requireCapability(resolved.platform, capability);
  if (options.quote && input.quoted) requireCapability(resolved.platform, 'quote');
  if (typeof resolved.driver[operation] !== 'function') throw unsupported(resolved.platform, capability);
  const invoke = payload => resolved.driver[operation](executionContext(resolved, input.chatJid), payload);
  // Only the durable Outbox port may declare that its upstream deadline is
  // authoritative. A bare AbortSignal is cancellation-only and must not be
  // allowed to bypass the local hard deadline for direct/legacy operations.
  if (input.signal && input.deadlineOwnedByCaller === true) return invoke(input);
  const timeoutByOperation = { sendText: 45_000, sendMedia: 120_000, sendReaction: 30_000, revokeMessage: 30_000, sendNativeExpression: 120_000, sendPresence: 15_000, markRead: 20_000 };
  const timeoutMs = Math.max(1_000, Number(input.timeoutMs || timeoutByOperation[operation] || 60_000));
  return executeWithDeadline(({ signal, generation }) => invoke({ ...input, signal, executionGeneration: generation }), {
    timeoutMs,
    signal: input.signal || null,
    generation: clean(input.executionGeneration),
    code: 'PLATFORM_OPERATION_DEADLINE_EXCEEDED',
    operation,
    platform: resolved.platform,
    accountId: resolved.accountId,
    commandId: clean(input.localMessageId || input.targetId || input.conversationId || input.chatJid),
    outcomeUnknown: ['sendText','sendMedia','sendReaction','revokeMessage','sendNativeExpression'].includes(operation),
    automaticRetryBlocked: true,
    onLateResult(error, result, context) {
      eventBus.publish('platform-operation:late-result-quarantined', {
        platform: resolved.platform, accountId: resolved.accountId, operation,
        executionGeneration: context.generation, quarantineReason: clean(context.reason), ok: !error,
        platformMessageId: clean(result?.platformMessageId || result?.messageId || result?.id || error?.platformMessageId),
        errorCode: clean(error?.code || error?.message), at: new Date().toISOString()
      });
    }
  });
}

async function sendText(input = {}) { return execute(input, 'sendText', 'text', { quote: true }); }
async function sendMedia(input = {}) { return execute(input, 'sendMedia', mediaCapability(input.kind), { quote: true }); }
async function sendReaction(input = {}) { return execute(input, 'sendReaction', 'reaction'); }
async function revokeMessage(input = {}) { return execute(input, 'revokeMessage', 'revoke'); }
async function sendNativeExpression(input = {}) {
  const kind = clean(input.kind).toLowerCase();
  return execute({ ...input, platform: input.platform || 'telegram' }, 'sendNativeExpression', kind === 'sticker' ? 'sticker' : 'gif');
}
async function sendPresence(input = {}) { return execute(input, 'sendPresence', 'typingSend'); }
async function markRead(input = {}) { return execute(input, 'markRead', 'readReceipt'); }

module.exports = { resolveAccount, externalTarget, sendText, sendMedia, sendReaction, revokeMessage, sendNativeExpression, sendPresence, markRead };
