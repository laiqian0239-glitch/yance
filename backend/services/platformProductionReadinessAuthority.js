'use strict';

const PLATFORM_ORDER = Object.freeze(['facebook', 'whatsapp', 'telegram']);
const STATUS = Object.freeze({
  READY: 'ready',
  READY_FOR_REAL_UAT: 'ready-for-real-uat',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  ONBOARDING: 'onboarding',
  NOT_CONFIGURED: 'not-configured'
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function row(id, label, status, detail = '', evidence = {}) {
  return { id, label, status, detail: clean(detail), evidence: evidence && typeof evidence === 'object' ? evidence : {} };
}
function isConnected(account = {}) { return ['connected', 'limited'].includes(clean(account.state).toLowerCase()); }
function isOnboarding(account = {}) { return ['unconfigured', 'waiting-verification', 'logged-out', 'paused'].includes(clean(account.state).toLowerCase()); }
function relayConnected(account = {}) {
  const relay = clean(account.relayState).toLowerCase();
  const webhook = clean(account.webhook).toLowerCase();
  return relay === 'connected' || ['relay-connected', 'worker-connected', 'subscribed'].includes(webhook);
}
function sendAttemptReady(account = {}) {
  return account.canAttemptSend === true || (account.canAttemptSend == null && account.canSend === true);
}
function sendAckVerified(account = {}) {
  return account.sendVerified === true || (account.sendVerified == null && account.canSend === true);
}
function sendCheck(account = {}, onboarding = false, label = '真实消息发送') {
  const verified = sendAckVerified(account);
  const attempt = sendAttemptReady(account);
  const failed = clean(account.sendReadiness).toLowerCase() === 'failed' || clean(account.deliveryTruth?.status).toLowerCase() === 'failed';
  const status = verified ? 'pass' : onboarding ? 'pending' : failed || !attempt ? 'fail' : 'uat-required';
  const detail = verified
    ? `真实平台 ACK 已验证${account.lastDeliveryAckAt ? `：${account.lastDeliveryAckAt}` : ''}`
    : failed ? `最近真实发送失败：${clean(account.deliveryTruth?.reasonCode) || 'PLATFORM_SEND_FAILED'}`
      : attempt ? '发送前置条件满足，但尚无真实平台 ACK；不得显示为已验证可发送' : '账号、凭据或运行时尚未达到发送前置条件';
  return row('send', label, status, detail, {
    canAttemptSend: attempt,
    sendVerified: verified,
    sendReadiness: clean(account.sendReadiness),
    deliveryTruth: account.deliveryTruth || null
  });
}
function summarizeFacebook(account = {}) {
  const onboarding = isOnboarding(account);
  const checks = [
    row('credential', '云端授权与凭据', account.credentialReady === true ? 'pass' : onboarding ? 'pending' : 'fail', account.credentialReady === true ? '授权凭据可用' : '尚未完成 Facebook 公共主页授权'),
    sendCheck(account, onboarding),
    row('receive', 'Webhook与实时接收', account.canReceive === true && account.subscriptionReady === true && relayConnected(account) ? 'pass' : onboarding ? 'pending' : 'fail', account.canReceive === true ? '实时接收链可用' : 'Webhook订阅或Worker长连接尚未就绪', {
      subscriptionReady: account.subscriptionReady === true,
      relayState: clean(account.relayState),
      webhook: clean(account.webhook)
    }),
    row('history', 'Business Suite历史与新会话补偿', account.historySyncAvailable === true ? 'pass' : onboarding ? 'pending' : 'warning', account.historySyncAvailable === true ? '历史会话补拉可用' : (account.historySyncReason || '缺少可选历史读取权限；实时消息不受影响')),
    row('reconciliation', '外部会话与Echo定期对账', account.historySyncAvailable !== true ? 'warning' : account.reconciliationLastError ? 'fail' : account.reconciliationActive === true ? (account.reconciliationLastAt ? 'pass' : 'pending') : 'warning', account.reconciliationLastError || (account.reconciliationLastAt ? `最近完成：${account.reconciliationLastAt}` : account.reconciliationActive ? '已启用，等待首轮结果' : '尚未启用定期对账'), {
      active: account.reconciliationActive === true,
      running: account.reconciliationRunning === true,
      lastAt: clean(account.reconciliationLastAt),
      lastResult: account.reconciliationLastResult || null
    }),
    row('first-contact-uat', '新联系人首条消息真实验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '源码链已接线，仍需真实公共主页首条消息证据' : '账号未连接'),
    row('echo-uat', 'Business Suite外部发送Echo真实验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '源码链已接线，仍需Business Suite真实发送证据' : '账号未连接')
  ];
  return checks;
}
function summarizeWhatsapp(account = {}) {
  const onboarding = isOnboarding(account);
  const identity = account.identityReconciliationLastResult || null;
  const identityStatus = onboarding ? 'pending'
    : account.identityReconciliationLastError ? 'fail'
      : identity ? (Number(identity.failed || 0) > 0 ? 'warning' : 'pass')
        : isConnected(account) ? 'pending' : 'fail';
  return [
    row('credential', '本机认证与会话', account.credentialReady === true ? 'pass' : onboarding ? 'pending' : 'fail', account.credentialReady === true ? '认证目录可用' : '等待扫码或认证恢复'),
    sendCheck(account, onboarding),
    row('receive', '实时消息接收', account.canReceive === true ? 'pass' : onboarding ? 'pending' : 'fail', account.canReceive === true ? '接收链可用' : '账号未达到接收状态'),
    row('identity', 'LID/手机号JID身份合并', identityStatus, account.identityReconciliationLastError || (identity ? `扫描${Number(identity.scanned || 0)}个会话，合并${Number(identity.conversationMerges || 0)}组，失败${Number(identity.failed || 0)}项` : '等待连接后的身份对账结果'), {
      running: account.identityReconciliationRunning === true,
      lastAt: clean(account.identityReconciliationLastAt),
      result: identity
    }),
    row('media-uat', '图片、语音、GIF、贴纸与附件真实验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '适配器能力已接线，仍需真实账号收发证据' : '账号未连接'),
    row('offline-uat', '离线队列、重连补发与幂等真实验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '需要断网与重连故障注入证据' : '账号未连接')
  ];
}
function summarizeTelegram(account = {}) {
  const onboarding = isOnboarding(account);
  const history = account.historySyncLastResult || null;
  const historyStatus = onboarding ? 'pending'
    : account.historySyncLastError ? 'warning'
      : history ? (Number(history.failedConversations || 0) > 0 || Number(history.failedMessages || 0) > 0 ? 'warning' : 'pass')
        : isConnected(account) ? 'pending' : 'fail';
  return [
    row('credential', '登录与会话恢复', account.credentialReady === true ? 'pass' : onboarding ? 'pending' : 'fail', account.credentialReady === true ? 'Telegram会话凭据可用' : '等待二维码、验证码或两步验证'),
    sendCheck(account, onboarding),
    row('receive', '实时消息接收', account.canReceive === true ? 'pass' : onboarding ? 'pending' : 'fail', account.canReceive === true ? '接收链可用' : '账号未达到接收状态'),
    row('history', '历史消息与头像同步', historyStatus, account.historySyncLastError || (history ? `会话${Number(history.conversations || 0)}个，新增消息${Number(history.messagesInserted || 0)}条，失败会话${Number(history.failedConversations || 0)}个` : '等待首次历史同步结果'), {
      lastAt: clean(account.historySyncLastAt || account.lastSyncAt),
      result: history
    }),
    row('login-uat', '二维码/验证码真实登录验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '当前账号已连接；新登录流程仍需真机证据' : '尚未完成真实登录'),
    row('media-uat', '图片、语音、贴纸与动态表达真实验收', isConnected(account) ? 'uat-required' : onboarding ? 'pending' : 'fail', isConnected(account) ? '适配器能力已接线，仍需真实账号收发证据' : '账号未连接')
  ];
}
function accountChecks(account = {}) {
  const platform = clean(account.platform).toLowerCase();
  if (platform === 'facebook') return summarizeFacebook(account);
  if (platform === 'whatsapp') return summarizeWhatsapp(account);
  if (platform === 'telegram') return summarizeTelegram(account);
  return [];
}
function aggregateAccount(account = {}) {
  const checks = accountChecks(account);
  const fail = checks.filter(item => item.status === 'fail');
  const warning = checks.filter(item => item.status === 'warning');
  const pending = checks.filter(item => item.status === 'pending');
  const uat = checks.filter(item => item.status === 'uat-required');
  let status = STATUS.READY;
  if (isOnboarding(account)) status = STATUS.ONBOARDING;
  else if (fail.length) status = STATUS.BLOCKED;
  else if (warning.length || pending.length) status = STATUS.DEGRADED;
  else if (uat.length) status = STATUS.READY_FOR_REAL_UAT;
  return {
    accountId: clean(account.id),
    platform: clean(account.platform).toLowerCase(),
    displayName: clean(account.displayName || account.identityLabel || account.user?.name),
    state: clean(account.state),
    status,
    checks,
    counts: { pass: checks.filter(item => item.status === 'pass').length, fail: fail.length, warning: warning.length, pending: pending.length, realUatRequired: uat.length }
  };
}
function evaluate(accountState = {}) {
  const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
  const byPlatform = {};
  for (const platform of PLATFORM_ORDER) {
    const rows = accounts.filter(account => clean(account.platform).toLowerCase() === platform).map(aggregateAccount);
    if (!rows.length) {
      byPlatform[platform] = { platform, status: STATUS.NOT_CONFIGURED, accounts: [], counts: { total: 0, blocked: 0, degraded: 0, onboarding: 0, readyForRealUat: 0, ready: 0 }, realUatCompleted: false };
      continue;
    }
    const counts = {
      total: rows.length,
      blocked: rows.filter(item => item.status === STATUS.BLOCKED).length,
      degraded: rows.filter(item => item.status === STATUS.DEGRADED).length,
      onboarding: rows.filter(item => item.status === STATUS.ONBOARDING).length,
      readyForRealUat: rows.filter(item => item.status === STATUS.READY_FOR_REAL_UAT).length,
      ready: rows.filter(item => item.status === STATUS.READY).length
    };
    const usable = counts.ready + counts.readyForRealUat + counts.degraded;
    const status = counts.blocked === rows.length ? STATUS.BLOCKED
      : counts.onboarding === rows.length ? STATUS.ONBOARDING
        : counts.blocked > 0 && (usable > 0 || counts.onboarding > 0) ? STATUS.DEGRADED
          : counts.degraded ? STATUS.DEGRADED
            : counts.onboarding > 0 && usable > 0 ? STATUS.DEGRADED
              : counts.readyForRealUat ? STATUS.READY_FOR_REAL_UAT
                : STATUS.READY;
    byPlatform[platform] = { platform, status, accounts: rows, counts, realUatCompleted: false };
  }
  const configured = Object.values(byPlatform).filter(item => item.status !== STATUS.NOT_CONFIGURED);
  return {
    schemaVersion: 1,
    documentType: 'YANCE_PLATFORM_PRODUCTION_READINESS',
    generatedAt: new Date().toISOString(),
    platforms: byPlatform,
    summary: {
      configuredPlatforms: configured.length,
      blockedPlatforms: configured.filter(item => item.status === STATUS.BLOCKED).length,
      degradedPlatforms: configured.filter(item => item.status === STATUS.DEGRADED).length,
      onboardingPlatforms: configured.filter(item => item.status === STATUS.ONBOARDING).length,
      readyForRealUatPlatforms: configured.filter(item => item.status === STATUS.READY_FOR_REAL_UAT).length,
      realUatCompleted: false
    }
  };
}

module.exports = { STATUS, PLATFORM_ORDER, evaluate, accountChecks, aggregateAccount };
