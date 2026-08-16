'use strict';

const accountManager = require('./accountManager');
const modelStatus = require('./modelStatusService');
const platformCapabilityAuthority = require('./platformCapabilityAuthority');
const platformAdapters = require('./platformAdapterPorts').singleton;
const channelAdapterRuntime = require('./channelAdapterRuntime');
const platformDriverRegistry = require('./platformDriverRegistry');
const { singleton: platformCoreRepository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'Round12ArchitectureStatusAuthority';
const SCHEMA_VERSION = 2;
const MODEL_BRAIN_TASKS = Object.freeze([
  'director',
  'quick_reply',
  'deep_reply',
  'learning_synthesis',
  'translation',
  'fact_extraction',
  'memory_extraction'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function safePersistenceSummary(repository) {
  try { return repository.architectureSummary(); }
  catch (error) {
    return {
      available: false,
      reasonCode: clean(error.code) || 'ROUND12_PERSISTENCE_STATUS_UNAVAILABLE',
      message: clean(error.message)
    };
  }
}
function projectModelBrain(modelState) {
  const current = modelState && modelState.modelBrain && modelState.taskReadiness
    ? modelState
    : modelStatus.project(modelState || {});
  const models = Array.isArray(current.models) ? current.models : [];
  const taskRows = Array.isArray(current.taskReadiness?.tasks) ? current.taskReadiness.tasks : [];
  return {
    authority: 'Model Brain / LiteLLM',
    litellm: current.modelBrain?.litellm || 'LiteLLM v1.95.0',
    runtime: {
      health: current.modelBrain?.health || 'unavailable',
      available: current.modelBrain?.runtimeAvailable === true,
      complexityRouter: current.modelBrain?.complexityRouter || 'ComplexityRouter',
      strictTagFiltering: current.modelBrain?.strictTagFiltering || { enabled: true, matchAny: false }
    },
    hardEligibility: {
      dimensions: ['privacy/local-cloud', 'modality', 'language/native-register', 'context length', 'explicit provider allow/deny'],
      local: models.filter(row => row.sourceType === 'local').length,
      cloud: models.filter(row => row.sourceType === 'cloud').length,
      verified: models.filter(row => row.qualification === 'verified').length,
      total: models.length
    },
    logicalTasks: Object.fromEntries(taskRows.map(row => [row.task, {
      logicalModel: row.logicalModel,
      capabilityCount: Number(row.capabilityCount || 0),
      ready: row.ready === true,
      reason: clean(row.reason)
    }])),
    executionEvidence: current.modelBrain?.lastEvidence || null,
    learning: {
      state: 'production-wired',
      l1ProductionSignalsActive: true,
      l2PromotionGoverned: true,
      l3PromotionGovernedAndHumanApproved: true,
      automaticL2L3SynthesisScheduled: true,
      synthesisHealthObservable: true,
      l3ProposalReviewProductEntry: true,
      rollbackAndForgetProductEntry: true,
      l3AutoActivation: false,
      l3HumanApprovalRequired: true
    },
    invariants: {
      yancePhysicalModelRanking: false,
      mandatoryTagsUseAndSemantics: true,
      noAllTagsMatchFailsClosed: true,
      physicalSelectionAuthority: 'LiteLLM Router',
      complexityAuthority: 'LiteLLM ComplexityRouter'
    }
  };
}
function snapshot(options = {}) {
  const repository = options.repository || platformCoreRepository;
  const accountState = options.accountState || accountManager.list();
  const currentModelState = options.modelState ? modelStatus.project(options.modelState) : modelStatus.read();
  const capabilities = platformCapabilityAuthority.evaluate(accountState);
  const modelBrain = projectModelBrain(currentModelState);
  return {
    schemaVersion: SCHEMA_VERSION,
    documentType: 'YANCE_ROUND12_PLATFORM_CORE_AND_MODEL_BRAIN_STATUS',
    authority: AUTHORITY,
    generatedAt: new Date().toISOString(),
    state: 'source-and-automation-checkpoint',
    completionSemantics: {
      sourceAndAutomationOnly: true,
      windowsVerified: false,
      realPlatformVerified: false,
      sealedLiteLLMRuntimeVerified: false
    },
    platformCore: {
      capabilityAuthority: {
        authority: capabilities.authority,
        global: capabilities.global,
        summary: capabilities.summary,
        platforms: Object.fromEntries(Object.entries(capabilities.platforms || {}).map(([id, row]) => [id, {
          availability: row.availability,
          counts: row.counts,
          definitions: (row.definitions || []).map(item => ({ capabilityId: item.capabilityId, support: item.support }))
        }]))
      },
      adapterContracts: platformAdapters.contracts(),
      channelAdapterContracts: channelAdapterRuntime.describe(),
      persistence: safePersistenceSummary(repository),
      cutover: {
        capabilityAuthority: {
          state: 'production-wired',
          scope: ['backend capability API', 'send-policy preflight', 'account/platform/capability health projection'],
          windowsVerified: false
        },
        genericUiCapabilityMigration: {
          state: 'production-wired',
          note: '通用会话动作、在线状态、输入状态、历史同步与动作可见性统一查询能力权威；平台专属认证、诊断和资料页面仅保留必要的协议分支。',
          remainingAuditRequired: false,
          auditedGenericActions: ['terminalPresence','incomingTyping','historySync','text','media','reaction','revoke','readReceipt','typingSend']
        },
        egressOutbox: {
          state: 'production-wired',
          coveredOperations: ['text', 'media', 'native_expression', 'reaction', 'revoke'],
          remainingOperations: [],
          directMessageSdkBypassAllowed: false,
          retryPolicyBoundToFrozenCommand: true
        },
        ingressEventModel: {
          state: 'authoritative-event-first',
          authoritativeProjection: true,
          productionMessageProjectionPreserved: true,
          eventCoverage: ['message.received','message.sent','message.echo.received','message.reaction.updated','message.revoked','message.receipt.updated','message.receipt.range.updated','conversation.read','contact.observed','conversation.observed','media.lifecycle.updated','history.sync.completed','history.sync.failed','reconcile.completed','reconcile.failed','identity.link.observed','identity.link.transitioned','identity.person.merged','identity.operation.rolled_back'],
          historicalConvergenceAuditOnStartup: true,
          fullPaginatedAudit: true,
          blockingReceiptGovernanceApi: true,
          auditedRepairAndReplay: true,
          productGovernanceUi: true,
          architectureEvidenceExported: true,
          releaseGateUsesRuntimeConvergence: true,
          realDataConvergenceVerified: false,
          note: '消息、回执、Echo、Reaction、撤回、已读、媒体、历史、对账和身份治理均进入脱敏 domain_event；可修复事件支持审计化重放，所有扩展事件均读取独立持久化状态并由实时/启动审计更新收据，不再由事件载荷自证。真实数据 blocking=0 仍待 Windows 数据环境验证。'
        },
        adapterPorts: {
          state: 'production-wired',
          ports: ['auth', 'ingress', 'egress', 'reconcile'],
          egressUsedBySendQueue: true,
          runtimeRecoveryUsesAuthPort: true,
          allFormalEntryPointsMigrated: true,
          concreteAdapterImportsRestrictedToCompositionRoot: true,
          internalLifecycleDispatchUsesDriverRegistry: true,
          allLegacyAuthAndReconcileHandlersMigrated: true,
          driverContracts: platformDriverRegistry.contracts(),
          accountDriverContracts: platformDriverRegistry.driverContracts()
        },
        identityAuthority: {
          state: 'person-anchor-wired',
          accountScopedIdentityKeys: true,
          personAnchorsCustomerProfile: true,
          personAnchorsRelationship: true,
          personAnchorsMemory: true,
          personAnchorsLearning: true,
          personAnchorsConversation: true,
          automaticDisplayNameMergeForbidden: true,
          strongEvidenceSuggestionsOnly: true,
          humanConfirmationRequired: true,
          allStateTransitionsAuditedAndRollbackable: true,
          reversibleMergeAuditRequired: true,
          mergeRollbackProductEntry: true,
          disputeDetachAndGenericRollbackProductEntry: true,
          automaticCrossPlatformMergeEnabled: false
        }
      },
      invariants: {
        platformFailureDoesNotEscalateToGlobal: true,
        allMessageEgressConsumesFrozenOutbox: true,
        sendRetriesHonorFrozenPolicyBudget: true,
        reconciliationFacadeDoesNotBlockRealtime: true,
        identityLinksAreAccountScoped: true,
        automaticDisplayNameMergeForbidden: true,
        identityMergeRollbackRequired: true,
        eventProjectionCurrentlyShadowMode: false,
        authoritativeEventProjection: true,
        runtimeProjectionHealthDegradesWithoutStoppingMessageTransport: true,
        runtimeReleaseGateRequiresProjectionConvergence: true,
        governanceEvidenceIncludesArchitectureReceipts: true,
        governanceUiSupportsPaginationAndContinuousRepair: true
      }
    },
    modelBrain
  };
}

module.exports = { AUTHORITY, SCHEMA_VERSION, MODEL_BRAIN_TASKS, projectModelBrain, snapshot };
