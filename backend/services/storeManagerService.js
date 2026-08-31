'use strict';

const eventBus = require('./eventBus');
const logger = require('./logger');
const workspaceData = require('./workspaceDataService');
const { configureStoreManager, getStoreManager } = require('../store/storeManagerSingleton');
const { SynchronousSqliteStorePersistenceAdapter } = require('../store/adapters/SynchronousSqliteStorePersistenceAdapter');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { registerSocialIntelligenceCommands } = require('../store/commands/registerSocialIntelligenceCommands');
const { registerRuntimeStateCommands } = require('../store/commands/registerRuntimeStateCommands');
const { registerActiveSelectionCommands } = require('../store/commands/registerActiveSelectionCommands');
const { StoreIntegrityMonitor } = require('../store/StoreIntegrityMonitor');
const typingStateService = require('./typingStateService');
const replyFeedbackLearningService = require('./replyFeedbackLearningService');
const learningOutcomeAttributionService = require('./learningOutcomeAttributionService').singleton;
const conversationTurnCoordinator = require('./conversationTurnCoordinator');
const aiTaskRuntimeRegistry = require('./aiTaskRuntimeRegistry');
const personaBrainModule = require('../personaBrain');

let started = false;
let initializing = null;
let integrityMonitor = null;

function clean(value) { return String(value == null ? '' : value).trim(); }

async function ensureCustomerContext(storeManager, conversationId, contactIdHint = '') {
  let contactId = '';
  let resolved = null;
  const stableConversationId = clean(conversationId);
  if (stableConversationId) {
    resolved = workspaceData.resolveContactForConversation(stableConversationId);
    contactId = clean(resolved.contact?.id || resolved.contact?.contactId || resolved.conversation?.contact_id);
  }
  if (!contactId) {
    const hinted = clean(contactIdHint);
    if (hinted && storeManager.select(state => state.customers.byId[hinted] || null)) contactId = hinted;
  }
  if (!contactId) {
    const error = new Error('Unable to resolve stable contact for social ingestion');
    error.code = 'SOCIAL_CONTACT_RESOLUTION_FAILED';
    throw error;
  }
  const exists = storeManager.select(state => Boolean(state.customers.byId[contactId]));
  if (!exists) {
    const context = workspaceData.getContactContext(contactId);
    await storeManager.dispatch({
      type: 'SYNC_CUSTOMER_CONTEXT',
      source: 'workspace-repository-hydration',
      payload: { context }
    });
  }
  return contactId;
}

async function initialize(options = {}) {
  if (started) return getStoreManager();
  if (initializing) return initializing;
  initializing = (async () => {
    const persistence = options.persistence || new SynchronousSqliteStorePersistenceAdapter(options.persistenceOptions);
    const storeManager = configureStoreManager({
      persistence,
      logger,
      initialState: options.initialState,
      replace: options.replace === true
    });
    const personaBrain = options.personaBrain || personaBrainModule.createPersonaBrain();
    registerRuntimeStateCommands(storeManager);
    registerActiveSelectionCommands(storeManager);
    registerSocialIntelligenceCommands(storeManager, { governorConfig: options.governorConfig });
    registerAiReplyCommands(storeManager, { personaAuthority: personaBrain.service });
    await storeManager.hydrate();
    // Persisted customer ordering is not selection authority. Start every
    // process with no active runtime selection; the canonical renderer session
    // will be mirrored through StoreProjectionCoordinator after UI selection.
    await storeManager.dispatch({
      type: 'SET_ACTIVE_CONVERSATION',
      source: 'store-manager-startup',
      payload: { conversationId: '' }
    });

    // Model calls and controllers live in memory. Any durable task that was
    // running when the process stopped no longer has an executor and must be
    // settled before the first authoritative UI snapshot.
    const interruptedTasks = storeManager.select(state => Object.values(state.aiBrain?.tasksById || {})
      .filter(task => ['running','queued'].includes(clean(task.status))));
    for (const task of interruptedTasks) {
      await storeManager.dispatch({
        type: 'AI_REPLY_TASK_CANCELLED',
        source: 'startup-ai-task-recovery',
        payload: {
          taskId: task.taskId,
          failed: true,
          reason: 'PROCESS_RESTARTED_AI_TASK_INTERRUPTED',
          error: '进程重启中断了模型调用；旧任务已失败关闭。'
        }
      });
    }
    const durableAiRecovery = aiTaskRuntimeRegistry.recoverInterrupted();
    if (interruptedTasks.length || durableAiRecovery.recovered) {
      logger.warn('store', 'interrupted-ai-tasks-recovered', {
        storeTasks: interruptedTasks.length,
        durableOperations: durableAiRecovery.recovered
      });
    }

    // Runtime projections are lifecycle-managed by StoreProjectionCoordinator.
    // StoreManager initialization only owns hydration and integrity supervision.
    typingStateService.start({
      storeManager,
      resolveContact: (conversationId, contactIdHint = '') => ensureCustomerContext(storeManager, conversationId, contactIdHint),
      policy: options.typingPolicy || {}
    });
    conversationTurnCoordinator.start();
    replyFeedbackLearningService.start({ storeManager, personaBrain });
    // Outcome attribution deliberately starts only after authoritative StoreManager
    // hydration. It reuses the existing message:inserted event and immutable
    // learning_signal_ledger; it owns no second inbound pipeline or scheduler.
    learningOutcomeAttributionService.start();
    integrityMonitor = new StoreIntegrityMonitor({
      storeManager,
      logger,
      intervalMs: Number(process.env.YANCE_STORE_INTEGRITY_INTERVAL_MS || 30000),
      onReport: report => {
        if (!report.ok) eventBus.publish('store:integrity-violation', report);
      }
    });
    integrityMonitor.start();
    started = true;
    logger.info('store', 'store-manager-ready', {
      stateVersion: storeManager.stateVersion,
      domains: Object.keys(storeManager.snapshot()).filter(key => key !== 'meta')
    });
    eventBus.publish('store:ready', { stateVersion: storeManager.stateVersion, at: new Date().toISOString() });
    return storeManager;
  })();
  try { return await initializing; }
  finally { initializing = null; }
}

function status() {
  if (!started) return { started: false, stateVersion: 0 };
  const storeManager = getStoreManager();
  return {
    started: true,
    hydrated: storeManager.hydrated,
    stateVersion: storeManager.stateVersion,
    meta: storeManager.select(state => state.meta),
    integrity: integrityMonitor?.lastReport || null
  };
}

function stop() {
  learningOutcomeAttributionService.stop();
  replyFeedbackLearningService.stop();
  conversationTurnCoordinator.stop();
  typingStateService.stop();
  integrityMonitor?.stop();
  integrityMonitor = null;
  started = false;
}

module.exports = { initialize, status, stop, ensureCustomerContext };
