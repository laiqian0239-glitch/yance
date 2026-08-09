'use strict';

const eventBus = require('./eventBus');
const logger = require('./logger');
const sendQueueService = require('./sendQueueService');
const typingStateService = require('./typingStateService');
const { getStoreManager } = require('../store/storeManagerSingleton');
const { currentEntityVersions } = require('../store/commands/registerAiReplyCommands');

let started = false;
let listeners = [];

const SEND_ABORT_REVERIFY_CODES = new Set([
  'NEW_INCOMING_MESSAGE',
  'ACCOUNT_STATE_CHANGED',
  'TYPING_CONTEXT_STALE',
  'STALE_SOCIAL_CONTEXT',
  'STALE_CONVERSATION_CONTEXT'
]);
const SEND_ABORT_RETAIN_CODES = new Set([
  'MANUAL_TYPING_STARTED',
  'CONVERSATION_CHANGED',
  'USER_CANCELLED_SEND'
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function bind(type, listener) {
  eventBus.on(type, listener);
  listeners.push(() => eventBus.off(type, listener));
}

function resolveChatJid(conversation = {}) {
  const direct = clean(conversation.chatJid || conversation.remoteJid || conversation.externalId || conversation.recipientId);
  if (direct) return direct;
  const sessionKey = clean(conversation.sessionKey || conversation.id || conversation.conversationId);
  const accountId = clean(conversation.accountId);
  if (accountId && sessionKey.startsWith(`${accountId}:`)) return sessionKey.slice(accountId.length + 1);
  return sessionKey;
}

function readOutboxSnapshot(storeManager, outboxId) {
  return storeManager.select(state => {
    const outbox = state.outbox.byId[outboxId] || null;
    if (!outbox) return { outbox: null };
    return {
      outbox,
      customer: state.customers.byId[outbox.contactId] || null,
      policy: state.interactionPolicies.byContactId[outbox.contactId] || {},
      account: state.auth.accountsById[outbox.accountId] || {},
      conversation: state.conversations.byId[outbox.conversationId] || {}
    };
  });
}

function evaluateSendGuard(storeManager, snapshot) {
  if (!snapshot.outbox) return { blocked: true, error: 'OUTBOX_NOT_FOUND' };
  if (snapshot.outbox.state !== 'send_confirmed') return { blocked: true, error: 'OUTBOX_NOT_SEND_CONFIRMED' };
  const actualVersions = storeManager.select(state => currentEntityVersions(state, snapshot.outbox.contactId));
  const expectedConversationRevision = Number(snapshot.outbox.metadata?.conversationRevision || 0);
  const actualConversationRevision = Number(snapshot.conversation?.version || 0);
  const conversationChanged = expectedConversationRevision !== actualConversationRevision;
  if (!snapshot.customer) return { blocked: true, error: 'CUSTOMER_NOT_FOUND' };
  if (snapshot.customer.archived || snapshot.customer.archivedAt) return { blocked: true, error: 'ARCHIVED_CUSTOMER_READ_ONLY' };
  if (conversationChanged) return {
    blocked: true,
    error: 'STALE_CONVERSATION_CONTEXT',
    expectedConversationRevision,
    actualConversationRevision
  };
  // Relationship/interaction policy remains advisory and never blocks the fast send path.
  if (snapshot.account.canAttemptSend !== true) return { blocked: true, error: 'ACCOUNT_CANNOT_ATTEMPT_SEND' };
  return { blocked: false, actualVersions };
}

async function recordBlocked(storeManager, outboxId, error) {
  await storeManager.dispatch({
    type: 'OUTBOX_SEND_RESULT',
    source: 'ai-reply-outbox-service',
    payload: { outboxId, success: false, error }
  });
}

async function handleSendConfirmed(wrapperEvent) {
  const storeEvent = wrapperEvent?.payload || {};
  const outboxId = clean(storeEvent.payload?.outboxId || storeEvent.entityId);
  if (!outboxId) return;
  const storeManager = getStoreManager();
  let snapshot = readOutboxSnapshot(storeManager, outboxId);
  let guard = evaluateSendGuard(storeManager, snapshot);
  if (guard.blocked) {
    if (guard.error !== 'OUTBOX_NOT_SEND_CONFIRMED') await recordBlocked(storeManager, outboxId, guard.error);
    return;
  }

  try {
    const enqueueCurrent = async sendContext => {
      const current = sendContext?.snapshot || readOutboxSnapshot(storeManager, outboxId);
      const currentGuard = sendContext?.guard || evaluateSendGuard(storeManager, current);
      if (currentGuard.blocked) {
        const error = new Error(currentGuard.error);
        error.code = currentGuard.error;
        throw error;
      }
      const generationMetadata = current.outbox.metadata?.generationMetadata || {};
      const modelBrainExecutionEvidence = current.outbox.metadata?.modelBrainExecutionEvidence
        || generationMetadata.modelBrainExecutionEvidence
        || {};
      const queued = await sendQueueService.enqueueText({
        platform: current.outbox.platform || current.conversation.platform,
        accountId: current.outbox.accountId,
        chatJid: sendContext?.chatJid || resolveChatJid(current.conversation),
        sessionKey: current.outbox.conversationId,
        text: current.outbox.text,
        quoted: current.outbox.metadata?.quoted || null,
        idempotencyKey: `ai-outbox:${outboxId}`,
        outboxId,
        approvalReceiptId: clean(current.outbox.approvalReceiptId || current.outbox.metadata?.approvalReceiptId),
        targetLanguage: clean(current.outbox.targetLanguage || current.outbox.metadata?.targetLanguageCode || current.outbox.metadata?.targetLanguage),
        replySource: clean(current.outbox.metadata?.replySource || current.outbox.source),
        replyTask: clean(current.outbox.metadata?.replyTask || generationMetadata.replyTask),
        modelId: clean(current.outbox.metadata?.modelId || generationMetadata.modelId),
        modelBrainExecutionEvidence,
        qualityRouteReceipt: current.outbox.qualityRouteReceipt || current.outbox.metadata?.qualityRouteReceipt || generationMetadata.qualityRouteReceipt || {},
        qualityTier: clean(current.outbox.qualityTier || current.outbox.metadata?.qualityTier || generationMetadata.qualityTier),
        emergencyMode: current.outbox.emergencyMode === true || current.outbox.metadata?.emergencyMode === true || generationMetadata.emergencyMode === true,
        learningEligible: current.outbox.learningEligible !== false && current.outbox.metadata?.learningEligible !== false && generationMetadata.learningEligible !== false
      });
      await storeManager.dispatch({
        type: 'OUTBOX_QUEUE_LINKED',
        source: 'ai-reply-outbox-service',
        payload: {
          outboxId,
          sendQueueId: queued.id,
          approvalReceiptId: queued.approvalReceiptId,
          finalTextSha256: queued.finalTextSha256,
          sendPolicyVersion: queued.sendPolicyVersion,
          capabilitySnapshotId: queued.capabilitySnapshotId,
          qualityTier: queued.qualityTier,
          emergencyMode: queued.emergencyMode,
          learningEligible: queued.learningEligible,
          qualityRouteReceipt: queued.qualityRouteReceipt || {},
          modelBrainExecutionEvidence: queued.modelBrainExecutionEvidence || {},
          modelBrainEvidenceValid: queued.modelBrainEvidenceValid === true,
          modelBrainEvidenceReasonCode: clean(queued.modelBrainEvidenceReasonCode),
          modelBrainEvidenceSha256: clean(queued.modelBrainEvidenceSha256)
        }
      });
      const terminal = await sendQueueService.waitForTerminal(
        queued.id,
        typingStateService.status().policy.finalDeliveryWaitMaxMs
      );
      if (terminal?.queue?.state === 'failed' || terminal?.queue?.state === 'cancelled') {
        const error = new Error(terminal?.error?.message || terminal?.queue?.lastError || 'Platform send failed');
        error.code = terminal?.error?.code || 'PLATFORM_SEND_FAILED';
        throw error;
      }
      return terminal?.queue || queued;
    };

    const replySource = clean(snapshot.outbox.metadata?.replySource || 'local_model').toLowerCase();
    if (replySource === 'manual') {
      await enqueueCurrent({ snapshot, guard, chatJid: resolveChatJid(snapshot.conversation) });
    } else {
      // Model and externally pasted replies may use the approved natural typing
      // cadence. A reply typed by the user is sent directly because real keyboard
      // presence already represents the user's typing activity.
      await typingStateService.simulateApprovedSend({
        contactId: snapshot.outbox.contactId,
        conversationId: snapshot.outbox.conversationId,
        accountId: snapshot.outbox.accountId,
        platform: snapshot.outbox.platform || snapshot.conversation.platform,
        chatJid: resolveChatJid(snapshot.conversation),
        text: snapshot.outbox.text,
        complexityHint: snapshot.outbox.metadata?.typingTier || snapshot.outbox.metadata?.performanceMode || snapshot.outbox.metadata?.replyStrategy,
        preFinalCheck: async () => {
          const current = readOutboxSnapshot(storeManager, outboxId);
          const currentGuard = evaluateSendGuard(storeManager, current);
          if (currentGuard.blocked) return { blocked: true, error: currentGuard.error };
          return {
            snapshot: current,
            guard: currentGuard,
            chatJid: resolveChatJid(current.conversation)
          };
        },
        isStale: async ({ stage }) => {
          if (stage === 'before-final-burst' || stage === 'immediately-before-send') return false;
          const current = readOutboxSnapshot(storeManager, outboxId);
          return evaluateSendGuard(storeManager, current).blocked;
        },
        send: async ({ sendContext }) => enqueueCurrent(sendContext)
      });
    }
  } catch (error) {
    const code = clean(error.code || error.message || 'SEND_QUEUE_FAILED').split(/\s+/)[0];
    if (code === 'TYPING_SIMULATION_REPLACED') {
      logger.info('store', 'ai-outbox-typing-run-replaced', { outboxId });
      return;
    }
    if (SEND_ABORT_REVERIFY_CODES.has(code) || SEND_ABORT_RETAIN_CODES.has(code)) {
      const reverifyRequired = SEND_ABORT_REVERIFY_CODES.has(code);
      logger.info('store', 'ai-outbox-send-aborted', { outboxId, code, reverifyRequired });
      await storeManager.dispatch({
        type: 'OUTBOX_SEND_ABORTED',
        source: 'ai-reply-outbox-service',
        payload: { outboxId, reason: code, reverifyRequired }
      }).catch(() => {});
      return;
    }
    logger.warn('store', 'ai-outbox-enqueue-failed', { outboxId, code, error: error.message });
    await storeManager.dispatch({
      type: 'OUTBOX_SEND_RESULT',
      source: 'ai-reply-outbox-service',
      payload: {
        outboxId,
        success: false,
        error: `${code}: ${error.message}`
      }
    }).catch(() => {});
  }
}

async function handleQueueTerminal(wrapperEvent, success) {
  const queue = wrapperEvent?.payload?.queue || {};
  const sendQueueId = clean(queue.id);
  if (!sendQueueId) return;
  const storeManager = getStoreManager();
  const outbox = storeManager.select(state => Object.values(state.outbox.byId).find(row => row.sendQueueId === sendQueueId) || null);
  if (!outbox) return;
  await storeManager.dispatch({
    type: 'OUTBOX_SEND_RESULT',
    source: 'ai-reply-outbox-service',
    payload: {
      outboxId: outbox.id,
      sendQueueId,
      success,
      error: success ? '' : clean(wrapperEvent?.payload?.error?.message || queue.lastError)
    }
  }).catch(error => logger.warn('store', 'ai-outbox-terminal-sync-failed', {
    outboxId: outbox.id,
    sendQueueId,
    error: error.message
  }));
}

function start() {
  if (started) return status();
  started = true;
  bind('store:outbox.sendConfirmed', handleSendConfirmed);
  bind('send-queue:sent', event => handleQueueTerminal(event, true));
  bind('send-queue:failed', event => handleQueueTerminal(event, false));
  return status();
}

function stop() {
  for (const unsubscribe of listeners.splice(0)) {
    try { unsubscribe(); } catch (_) {}
  }
  started = false;
}

function status() {
  return {
    started,
    manualApprovalRequired: true,
    automaticSendEnabled: false,
    dynamicTypingDelay: true,
    typingPolicy: typingStateService.status().policy
  };
}

module.exports = {
  start,
  stop,
  status,
  resolveChatJid,
  readOutboxSnapshot,
  evaluateSendGuard,
  handleSendConfirmed,
  handleQueueTerminal
};