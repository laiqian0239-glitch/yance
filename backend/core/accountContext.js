'use strict';

const crypto = require('crypto');
const { CoreError } = require('../../shared/core/errors');
const sendMessageService = require('../services/sendMessageService');
const accountLifecycleCommands = require('../services/accountLifecycleCommands');
const typingStateService = require('../services/typingStateService');
const { stableId } = require('../lib/r32SqliteStore');
const platformAdapterRegistry = require('../services/platformAdapterPorts').singleton;

function clean(value) { return String(value == null ? '' : value).trim(); }
function physicalOperationOptions(request = {}) {
  return {
    signal: request.signal || null,
    attemptId: clean(request.operationGeneration),
    operationGeneration: clean(request.operationGeneration),
    physicalOperationContext: request.physicalOperationContext
  };
}

class AccountContext {
  constructor({
    securityGuard,
    accountManager,
    accountStore,
    accountMigration,
    messageStore,
    sendQueue,
    platformMessaging,
    platformCapabilities,
    platformDrivers,
    canonicalIdentity,
    eventBus
  }) {
    this.securityGuard = securityGuard;
    this.accountManager = accountManager;
    this.accountStore = accountStore;
    this.accountMigration = accountMigration;
    this.messageStore = messageStore;
    this.sendQueue = sendQueue;
    this.platformMessaging = platformMessaging;
    this.sendMessageService = sendMessageService;
    this.lifecycle = accountLifecycleCommands;
    this.platformAdapters = platformAdapterRegistry;
    this.platformCapabilities = platformCapabilities;
    this.platformDrivers = platformDrivers;
    this.canonicalIdentity = canonicalIdentity;
    this.eventBus = eventBus;
    this.started = false;
    this.startedAt = '';
    this.bindPlatformAdapterPorts();
  }


  bindPlatformAdapterPorts() {
    const authHandler = {
      execute: async request => {
        const operation = clean(request.operation);
        const accountId = clean(request.accountId);
        switch (operation) {
          case 'connect': return this.lifecycle.start(accountId, { action: 'connect', ...physicalOperationOptions(request) });
          case 'reconnect': return this.lifecycle.restart(accountId, { action: 'reconnect', ...physicalOperationOptions(request) });
          case 'pause': return this.lifecycle.operationResult('pause', await this.accountManager.disconnect(accountId, { logout: false, ...physicalOperationOptions(request) }));
          case 'resume': return this.lifecycle.start(accountId, { action: 'resume', ...physicalOperationOptions(request) });
          case 'logout': return this.lifecycle.operationResult('logout', await this.accountManager.disconnect(accountId, { logout: true, ...physicalOperationOptions(request) }));
          case 'telegram.qr.start': return { account: await this.accountManager.startTelegramQr(accountId, physicalOperationOptions(request)) };
          case 'telegram.phone.start': return { account: await this.accountManager.startTelegramPhone(accountId, request.phoneNumber, physicalOperationOptions(request)) };
          case 'telegram.code': return { account: await this.accountManager.submitTelegramCode(accountId, request.code, physicalOperationOptions(request)) };
          case 'telegram.password': return { account: await this.accountManager.submitTelegramPassword(accountId, request.password, physicalOperationOptions(request)) };
          case 'telegram.cancel': return { account: await this.accountManager.cancelTelegramLogin(accountId, physicalOperationOptions(request)) };
          case 'facebook.oauth.start': return { flow: await this.accountManager.beginFacebookOAuth(accountId, physicalOperationOptions(request)) };
          case 'facebook.oauth.status': return { flow: await this.accountManager.pollFacebookOAuth(accountId, request.flowId, physicalOperationOptions(request)) };
          case 'facebook.oauth.selectPage': return this.accountManager.selectFacebookPage(accountId, request.flowId, request.pageId, physicalOperationOptions(request));
          case 'facebook.oauth.cancel': return { flow: await this.accountManager.cancelFacebookOAuth(accountId, request.flowId, physicalOperationOptions(request)) };
          default: throw new CoreError('PLATFORM_AUTH_OPERATION_UNSUPPORTED', `AuthPort 不支持操作：${operation}`, { status: 404 });
        }
      }
    };
    const reconcileHandler = async request => {
      const operation = clean(request.operation) || 'sync';
      const accountId = clean(request.accountId);
      switch (operation) {
        case 'sync': return this.accountManager.sync(accountId, { ...physicalOperationOptions(request), executionGeneration: request.operationGeneration });
        case 'facebook.avatar-import.start': return { session: this.accountManager.startFacebookBusinessSuiteAvatarImport(accountId, physicalOperationOptions(request)) };
        case 'facebook.avatar-import.status': return { session: this.accountManager.getFacebookBusinessSuiteAvatarImportStatus(accountId, physicalOperationOptions(request)) };
        case 'facebook.avatar-import.stop': return { session: this.accountManager.stopFacebookBusinessSuiteAvatarImport(accountId, physicalOperationOptions(request)) };
        case 'facebook.avatar-closure.diagnose': return { report: await this.accountManager.diagnoseFacebookAvatarClosure(accountId, { limit: request.limit, ...physicalOperationOptions(request) }) };
        default: throw new CoreError('PLATFORM_RECONCILE_OPERATION_UNSUPPORTED', `ReconcilePort 不支持操作：${operation}`, { status: 404 });
      }
    };
    for (const platform of ['facebook', 'whatsapp', 'telegram']) {
      this.platformAdapters.bind(platform, { authHandler, reconcileHandler });
    }
  }

  async executePlatformAuth(accountId, operation, payload = {}) {
    const account = this.getAccount(accountId);
    return this.platformAdapters.executeAuth({
      schemaVersion: 1,
      platform: clean(account.platform).toLowerCase(),
      accountId: account.id,
      operation,
      ...payload
    });
  }

  async executePlatformReconcile(accountId, operation = 'sync', payload = {}) {
    const account = this.getAccount(accountId);
    return this.platformAdapters.reconcile({
      schemaVersion: 1,
      platform: clean(account.platform).toLowerCase(),
      accountId: account.id,
      operation,
      ...payload
    });
  }

  async reconnectAllAccounts() {
    const results = [];
    for (const account of this.accountManager.list().accounts || []) {
      if (account.lifecycleState === 'tombstoned' || account.mergedIntoId || account.paused || account.autoReconnect === false) continue;
      try { results.push({ accountId: account.id, ok: true, account: await this.executePlatformAuth(account.id, 'reconnect') }); }
      catch (error) { results.push({ accountId: account.id, ok: false, error: error.message, code: error.code || '' }); }
    }
    return results;
  }

  async reconcileAllAccounts() {
    const results = [];
    for (const account of this.accountManager.list().accounts || []) {
      if (account.lifecycleState === 'tombstoned' || account.mergedIntoId || account.paused) continue;
      try { results.push({ accountId: account.id, ok: true, ...(await this.executePlatformReconcile(account.id, 'sync')) }); }
      catch (error) { results.push({ accountId: account.id, ok: false, error: error.message, code: error.code || '' }); }
    }
    return results;
  }

  async prepare() {
    const hydration = this.accountManager.beginHydration?.() || { ready: true };
    return { ok: true, accounts: this.accountStore.list().length, hydration };
  }

  async start() {
    await this.accountManager.hydrateAndRecover?.();
    this.started = true;
    this.startedAt = new Date().toISOString();
    return this.snapshot();
  }

  async pause() {
    this.sendQueue?.pause?.('lifecycle-suspended');
    return { paused: true };
  }

  async resume() {
    this.sendQueue?.resume?.();
    return { resumed: true };
  }

  async offline() {
    this.sendQueue?.pause?.('network-offline');
    return { offline: true };
  }

  async online() {
    this.sendQueue?.resume?.();
    return { online: true };
  }

  async enterSafeMode() {
    this.sendQueue?.pause?.('safe-mode');
    await this.accountManager.shutdown();
    return { safeMode: true, connectionsStopped: true };
  }

  async exitSafeMode() {
    this.sendQueue?.resume?.();
    return { safeMode: false, queueResumed: true };
  }

  async beforeUpdate() {
    this.sendQueue?.pause?.('update-install');
    await this.accountManager.shutdown();
    return { readyForUpdate: true };
  }

  async stop() {
    await this.accountManager.shutdown();
    this.started = false;
    return { stopped: true };
  }

  snapshot() {
    const data = this.accountManager.list();
    return {
      module: 'AccountContext',
      ready: this.started,
      startedAt: this.startedAt,
      summary: data.summary,
      defaults: data.defaults,
      canonicalAccounts: data.accounts.filter(row => !row.mergedIntoId && row.lifecycleState !== 'tombstoned').length
    };
  }

  async secured(action, context, operation) {
    return this.securityGuard.execute(action, { actor: 'backend-core', ...context }, operation);
  }

  getAccount(id) {
    const targetId = clean(id);
    const account = this.accountStore.get(targetId)
      || (this.accountManager.list().accounts || []).find(row => clean(row.id) === targetId)
      || null;
    if (!account) throw new CoreError('ACCOUNT_NOT_FOUND', '账号不存在', { status: 404 });
    const canonicalId = this.canonicalIdentity.resolveCanonicalAccountId(account.id);
    if (canonicalId && canonicalId !== account.id) {
      const canonical = this.accountStore.get(canonicalId);
      if (canonical) return canonical;
    }
    return account;
  }

  async execute(command, payload = {}, context = {}) {
    switch (command) {
      case 'account.list': return this.accountManager.list();
      case 'account.audit': {
        const limit = Math.max(1, Math.min(Number(payload.limit || 100), 500));
        return { audit: this.accountStore.read().audit.slice(0, limit) };
      }
      case 'account.capabilities': return { matrix: this.accountManager.CAPABILITY_MATRIX, contracts: this.platformCapabilities.publicContracts() };
      case 'account.create': return this.secured(command, context, async () => ({ account: await this.accountManager.create(payload) }));
      case 'account.update': return this.secured(command, context, async () => ({ account: await this.accountManager.update(payload.id, payload.patch || {}) }));
      case 'account.remove': return this.secured(command, context, async () => ({ removed: await this.accountManager.remove(payload.id, { clearCredentials: payload.clearCredentials === true, logout: payload.logout === true }) }));
      case 'account.authorization.discardPending': return this.secured(command, context, async () => this.accountManager.discardPendingAuthorization(payload.id, payload.reason));
      case 'account.setDefault': return this.secured(command, context, async () => {
        const account = this.getAccount(payload.id);
        return { account: await this.accountManager.setDefault(account.platform, account.id) };
      });
      case 'account.connect': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'connect'));
      case 'account.reconnect': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'reconnect'));
      case 'account.sync': return this.secured(command, context, async () => this.executePlatformReconcile(payload.id, 'sync'));
      case 'account.syncAll': return this.secured(command, context, async () => ({ results: await this.reconcileAllAccounts() }));
      case 'account.reconnectAll': return this.secured(command, context, async () => ({ results: await this.reconnectAllAccounts() }));
      case 'account.pause': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'pause'));
      case 'account.resume': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'resume'));
      case 'account.logout': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'logout'));
      case 'account.diagnose': return { report: await this.accountManager.diagnose(payload.id) };
      case 'account.facebook.avatarClosure.diagnose': return this.executePlatformReconcile(payload.id, 'facebook.avatar-closure.diagnose', { limit: payload.limit });
      case 'account.facebook.avatarImport.start': return this.secured(command, context, async () => this.executePlatformReconcile(payload.id, 'facebook.avatar-import.start'));
      case 'account.facebook.avatarImport.status': return this.executePlatformReconcile(payload.id, 'facebook.avatar-import.status');
      case 'account.facebook.avatarImport.stop': return this.secured(command, context, async () => this.executePlatformReconcile(payload.id, 'facebook.avatar-import.stop'));
      case 'account.migration.scan': return { plan: this.accountMigration.scan(payload.sourceDir) };
      case 'account.migration.import': return this.secured(command, context, async () => this.accountMigration.execute(payload.confirmToken, payload.selectedIds || []));
      case 'account.telegram.qr.start': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'telegram.qr.start'));
      case 'account.telegram.phone.start': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'telegram.phone.start', { phoneNumber: payload.phoneNumber }));
      case 'account.telegram.code': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'telegram.code', { code: payload.code }));
      case 'account.telegram.password': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'telegram.password', { password: payload.password }));
      case 'account.telegram.cancel': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'telegram.cancel'));
      case 'account.facebook.oauth.start': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'facebook.oauth.start'));
      case 'account.facebook.oauth.status': return this.executePlatformAuth(payload.id, 'facebook.oauth.status', { flowId: payload.flowId });
      case 'account.facebook.oauth.selectPage': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'facebook.oauth.selectPage', { flowId: payload.flowId, pageId: payload.pageId }));
      case 'account.facebook.oauth.cancel': return this.secured(command, context, async () => this.executePlatformAuth(payload.id, 'facebook.oauth.cancel', { flowId: payload.flowId }));
      case 'account.facebook.webhook.verify': return this.verifyFacebookWebhook(payload);
      case 'account.facebook.webhook.handle': return this.handleFacebookWebhook(payload);
      case 'account.bindConversation': return this.secured(command, context, async () => this.bindConversation(payload));
      case 'account.getRuntime': return this.getRuntime(payload.id);
      case 'account.getAuthChallenge': return this.accountManager.getAuthChallenge(payload.id);
      case 'account.getCredentialState': return this.getCredentialState(payload.id);
      case 'account.avatarLoadFailure': return this.accountManager.recordAvatarLoadFailure(payload.id, payload);
      case 'message.sendText': return this.secured(command, context, async () => this.sendText(payload));
      case 'message.sendMedia': return this.secured(command, context, async () => this.sendMedia(payload));
      case 'message.sendMediaFile': return this.secured(command, context, async () => this.sendMediaFile(payload));
      case 'message.sendExpression': return this.secured(command, context, async () => this.sendExpression(payload));
      case 'message.sendReaction': return this.secured(command, context, async () => this.sendQueuedAction('reaction', payload));
      case 'message.revoke': return this.secured(command, context, async () => this.sendQueuedAction('revoke', payload));
      case 'message.presence': return this.secured(command, context, async () => ({ result: await this.sendMessageService.sendPresence(payload) }));
      case 'message.typing.cancel': return this.secured(command, context, async () => {
        const cause = clean(payload.cause || payload.reason).toLowerCase();
        const result = cause === 'manual_input'
          ? await typingStateService.notifyManualTyping(payload)
          : cause === 'conversation_changed'
            ? await typingStateService.notifyConversationChanged(payload)
            : cause === 'user_cancel'
              ? await typingStateService.notifyUserCancel(payload)
              : await typingStateService.cancelApprovedSend(payload);
        return { result };
      });
      case 'message.markRead': return this.secured(command, context, async () => this.markRead(payload));
      case 'message.queue.list': return { queue: this.sendQueue.list({ state: payload.state, limit: Number(payload.limit || 200) }) };
      case 'message.queue.retry': return this.secured(command, context, async () => {
        const queue = await this.sendQueue.retry(payload.id);
        if (!queue) throw new CoreError('SEND_QUEUE_ITEM_NOT_FOUND', '发送队列任务不存在', { status: 404 });
        return { queue };
      });
      case 'message.queue.cancel': return this.secured(command, context, async () => {
        const queue = await this.sendQueue.cancel(payload.id);
        if (!queue) throw new CoreError('SEND_QUEUE_ITEM_NOT_FOUND', '发送队列任务不存在', { status: 404 });
        return { queue };
      });
      case 'message.queue.resolveOutcome': return this.secured(command, context, async () => {
        return this.sendQueue.resolveOutcomeUnknown(payload.id, payload.resolution, {
          actor: clean(context.actor || context.source || 'desktop-user'),
          reason: clean(payload.reason || (payload.resolution === 'confirmed_sent'
            ? '用户在对应平台人工确认该消息已发送'
            : payload.resolution === 'confirmed_not_sent'
              ? '用户在对应平台人工确认该消息未发送'
              : '用户取消该不确定发送任务')),
          evidenceType: 'manual-platform-check',
          evidenceId: clean(payload.evidenceId),
          evidence: payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {}
        });
      });
      default: throw new CoreError('ACCOUNT_CONTEXT_COMMAND_UNSUPPORTED', `AccountContext 不支持命令：${command}`, { status: 404 });
    }
  }


  assertConversationRouteScope(payload = {}) {
    const requestedConversationId = clean(payload.conversationId);
    if (!requestedConversationId) return null;
    const conversation = this.messageStore.getConversation?.(requestedConversationId) || null;
    if (!conversation) {
      throw new CoreError('CONVERSATION_NOT_FOUND', '会话不存在，无法更新已读状态', { status: 404, details: { conversationId: requestedConversationId } });
    }

    const expectedPlatform = clean(conversation.platform).toLowerCase();
    const requestedPlatform = clean(payload.platform).toLowerCase();
    const expectedAccountId = clean(conversation.accountId);
    const requestedAccountId = clean(payload.accountId);
    const expectedTarget = clean(conversation.chatJid || conversation.externalId || conversation.recipientId).replace(/^(?:telegram|facebook):/i, '');
    const requestedTarget = clean(payload.chatJid || payload.recipientId).replace(/^(?:telegram|facebook):/i, '');

    const accountIds = new Set([expectedAccountId].filter(Boolean));
    for (const account of this.accountStore?.list?.() || []) {
      const ids = [clean(account.id), clean(account.adapterAccountId)].filter(Boolean);
      if (ids.includes(expectedAccountId)) ids.forEach(id => accountIds.add(id));
    }
    const mismatch = Boolean(
      (requestedPlatform && expectedPlatform && requestedPlatform !== expectedPlatform) ||
      (requestedAccountId && expectedAccountId && !accountIds.has(requestedAccountId)) ||
      (requestedTarget && expectedTarget && requestedTarget !== expectedTarget)
    );
    if (mismatch) {
      throw new CoreError('CONVERSATION_ROUTE_SCOPE_MISMATCH', '会话与平台账号或目标身份不一致，已拒绝更新已读状态', {
        status: 409,
        details: {
          conversationId: clean(conversation.conversationId || conversation.sessionKey || requestedConversationId),
          expected: { platform: expectedPlatform, sourceAccountId: expectedAccountId, platformContactIdentity: expectedTarget },
          requested: { platform: requestedPlatform, sourceAccountId: requestedAccountId, platformContactIdentity: requestedTarget }
        }
      });
    }
    return conversation;
  }

  async markRead(payload = {}) {
    const conversation = this.assertConversationRouteScope(payload);
    const route = conversation ? {
      ...payload,
      conversationId: clean(conversation.conversationId || conversation.sessionKey || payload.conversationId),
      platform: clean(conversation.platform || payload.platform).toLowerCase(),
      accountId: clean(conversation.accountId || payload.accountId),
      chatJid: clean(conversation.chatJid || conversation.externalId || payload.chatJid || payload.recipientId)
    } : { ...payload, chatJid: payload.chatJid || payload.recipientId };
    const local = route.conversationId ? await this.messageStore.markRead(route.conversationId) : null;
    let platform = null;
    let platformWarning = null;
    if (route.accountId && route.chatJid) {
      try {
        platform = await this.sendMessageService.markRead(route);
      } catch (error) {
        platformWarning = {
          ok: false,
          code: error.code || 'PLATFORM_READ_RECEIPT_FAILED',
          message: error.message || '平台已读回执发送失败'
        };
      }
    }
    return { local, platform, platformWarning, routeScope: conversation ? {
      platform: route.platform,
      sourceAccountId: route.accountId,
      platformContactIdentity: route.chatJid,
      conversationId: route.conversationId,
      canonicalContactId: clean(conversation.canonicalContactId || conversation.customerProfileId || conversation.contactId)
    } : null };
  }

  async bindConversation(payload) {
    const account = this.getAccount(payload.id);
    const publicAccount = this.accountManager.publicAccount(account);
    if (publicAccount.canAttemptSend !== true) throw new CoreError('ACCOUNT_CANNOT_ATTEMPT_SEND', `账号不满足发送前置条件：${publicAccount.stateLabel}`, { status: 409 });
    const conversation = await this.messageStore.bindConversationAccount(payload.conversationId, account, payload.externalConversationId || '');
    const binding = await this.accountStore.bindConversation(payload.conversationId, account.id, account.platform, payload.externalConversationId || conversation?.chatJid || '');
    return { binding, conversation, account: publicAccount, accountId: account.id };
  }

  getRuntime(id) {
    const account = this.getAccount(id);
    return { account: this.accountManager.list().accounts.find(row => row.id === account.id) || null };
  }

  getCredentialState(id) {
    const account = this.getAccount(id);
    if (account.platform === 'whatsapp') {
      const state = this.platformDrivers.call('whatsapp', 'credentialState', account);
      return {
        credentialReady: state.usable,
        credentialRef: account.credentialRef,
        authAccountKey: state.accountKey,
        registeredFlag: state.registered,
        hasIdentity: state.hasIdentity,
        migrated: state.migrated,
        error: state.error || ''
      };
    }
    return { credentialReady: this.securityGuard.credentials.has(account.credentialRef), credentialRef: account.credentialRef };
  }

  async sendText(payload) {
    if (payload.conversationId || payload.recipientId) {
      return { result: await this.accountManager.sendText({
        accountId: payload.accountId,
        conversationId: payload.conversationId,
        recipientId: payload.recipientId || payload.chatJid,
        text: payload.text,
        quoted: payload.quoted || null,
        idempotencyKey: payload.idempotencyKey || ''
      }) };
    }
    const queue = await this.sendQueue.enqueueText(payload);
    return this.queueTerminal(queue);
  }

  async sendMedia(payload) {
    const created = await this.sendQueue.enqueueMedia(payload);
    return this.queueTerminal(created.queue, { upload: created.upload });
  }

  async sendMediaFile(payload) {
    const created = await this.sendQueue.enqueueMediaFile(payload);
    return this.queueTerminal(created.queue, { upload: created.upload });
  }

  async sendExpression(payload = {}) {
    const platform = clean(payload.platform).toLowerCase();
    if (platform !== 'telegram') {
      throw new CoreError('PLATFORM_OPERATION_UNSUPPORTED', '当前只有 Telegram 原生素材支持账号会话内引用发送', { status: 400 });
    }
    const accountId = clean(payload.accountId);
    const chatJid = clean(payload.chatJid || payload.recipientId);
    const reference = clean(payload.reference || payload.sendReference);
    if (!accountId || !chatJid || !reference) {
      throw new CoreError('TELEGRAM_EXPRESSION_SEND_INVALID', 'Telegram 原生素材发送缺少账号、会话或素材引用', { status: 400 });
    }
    const queue = await this.sendQueue.enqueueAction({
      ...payload,
      platform,
      accountId,
      chatJid,
      reference,
      operation: 'native_expression',
      idempotencyKey: clean(payload.idempotencyKey) || crypto.randomUUID()
    });
    return this.queueTerminal(queue);
  }

  async sendQueuedAction(operation, payload = {}) {
    const queue = await this.sendQueue.enqueueAction({
      ...payload,
      operation,
      idempotencyKey: clean(payload.idempotencyKey) || crypto.randomUUID()
    });
    return this.queueTerminal(queue);
  }

  async queueTerminal(queue, extra = {}) {
    const terminal = this.sendQueue.status().started ? await this.sendQueue.waitForTerminal(queue.id, Number(extra.waitMs || 6500)) : { queue };
    const resultQueue = terminal.queue || queue;
    return { queue: resultQueue, result: terminal.result || null, error: terminal.error || null, state: resultQueue.state || 'pending', ...extra };
  }

  verifyFacebookWebhook(payload) {
    const accounts = this.accountStore.list();
    const challenge = this.platformDrivers.call('facebook', 'verifyWebhook', payload.mode, payload.token, payload.challenge, accounts);
    return { valid: challenge != null, challenge };
  }

  async handleFacebookWebhook(payload) {
    const accounts = this.accountStore.list();
    const signature = this.platformDrivers.call('facebook', 'verifyWebhookSignature', payload.rawBody, payload.signature, accounts, payload.body || {});
    if (!signature.valid) throw new CoreError('INVALID_WEBHOOK_SIGNATURE', 'Webhook签名校验失败', { status: 401 });
    return { signature, ...(await this.platformDrivers.call('facebook', 'handleWebhook', payload.body || {}, accounts)) };
  }
}

module.exports = { AccountContext };
