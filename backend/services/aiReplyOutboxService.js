'use strict';

const eventBus = require('./eventBus');
const logger = require('./logger');
const sendQueueService = require('./sendQueueService');
const typingStateService = require('./typingStateService');
const { getStoreManager } = require('../store/storeManagerSingleton');
const { currentEntityVersions } = require('../store/commands/registerAiReplyCommands');
const { readConversationAutomationState } = require('../store/commands/registerRuntimeStateCommands');

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
  'USER_CANCELLED_SEND',
  'MANUAL_TAKEOVER',
  'AI_AUTO_INTERACTION_POLICY_BLOCKED'
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
  if (clean(snapshot.outbox.authorizationType).toLowerCase() === 'machine' || snapshot.outbox.machineApproved === true) {
    const automation = storeManager.select(state => readConversationAutomationState(state, snapshot.outbox.conversationId, snapshot.outbox.contactId));
    const expectedReceipt = snapshot.outbox.automationReceipt && typeof snapshot.outbox.automationReceipt === 'object'
      ? snapshot.outbox.automationReceipt
      : snapshot.outbox.metadata?.automationReceipt || {};
    if (automation.mode !== 'AI_AUTO' || !automation.receipt?.id || clean(expectedReceipt.id) !== clean(automation.receipt.id)) {
      return {
        blocked: true,
        error: 'MANUAL_TAKEOVER',
        automationMode: automation.mode,
        expectedReceiptId: clean(expectedReceipt.id),
        currentReceiptId: clean(automation.receipt?.id)
      };
    }
    if (automation.policy?.blocked === true || automation.policy?.allowReplies === false) {
      return {
        blocked: true,
        error: 'AI_AUTO_INTERACTION_POLICY_BLOCKED',
        blockedByPolicy: automation.policy?.blocked === true,
        allowReplies: automation.policy?.allowReplies !== false
      };
    }
  }
  // Relationship/memory intelligence remains advisory. AI_AUTO mode itself is a durable
  // send authorization and therefore is revalidated immediately before physical send.
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

async function retainAfterManualTakeover(storeManager, outboxId) {
  await storeManager.dispatch({
    type: 'OUTBOX_SEND_ABORTED',
    source: 'ai-reply-outbox-service',
    payload: { outboxId, reason: 'MANUAL_TAKEOVER', reverifyRequired: false }
  }).catch(() => {});
}

function readCandidateSnapshot(storeManager, candidateId) {
  return storeManager.select(state => {
    const candidate = state.aiBrain?.candidatesById?.[candidateId] || null;
    if (!candidate) return { candidate: null };
    return {
      candidate,
      automation: readConversationAutomationState(state, candidate.conversationId, candidate.contactId)
    };
  });
}

async function confirmAutomaticOutbox(storeManager, outboxId) {
  const snapshot = readOutboxSnapshot(storeManager, outboxId);
  if (!snapshot.outbox || snapshot.outbox.state !== 'approved') return { skipped: true, reason: 'not-approved' };
  if (clean(snapshot.outbox.authorizationType).toLowerCase() !== 'machine' || snapshot.outbox.machineApproved !== true) {
    return { skipped: true, reason: 'not-machine-authorized' };
  }
  const automation = storeManager.select(state => readConversationAutomationState(state, snapshot.outbox.conversationId, snapshot.outbox.contactId));
  const expectedReceipt = snapshot.outbox.automationReceipt || snapshot.outbox.metadata?.automationReceipt || {};
  if (automation.mode !== 'AI_AUTO' || !automation.receipt?.id || clean(expectedReceipt.id) !== clean(automation.receipt.id)) {
    await retainAfterManualTakeover(storeManager, outboxId);
    return { skipped: true, reason: 'MANUAL_TAKEOVER' };
  }
  return storeManager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED',
    source: 'ai-auto-outbox-service',
    payload: {
      outboxId,
      authorizationType: 'machine',
      machineApproved: true,
      automationReceipt: { ...automation.receipt }
    }
  });
}

async function approveAutomaticCandidate(storeManager, candidateId) {
  const snapshot = readCandidateSnapshot(storeManager, candidateId);
  const candidate = snapshot.candidate;
  if (!candidate || !['generated', 'edited'].includes(clean(candidate.state))) return { skipped: true, reason: 'not-reviewable' };
  const candidateReceipt = candidate.automationModeReceipt || candidate.generationMetadata?.automationModeReceipt || {};
  if (snapshot.automation.mode !== 'AI_AUTO' || !snapshot.automation.receipt?.id || clean(candidateReceipt.id) !== clean(snapshot.automation.receipt.id)) {
    return { skipped: true, reason: 'not-current-ai-auto' };
  }
  const approved = await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED',
    source: 'ai-auto-outbox-service',
    payload: {
      candidateId,
      text: candidate.text,
      authorizationType: 'machine',
      machineApproved: true,
      automationReceipt: { ...snapshot.automation.receipt },
      learningMode: 'send_and_learn',
      source: candidate.source || 'ai_auto'
    }
  });
  const outboxId = clean(approved.result?.outboxId);
  if (outboxId) await confirmAutomaticOutbox(storeManager, outboxId);
  return approved;
}

async function handleCandidateReady(wrapperEvent) {
  const storeEvent = wrapperEvent?.payload || {};
  const candidateId = clean(storeEvent.payload?.candidateId || storeEvent.entityId);
  if (!candidateId) return;
  const storeManager = getStoreManager();
  await approveAutomaticCandidate(storeManager, candidateId).catch(error => {
    const code = clean(error.code || error.reasonCode || error.message);
    if (['MANUAL_TAKEOVER', 'AI_AUTO_AUTOMATION_RECEIPT_STALE', 'AI_AUTO_INTERACTION_POLICY_BLOCKED', 'AI_REPLY_CANDIDATE_NOT_REVIEWABLE'].includes(code)) return;
    logger.warn('store', 'ai-auto-candidate-authorization-failed', { candidateId, code, error: error.message });
  });
}

async function recoverAutomaticWork() {
  const storeManager = getStoreManager();
  const pending = storeManager.select(state => ({
    candidates: Object.values(state.aiBrain?.candidatesById || {})
      .filter(candidate => ['generated', 'edited'].includes(clean(candidate.state)) && clean(candidate.automationMode).toUpperCase() === 'AI_AUTO')
      .map(candidate => candidate.candidateId),
    approvedOutboxes: Object.values(state.outbox?.byId || {})
      .filter(outbox => outbox.state === 'approved' && clean(outbox.authorizationType).toLowerCase() === 'machine' && outbox.machineApproved === true)
      .map(outbox => outbox.id),
    confirmedOutboxes: Object.values(state.outbox?.byId || {})
      .filter(outbox => outbox.state === 'send_confirmed' && clean(outbox.authorizationType).toLowerCase() === 'machine' && outbox.machineApproved === true)
      .map(outbox => outbox.id)
  }));
  for (const candidateId of pending.candidates) await approveAutomaticCandidate(storeManager, candidateId).catch(() => {});
  for (const outboxId of pending.approvedOutboxes) await confirmAutomaticOutbox(storeManager, outboxId).catch(() => {});
  for (const outboxId of pending.confirmedOutboxes) {
    await handleSendConfirmed({ payload: { entityId: outboxId, payload: { outboxId } } }).catch(() => {});
  }
  return {
    recoveredCandidates: pending.candidates.length,
    recoveredApprovals: pending.approvedOutboxes.length,
    recoveredConfirmed: pending.confirmedOutboxes.length
  };
}

async function handleSendConfirmed(wrapperEvent) {
  const storeEvent = wrapperEvent?.payload || {};
  const outboxId = clean(storeEvent.payload?.outboxId || storeEvent.entityId);
  if (!outboxId) return;
  const storeManager = getStoreManager();
  let snapshot = readOutboxSnapshot(storeManager, outboxId);
  let guard = evaluateSendGuard(storeManager, snapshot);
  if (guard.blocked) {
    if (SEND_ABORT_RETAIN_CODES.has(guard.error)) {
      await storeManager.dispatch({
        type: 'OUTBOX_SEND_ABORTED',
        source: 'ai-reply-outbox-service',
        payload: { outboxId, reason: guard.error, reverifyRequired: false }
      }).catch(() => {});
    } else if (guard.error !== 'OUTBOX_NOT_SEND_CONFIRMED') {
      await recordBlocked(storeManager, outboxId, guard.error);
    }
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
  bind('store:ai.replyCandidate.ready', handleCandidateReady);
  bind('store:outbox.sendConfirmed', handleSendConfirmed);
  bind('send-queue:sent', event => handleQueueTerminal(event, true));
  bind('send-queue:failed', event => handleQueueTerminal(event, false));
  setImmediate(() => recoverAutomaticWork().catch(error => logger.warn('store', 'ai-auto-recovery-failed', { code: error.code || 'AI_AUTO_RECOVERY_FAILED', error: error.message })));
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
    manualApprovalRequired: 'HUMAN_OR_AI_ASSIST',
    automaticSendEnabled: started,
    automaticSendMode: 'AI_AUTO',
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
  handleQueueTerminal,
  handleCandidateReady,
  approveAutomaticCandidate,
  confirmAutomaticOutbox,
  recoverAutomaticWork
};