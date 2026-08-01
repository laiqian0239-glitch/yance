'use strict';

const eventBus = require('../services/eventBus');
const logger = require('../services/logger');
const accountManager = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const accountMigration = require('../services/accountMigrationService');
const messageStore = require('../services/messageStore');
const sendQueue = require('../services/sendQueueService');
const platformMessaging = require('../services/platformMessagingService');
const platformCapabilities = require('../services/platformCapabilities');
const platformDrivers = require('../services/platformDriverRegistry');
const canonicalIdentity = require('../services/canonicalIdentityService');
const updatePreflight = require('../services/updatePreflightService');
const workspaceData = require('../services/workspaceDataService');
const modelRegistry = require('../services/modelRegistry');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const backupService = require('../services/backupService');
const diagnosticsService = require('../services/diagnosticsService');
const productionDiagnostics = require('../services/productionDiagnosticsService');
const safeModeService = require('../services/safeModeService');
const systemPolicy = require('../services/systemPolicy');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const { AccountContext } = require('../core/accountContext');
const { UpdateManager } = require('../core/updateManager');
const { StoreProjectionCoordinator } = require('../core/projections/storeProjectionCoordinator');
const { RecoveryManager } = require('../core/recoveryManager');
const { getRuntimeArtifactRegistryService } = require('../services/runtimeArtifactRegistryService');
const { RuntimeArtifactBootstrapService } = require('../services/runtimeArtifactBootstrapService');
const domainOperationalEventBridge = require('../services/domainOperationalEventBridge').singleton;
const domainEventProjectionAuthority = require('../services/domainEventProjectionAuthority').singleton;
const accountLifecycleSaga = require('../services/accountLifecycleSagaService').singleton;
const learningSynthesisScheduler = require('../services/learningSynthesisScheduler').singleton;
const { getRuntimeSafetySupervisor } = require('../services/runtimeSafetySupervisor');
const { getScopedSafetyAuthority } = require('../services/scopedSafetyAuthority');

function createAppRuntimeComposition(runtime) {
  const securityGuard = getSecurityGuard();
  const accountContext = new AccountContext({
    securityGuard, accountManager, accountStore, accountMigration, messageStore, sendQueue,
    platformMessaging, platformCapabilities, platformDrivers, canonicalIdentity, eventBus
  });
  const updateManager = new UpdateManager({ securityGuard, lifecycleManager: runtime, updatePreflight, eventBus });
  const artifactRegistry = getRuntimeArtifactRegistryService();
  const artifactBootstrap = new RuntimeArtifactBootstrapService({ artifactRegistry, registry: artifactRegistry, modelRegistry, logger });
  const recoveryManager = new RecoveryManager({
    safeModeService, backupService, diagnosticsService, productionDiagnostics, systemPolicy,
    lifecycleManager: runtime, securityGuard, eventBus, logger,
    artifactRegistry, artifactBootstrap, scopedSafety: getScopedSafetyAuthority()
  });
  const storeProjectionCoordinator = new StoreProjectionCoordinator({ eventBus, logger, workspaceData, modelRegistry, aiTaskRuntimeRegistry });
  const runtimeSafetySupervisor = getRuntimeSafetySupervisor().bindRuntime(runtime);
  safeModeService.bindAuthority(() => {
    const snapshot = runtime.store.snapshot();
    let authority = {};
    try { authority = runtime.store.getOperatingModeAuthority?.() || {}; } catch (_) {}
    return {
      operatingMode: snapshot.runtime.operatingMode,
      updatedAtUtc: snapshot.runtime.updatedAtUtc || '',
      reasonCode: authority.reasonCode || '',
      reason: authority.reason || authority.reasonCode || '',
      reasons: authority.reasons || [],
      enteredAt: authority.enteredAt || '',
      updatedBy: authority.updatedBy || 'runtime-authority',
      trigger: authority.trigger || '',
      evidenceSha256: authority.evidenceSha256 || ''
    };
  });
  securityGuard.setPolicyProviders({
    safeModeProvider: () => runtime.operatingMode === 'safeMode',
    lifecycleStateProvider: () => runtime.state,
    productionDiagnostics
  });
  return Object.freeze({
    accountContext,
    updateManager,
    recoveryManager,
    securityGuard,
    storeProjectionCoordinator,
    runtimeSafetySupervisor,
    participants: Object.freeze([
      { name: 'security-guard', service: securityGuard, critical: true },
      { name: 'recovery-manager', service: recoveryManager, critical: true },
      { name: 'account-lifecycle-saga', service: accountLifecycleSaga, critical: true },
      { name: 'account-context', service: accountContext, critical: true },
      { name: 'runtime-safety-supervisor', service: runtimeSafetySupervisor, critical: false },
      { name: 'domain-operational-event-bridge', service: domainOperationalEventBridge, critical: false },
      { name: 'domain-event-projection-authority', service: domainEventProjectionAuthority, critical: false },
      { name: 'learning-synthesis-scheduler', service: learningSynthesisScheduler, critical: false },
      { name: 'store-projection-coordinator', service: storeProjectionCoordinator, critical: true },
      { name: 'update-manager', service: updateManager, critical: false }
    ]),
    eventBus,
    logger,
    productionDiagnostics
  });
}

module.exports = { createAppRuntimeComposition };
