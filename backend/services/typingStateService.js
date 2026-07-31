'use strict';

const defaultEventBus = require('./eventBus');
const defaultLogger = require('./logger');
const defaultMessaging = require('./sendMessageService');
const {
  normalizeTypingPolicy,
  buildHumanTypingPlan,
  buildSingleTypingPlan,
  normalizeActivity,
  activityIsActive,
  typingPolicyFromEnvironment
} = require('../store/typing/typingPolicy');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function abortError(reason = 'TYPING_SIMULATION_ABORTED') {
  const error = new Error(reason);
  error.name = 'AbortError';
  error.code = reason;
  return error;
}

function wait(ms, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortError(signal.reason || 'TYPING_SIMULATION_ABORTED'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal.reason || 'TYPING_SIMULATION_ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function accountStateIsConnected(value) {
  return /^(online|connected|ready)$/i.test(clean(value));
}

class TypingStateService {
  constructor(options = {}) {
    this.started = false;
    this.storeManager = options.storeManager || null;
    this.resolveContact = typeof options.resolveContact === 'function' ? options.resolveContact : null;
    this.eventBus = options.eventBus || defaultEventBus;
    this.messaging = options.messaging || defaultMessaging;
    this.logger = options.logger || defaultLogger;
    this.policy = normalizeTypingPolicy({ ...typingPolicyFromEnvironment(), ...(options.policy || {}) });
    this.waitFn = typeof options.wait === 'function' ? options.wait : wait;
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.incomingTimers = new Map();
    this.outgoingSessions = new Map();
    this.approvedRuns = new Map();
    this.unsubscribers = [];
    this.sequence = 0;
  }

  configure(options = {}) {
    if (options.storeManager) this.storeManager = options.storeManager;
    if (typeof options.resolveContact === 'function') this.resolveContact = options.resolveContact;
    if (options.eventBus) this.eventBus = options.eventBus;
    if (options.messaging) this.messaging = options.messaging;
    if (options.logger) this.logger = options.logger;
    if (typeof options.wait === 'function') this.waitFn = options.wait;
    if (typeof options.random === 'function') this.random = options.random;
    this.policy = normalizeTypingPolicy({ ...this.policy, ...(options.policy || {}) });
    return this.status();
  }

  start(options = {}) {
    this.configure(options);
    if (this.started) return this.status();
    if (!this.storeManager?.dispatch || !this.storeManager?.select) {
      throw new Error('TypingStateService requires StoreManager');
    }
    this.started = true;
    this._bind('conversation:presence', event => this._handleIncomingPresence(event));
    this._bind('message:inserted', event => this._handleMessageInserted(event));
    this._bind('account:state', event => this._handleAccountState(event));
    this._bind('whatsapp:state', event => this._handleAccountState(event));
    this.storeManager.dispatch({
      type: 'UPDATE_TYPING_POLICY',
      source: 'typing-state-service',
      payload: this.policy
    }).catch(error => this._log('warn', 'typing-policy-sync-failed', { error: error.message }));
    return this.status();
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try { unsubscribe(); } catch (_) {}
    }
    for (const timer of this.incomingTimers.values()) clearTimeout(timer.timer);
    this.incomingTimers.clear();
    for (const run of this.approvedRuns.values()) {
      run.controller?.abort?.('TYPING_SERVICE_STOPPED');
    }
    this.approvedRuns.clear();
    for (const session of this.outgoingSessions.values()) {
      clearInterval(session.heartbeat);
      session.controller?.abort?.('TYPING_SERVICE_STOPPED');
      if (session.platformEnabled) this._sendPresence(session.target, 'paused').catch(() => {});
    }
    this.outgoingSessions.clear();
    this.started = false;
  }

  status() {
    return {
      started: this.started,
      policy: this.policy,
      incomingTimers: this.incomingTimers.size,
      outgoingSessions: this.outgoingSessions.size,
      approvedRuns: this.approvedRuns.size
    };
  }

  _log(level, message, detail = {}) {
    const writer = this.logger?.[level];
    if (typeof writer === 'function') writer.call(this.logger, 'typing', message, detail);
  }

  _bind(type, handler) {
    const listener = event => Promise.resolve(handler(event)).catch(error => {
      this._log('warn', 'event-handler-failed', { type, code: error.code || '', error: error.message });
    });
    this.eventBus.on(type, listener);
    this.unsubscribers.push(() => this.eventBus.off(type, listener));
  }

  async _resolveContactId(conversationId, contactIdHint = '') {
    const direct = clean(contactIdHint);
    if (direct) return direct;
    if (!conversationId || typeof this.resolveContact !== 'function') return '';
    return clean(await this.resolveContact(conversationId));
  }

  async _handleIncomingPresence(wrapperEvent) {
    const payload = wrapperEvent?.payload || {};
    const conversationId = clean(payload.conversationId);
    if (!conversationId) return;
    const contactId = await this._resolveContactId(conversationId, payload.contactId);
    if (!contactId) return;
    const activity = normalizeActivity(payload.state || payload.activity || payload.action);
    const isTyping = activityIsActive(activity);
    const lastUpdated = clean(payload.at) || new Date().toISOString();
    await this.storeManager.dispatch({
      type: 'UPDATE_CONTACT_TYPING_STATE',
      source: `${clean(payload.platform) || 'platform'}-typing-adapter`,
      payload: {
        contactId,
        conversationId,
        accountId: payload.accountId,
        platform: payload.platform,
        participant: payload.participant,
        isTyping,
        activity,
        lastUpdated,
        ttlMs: this.policy.inboundTtlMs
      }
    });
    if (isTyping) this._scheduleIncomingExpiry(contactId, lastUpdated);
    else this._clearIncomingTimer(contactId);
  }

  async _handleMessageInserted(wrapperEvent) {
    const message = wrapperEvent?.payload?.message || {};
    if (!message || String(message.direction || '').toLowerCase() === 'outbound' || message.fromMe === true) return;
    const conversationId = clean(message.conversationId || message.sessionKey);
    if (!conversationId) return;
    const contactId = await this._resolveContactId(conversationId, message.contactId);
    if (!contactId) return;
    if (this.policy.cancelOnNewIncomingMessage) {
      await this.cancelApprovedSend({
        contactId,
        conversationId,
        accountId: message.accountId,
        platform: message.platform,
        reason: 'NEW_INCOMING_MESSAGE'
      });
    }
    this._clearIncomingTimer(contactId);
    await this.storeManager.dispatch({
      type: 'UPDATE_CONTACT_TYPING_STATE',
      source: 'incoming-message-clears-typing',
      payload: {
        contactId,
        conversationId,
        accountId: message.accountId,
        platform: message.platform,
        isTyping: false,
        activity: 'paused',
        lastUpdated: new Date().toISOString(),
        reason: 'message_received'
      }
    });
  }

  async _handleAccountState(wrapperEvent) {
    const payload = wrapperEvent?.payload || {};
    const state = clean(payload.state || payload.status);
    if (accountStateIsConnected(state)) return;
    const accountId = clean(payload.accountId || payload.id);
    const platform = clean(payload.platform || (wrapperEvent?.type === 'whatsapp:state' ? 'whatsapp' : '')).toLowerCase();
    if (!accountId && !platform) return;

    if (this.policy.cancelOnAccountChange) {
      await this.cancelApprovedSend({ accountId, platform, reason: 'ACCOUNT_STATE_CHANGED' });
    }

    const snapshot = this.storeManager.select(current => current.typingState?.byContactId || {});
    const clears = [];
    for (const [contactId, row] of Object.entries(snapshot)) {
      if (!this._accountMatches(row, accountId, platform)) continue;
      this._clearIncomingTimer(contactId);
      clears.push(this.storeManager.dispatch({
        type: 'UPDATE_CONTACT_TYPING_STATE',
        source: 'account-disconnect-clears-typing',
        payload: {
          contactId,
          conversationId: row.conversationId,
          accountId: row.accountId || accountId,
          platform: row.platform || platform,
          isTyping: false,
          activity: 'paused',
          lastUpdated: new Date().toISOString(),
          reason: 'account_disconnected'
        }
      }));
    }

    for (const session of [...this.outgoingSessions.values()]) {
      if (!this._accountMatches(session.target, accountId, platform)) continue;
      clears.push(this.endSelfTyping({
        contactId: session.target.contactId,
        phase: session.phase,
        source: 'account-disconnect-clears-typing',
        reason: 'account_disconnected'
      }));
    }
    await Promise.allSettled(clears);
  }

  _accountMatches(row = {}, accountId = '', platform = '') {
    const rowAccountId = clean(row.accountId || row.contact?.accountId || row.self?.accountId || row.account?.id || row.account?.adapterAccountId);
    const rowAdapterId = clean(row.account?.adapterAccountId);
    const rowPlatform = clean(row.platform || row.contact?.platform || row.self?.platform || row.account?.platform).toLowerCase();
    const accountMatches = !accountId || rowAccountId === accountId || rowAdapterId === accountId;
    const platformMatches = !platform || !rowPlatform || rowPlatform === platform;
    return accountMatches && platformMatches;
  }

  _clearIncomingTimer(contactId) {
    const current = this.incomingTimers.get(contactId);
    if (current) clearTimeout(current.timer);
    this.incomingTimers.delete(contactId);
  }

  _scheduleIncomingExpiry(contactId, lastUpdated) {
    this._clearIncomingTimer(contactId);
    const token = `${clean(lastUpdated)}:${++this.sequence}`;
    const timer = setTimeout(async () => {
      const tracked = this.incomingTimers.get(contactId);
      if (!tracked || tracked.token !== token) return;
      const current = this.storeManager.select(state => state.typingState?.byContactId?.[contactId]?.contact || null);
      if (!current?.isTyping || clean(current.lastUpdated) !== clean(lastUpdated)) return;
      await this.storeManager.dispatch({
        type: 'UPDATE_CONTACT_TYPING_STATE',
        source: 'typing-state-expiry',
        payload: {
          contactId,
          conversationId: current.conversationId,
          accountId: current.accountId,
          platform: current.platform,
          isTyping: false,
          activity: 'paused',
          lastUpdated: new Date().toISOString(),
          reason: 'ttl_expired'
        }
      }).catch(error => this._log('warn', 'incoming-expiry-failed', { contactId, error: error.message }));
      if (this.incomingTimers.get(contactId)?.token === token) this.incomingTimers.delete(contactId);
    }, this.policy.inboundTtlMs);
    timer.unref?.();
    this.incomingTimers.set(contactId, { timer, token, lastUpdated });
  }

  _resolveTarget(input = {}) {
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    const snapshot = this.storeManager?.select?.(state => {
      const conversation = state.conversations?.byId?.[conversationId] || {};
      const customer = state.customers?.byId?.[contactId || conversation.contactId] || {};
      const accountId = clean(input.accountId || conversation.accountId || customer.accountId);
      const account = state.auth?.accountsById?.[accountId] || Object.values(state.auth?.accountsById || {})
        .find(row => clean(row.adapterAccountId) === accountId) || {};
      return { conversation, customer, account };
    }) || { conversation: {}, customer: {}, account: {} };
    const resolvedContactId = contactId || clean(snapshot.conversation.contactId || snapshot.customer.id || snapshot.customer.contactId);
    const resolvedConversationId = conversationId || clean(snapshot.conversation.id || snapshot.conversation.sessionKey);
    const resolvedAccountId = clean(input.accountId || snapshot.conversation.accountId || snapshot.customer.accountId || snapshot.account.id || snapshot.account.adapterAccountId);
    const platform = clean(input.platform || snapshot.conversation.platform || snapshot.customer.platform || snapshot.account.platform).toLowerCase();
    let chatJid = clean(input.chatJid || snapshot.conversation.chatJid || snapshot.conversation.remoteJid || snapshot.conversation.externalId || snapshot.conversation.recipientId);
    if (!chatJid && resolvedAccountId && resolvedConversationId.startsWith(`${resolvedAccountId}:`)) {
      chatJid = resolvedConversationId.slice(resolvedAccountId.length + 1);
    }
    return {
      contactId: resolvedContactId,
      conversationId: resolvedConversationId,
      accountId: resolvedAccountId,
      platform,
      chatJid,
      customer: snapshot.customer,
      account: snapshot.account
    };
  }

  _sessionKey(contactId, phase) {
    return `${clean(contactId)}:${clean(phase) || 'typing'}`;
  }

  async _sendPresence(target, state) {
    if (!target.platform || !target.accountId || !target.chatJid) {
      return { supported: false, reason: 'TARGET_INCOMPLETE' };
    }
    try {
      const result = await this.messaging.sendPresence({
        platform: target.platform,
        accountId: target.accountId,
        chatJid: target.chatJid,
        state
      });
      return { supported: true, result };
    } catch (error) {
      this._log('warn', 'platform-presence-failed', {
        platform: target.platform,
        accountId: target.accountId,
        conversationId: target.conversationId,
        state,
        code: error.code || '',
        error: error.message
      });
      return { supported: false, reason: error.code || error.message };
    }
  }

  async beginSelfTyping(input = {}) {
    if (!this.started) return { started: false, reason: 'SERVICE_NOT_STARTED' };
    const phase = clean(input.phase) || 'generation';
    const target = this._resolveTarget(input);
    if (!target.contactId || !target.conversationId) return { started: false, reason: 'TARGET_NOT_RESOLVED' };
    const key = this._sessionKey(target.contactId, phase);
    if (this.outgoingSessions.has(key)) {
      await this.endSelfTyping({ contactId: target.contactId, phase, reason: 'replaced' }).catch(() => {});
    }
    const controller = new AbortController();
    const platformEnabled = input.sendPlatform !== false;
    const lastUpdated = new Date().toISOString();
    await this.storeManager.dispatch({
      type: 'UPDATE_SELF_TYPING_STATE',
      source: clean(input.source) || 'typing-state-service',
      payload: {
        ...target,
        isTyping: true,
        activity: 'composing',
        phase,
        lastUpdated,
        ttlMs: Math.max(this.policy.outboundHeartbeatMs * 2, 4000)
      }
    });
    const presenceResult = platformEnabled
      ? await this._sendPresence(target, 'composing')
      : { supported: false, reason: 'PLATFORM_SIGNAL_DISABLED' };
    const heartbeat = platformEnabled ? setInterval(() => {
      this._sendPresence(target, 'composing').catch(() => {});
    }, this.policy.outboundHeartbeatMs) : null;
    heartbeat?.unref?.();
    const session = {
      key,
      target,
      phase,
      controller,
      heartbeat,
      startedAt: lastUpdated,
      platformEnabled,
      presenceResult
    };
    this.outgoingSessions.set(key, session);
    return { started: true, key, target, phase, signal: controller.signal, presenceResult };
  }

  async endSelfTyping(input = {}) {
    const contactId = clean(input.contactId);
    const phase = clean(input.phase) || 'generation';
    const key = this._sessionKey(contactId, phase);
    const session = this.outgoingSessions.get(key);
    if (!session && input.forceClear !== true) return { stopped: false, contactId, phase };
    if (session) {
      clearInterval(session.heartbeat);
      session.controller.abort(clean(input.reason) || 'TYPING_FINISHED');
      this.outgoingSessions.delete(key);
      if (session.platformEnabled) await this._sendPresence(session.target, 'paused');
    }
    if (this.storeManager?.dispatch && contactId) {
      await this.storeManager.dispatch({
        type: 'UPDATE_SELF_TYPING_STATE',
        source: clean(input.source) || 'typing-state-service',
        payload: {
          ...(session?.target || input),
          contactId,
          isTyping: false,
          activity: 'paused',
          phase,
          lastUpdated: new Date().toISOString(),
          reason: clean(input.reason) || 'finished'
        }
      }).catch(error => this._log('warn', 'self-state-clear-failed', { contactId, phase, error: error.message }));
    }
    return { stopped: Boolean(session), contactId, phase };
  }

  async beginAiGeneration(input = {}) {
    return this.beginSelfTyping({
      ...input,
      phase: 'ai_generation',
      source: 'context-aware-reply-brain',
      sendPlatform: this.policy.platformDuringGeneration
    });
  }

  async endAiGeneration(input = {}) {
    return this.endSelfTyping({
      ...input,
      phase: 'ai_generation',
      source: 'context-aware-reply-brain'
    });
  }

  _approvedRunKey(target = {}) {
    return `${clean(target.contactId)}:${clean(target.conversationId)}:approved-send`;
  }

  _runMatches(run = {}, input = {}) {
    const target = run.target || {};
    const contactId = clean(input.contactId);
    const conversationId = clean(input.conversationId);
    const accountId = clean(input.accountId);
    const platform = clean(input.platform).toLowerCase();
    if (contactId && clean(target.contactId) !== contactId) return false;
    if (conversationId && clean(target.conversationId) !== conversationId) return false;
    if (accountId && clean(target.accountId) !== accountId && clean(target.account?.adapterAccountId) !== accountId) return false;
    if (platform && clean(target.platform).toLowerCase() !== platform) return false;
    return Boolean(contactId || conversationId || accountId || platform || input.all === true);
  }

  _linkAbortSignal(signal, controller) {
    if (!signal || typeof signal.addEventListener !== 'function') return () => {};
    const abort = () => controller.abort(signal.reason || 'TYPING_SIMULATION_ABORTED');
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener?.('abort', abort);
  }

  async cancelApprovedSend(input = {}) {
    const reason = clean(input.reason) || 'TYPING_SIMULATION_CANCELLED';
    const runs = [...this.approvedRuns.values()].filter(run => this._runMatches(run, input));
    for (const run of runs) {
      run.controller.abort(reason);
      if (run.typingPhase) {
        await this.endSelfTyping({
          contactId: run.target.contactId,
          phase: run.typingPhase,
          source: clean(input.source) || 'typing-state-service',
          reason
        }).catch(() => {});
        run.typingPhase = '';
      }
      if (this.approvedRuns.get(run.key) === run) this.approvedRuns.delete(run.key);
    }
    return { cancelled: runs.length, reason };
  }

  async notifyManualTyping(input = {}) {
    if (!this.policy.cancelOnManualTyping) return { cancelled: 0, reason: 'POLICY_DISABLED' };
    return this.cancelApprovedSend({ ...input, reason: clean(input.reason) || 'MANUAL_TYPING_STARTED' });
  }

  async notifyConversationChanged(input = {}) {
    if (!this.policy.cancelOnConversationChange) return { cancelled: 0, reason: 'POLICY_DISABLED' };
    return this.cancelApprovedSend({ ...input, reason: clean(input.reason) || 'CONVERSATION_CHANGED' });
  }

  async notifyUserCancel(input = {}) {
    if (!this.policy.cancelOnUserCancel) return { cancelled: 0, reason: 'POLICY_DISABLED' };
    return this.cancelApprovedSend({ ...input, reason: clean(input.reason) || 'USER_CANCELLED_SEND' });
  }

  async simulateApprovedSend(input = {}) {
    const text = String(input.text == null ? '' : input.text);
    if (typeof input.send !== 'function') {
      const error = new Error('Approved typing simulation requires an atomic send callback');
      error.code = 'TYPING_SEND_CALLBACK_REQUIRED';
      throw error;
    }
    const target = this._resolveTarget(input);
    if (!target.contactId || !target.conversationId) return { simulated: false, reason: 'TARGET_NOT_RESOLVED' };
    const humanBurstEnabled = this.policy.humanBurstPlatforms.includes(target.platform);
    const plan = humanBurstEnabled
      ? buildHumanTypingPlan(text, this.policy, {
          tier: input.tier,
          complexityHint: input.complexityHint,
          random: input.random || this.random
        })
      : buildSingleTypingPlan(text, this.policy, { random: input.random || this.random });
    const key = this._approvedRunKey(target);
    await this.cancelApprovedSend({ contactId: target.contactId, conversationId: target.conversationId, reason: 'TYPING_SIMULATION_REPLACED' });
    const controller = new AbortController();
    const unlinkAbort = this._linkAbortSignal(input.signal, controller);
    const run = { key, target, controller, plan, typingPhase: '', startedAt: new Date().toISOString() };
    this.approvedRuns.set(key, run);
    let sendContext = null;
    let sendResult;

    const assertCurrent = async stage => {
      if (controller.signal.aborted) throw abortError(controller.signal.reason || 'TYPING_SIMULATION_ABORTED');
      if (typeof input.isStale !== 'function') return;
      const stale = await input.isStale({ stage, target, plan, signal: controller.signal });
      if (stale) throw abortError('TYPING_CONTEXT_STALE');
    };

    try {
      if (plan.silentDelayMs > 0) {
        const preparationPhase = 'approved_send_silent';
        const preparation = await this.beginSelfTyping({
          ...target,
          phase: preparationPhase,
          source: 'ai-reply-outbox-service',
          sendPlatform: false
        });
        if (!preparation.started) return { simulated: false, reason: preparation.reason, plan };
        run.typingPhase = preparationPhase;
        await this.waitFn(plan.silentDelayMs, controller.signal);
        await this.endSelfTyping({
          contactId: target.contactId,
          phase: preparationPhase,
          source: 'ai-reply-outbox-service',
          reason: 'silent_read_complete'
        });
        run.typingPhase = '';
      }
      await assertCurrent('silent-delay-complete');

      for (let index = 0; index < plan.bursts.length; index += 1) {
        const burst = plan.bursts[index];
        const finalBurst = index === plan.bursts.length - 1;
        await assertCurrent(finalBurst ? 'before-final-burst' : `before-burst-${index + 1}`);
        if (finalBurst && typeof input.preFinalCheck === 'function') {
          sendContext = await input.preFinalCheck({ target, plan, signal: controller.signal });
          if (sendContext === false || sendContext?.blocked === true) {
            const error = new Error(sendContext?.error || 'Final send guard blocked the approved reply');
            error.code = sendContext?.error || 'TYPING_FINAL_GUARD_BLOCKED';
            throw error;
          }
        }

        const phase = 'approved_send_burst';
        const session = await this.beginSelfTyping({
          ...target,
          phase,
          source: 'ai-reply-outbox-service',
          sendPlatform: this.policy.platformAfterApproval
        });
        if (!session.started) return { simulated: false, reason: session.reason, plan };
        run.typingPhase = phase;
        await this.waitFn(burst.durationMs, controller.signal);

        if (!finalBurst) {
          await this.endSelfTyping({
            contactId: target.contactId,
            phase,
            source: 'ai-reply-outbox-service',
            reason: 'human_typing_pause'
          });
          run.typingPhase = '';
          if (burst.pauseAfterMs > 0) await this.waitFn(burst.pauseAfterMs, controller.signal);
          continue;
        }

        if (plan.finalSendDelayMs > 0) await this.waitFn(plan.finalSendDelayMs, controller.signal);
        await assertCurrent('immediately-before-send');
        sendResult = await input.send({ target, plan, sendContext, signal: controller.signal });
      }

      return {
        simulated: true,
        plan,
        delayMs: plan.totalMs,
        sendResult
      };
    } finally {
      unlinkAbort();
      if (run.typingPhase) {
        await this.endSelfTyping({
          contactId: target.contactId,
          phase: run.typingPhase,
          source: 'ai-reply-outbox-service',
          reason: controller.signal.aborted ? clean(controller.signal.reason) || 'typing_cancelled' : 'message_send_completed'
        }).catch(() => {});
        run.typingPhase = '';
      }
      if (this.approvedRuns.get(key) === run) this.approvedRuns.delete(key);
    }
  }
}

const singleton = new TypingStateService();

module.exports = singleton;
module.exports.TypingStateService = TypingStateService;
module.exports.wait = wait;
module.exports.accountStateIsConnected = accountStateIsConnected;
