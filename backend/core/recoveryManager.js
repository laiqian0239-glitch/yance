'use strict';

const { CoreError } = require('../../shared/core/errors');
const { sanitizeObject } = require('../services/privacy');

function clean(value) { return String(value == null ? '' : value).trim(); }

class RecoveryManager {
  constructor({
    safeModeService,
    backupService,
    diagnosticsService,
    productionDiagnostics,
    systemPolicy,
    lifecycleManager,
    securityGuard,
    eventBus,
    logger,
    artifactRegistry = null,
    artifactBootstrap = null
  }) {
    this.safeModeService = safeModeService;
    this.backupService = backupService;
    this.diagnosticsService = diagnosticsService;
    this.productionDiagnostics = productionDiagnostics;
    this.systemPolicy = systemPolicy;
    this.lifecycleManager = lifecycleManager;
    this.securityGuard = securityGuard;
    this.eventBus = eventBus;
    this.logger = logger;
    this.artifactRegistry = artifactRegistry;
    this.artifactBootstrap = artifactBootstrap;
    this.artifactBootstrapState = null;
    this.started = false;
    this.startedAt = '';
  }

  async prepare() { return this.snapshot(); }
  async start() {
    this.started = true;
    this.startedAt = new Date().toISOString();
    if (this.artifactBootstrap?.bootstrap) {
      try { this.artifactBootstrapState = await this.artifactBootstrap.bootstrap(); }
      catch (error) {
        this.artifactBootstrapState = { ok: false, reasonCode: String(error?.code || 'ARTIFACT_BOOTSTRAP_FAILED'), message: String(error?.message || '') };
        this.logger?.warn?.('recovery-artifact-bootstrap-failed', this.artifactBootstrapState);
      }
    }
    return this.snapshot();
  }
  async enterSafeMode() { return { safeMode: true }; }
  async exitSafeMode() { return { safeMode: false }; }
  async stop() { this.started = false; return { stopped: true }; }

  snapshot() {
    return {
      module: 'RecoveryManager',
      ready: this.started,
      startedAt: this.startedAt,
      safeMode: this.safeModeService.snapshot(),
      pendingRestore: this.backupService.pendingRestore(),
      recentRestoreHistory: this.backupService.restoreHistory(10),
      artifacts: this.artifactRegistry?.snapshot?.() || null,
      artifactBootstrap: this.artifactBootstrapState || this.artifactBootstrap?.snapshot?.() || null
    };
  }

  async secured(action, context, operation) {
    return this.securityGuard.execute(action, { actor: 'backend-core', recovery: true, ...context }, operation);
  }

  integritySnapshot() {
    const diagnostics = this.diagnosticsService.snapshot();
    const criticalFailures = (diagnostics.tests || []).filter(row => row.id !== 'safe-mode-state' && row.pass === false && ['critical', 'high'].includes(row.severity));
    return { diagnostics, criticalFailures, ok: criticalFailures.length === 0 };
  }

  async execute(command, payload = {}, context = {}) {
    switch (command) {
      case 'recovery.getState': return this.snapshot();
      case 'recovery.runIntegrityCheck': return this.integritySnapshot();
      case 'recovery.enterSafeMode': return this.secured(command, context, async () => {
        const reason = payload.reason || '用户主动进入安全模式';
        if (this.lifecycleManager.operatingMode !== 'safeMode') await this.lifecycleManager.enterSafeMode(reason, { code: payload.code || 'MANUAL_SAFE_MODE', source: payload.trigger || 'manual' });
        this.eventBus?.publish?.('recovery:safe-mode-entered', { reason, correlationId: context.correlationId || '' });
        return this.snapshot();
      });
      case 'recovery.clearSafeMode': return this.secured(command, context, async () => {
        const integrity = this.integritySnapshot();
        if (!integrity.ok && payload.force !== true) {
          throw new CoreError('SAFE_MODE_EXIT_BLOCKED', '仍存在高严重度完整性问题，不能退出安全模式', { status: 409, details: { failures: integrity.criticalFailures } });
        }
        if (payload.force === true && !clean(payload.reason)) throw new CoreError('SAFE_MODE_FORCE_REASON_REQUIRED', '强制退出安全模式必须填写原因', { status: 400 });
        if (clean(payload.confirmation) !== 'EXIT_SAFE_MODE') throw new CoreError('SAFE_MODE_CONFIRMATION_REQUIRED', '退出安全模式需要明确确认', { status: 409 });
        if (this.lifecycleManager.operatingMode === 'safeMode') await this.lifecycleManager.exitSafeMode(payload.reason || 'safe-mode-cleared');
        this.eventBus?.publish?.('recovery:safe-mode-cleared', { forced: payload.force === true, correlationId: context.correlationId || '' });
        return { ...this.snapshot(), integrity };
      });
      case 'recovery.createBackup': return this.secured(command, context, async () => this.backupService.createBackup(payload.label || 'manual-recovery', { profile: payload.profile, roots: payload.roots }));
      case 'recovery.verifyBackup': return this.backupService.verifyBackup(payload.name, { force: true });
      case 'recovery.stageRestore': return this.secured(command, context, async () => {
        const result = this.backupService.stageRestore(payload.name);
        if (this.lifecycleManager.operatingMode !== 'safeMode') await this.lifecycleManager.enterSafeMode(`等待恢复：${payload.name}`, { code: 'RESTORE_STAGED', source: 'restore' });
        return result;
      });
      case 'recovery.cancelRestore': return this.secured(command, context, async () => this.backupService.cancelPendingRestore());
      case 'recovery.getHistory': return { history: this.backupService.restoreHistory(Number(payload.limit || 50)), pendingRestore: this.backupService.pendingRestore() };
      case 'recovery.getArtifactState': return { artifacts: this.artifactRegistry?.snapshot?.() || null };
      case 'recovery.registerArtifactCandidate': return this.secured(command, context, async () => {
        if (!this.artifactRegistry) throw new CoreError('ARTIFACT_REGISTRY_UNAVAILABLE', '运行制品注册表尚未启用', { status: 503 });
        return this.artifactRegistry.registerCandidate(payload);
      });
      case 'recovery.promoteArtifactCandidate': return this.secured(command, context, async () => {
        if (!this.artifactRegistry) throw new CoreError('ARTIFACT_REGISTRY_UNAVAILABLE', '运行制品注册表尚未启用', { status: 503 });
        return this.artifactRegistry.promoteCandidate(payload.artifactId, payload.healthReport || {});
      });
      case 'recovery.rollbackArtifact': return this.secured(command, context, async () => {
        if (!this.artifactRegistry) throw new CoreError('ARTIFACT_REGISTRY_UNAVAILABLE', '运行制品注册表尚未启用', { status: 503 });
        return this.artifactRegistry.rollback(payload.type, { reason: payload.reason });
      });
      case 'recovery.acknowledgeArtifactApplied': return this.secured(command, context, async () => {
        if (!this.artifactRegistry) throw new CoreError('ARTIFACT_REGISTRY_UNAVAILABLE', '运行制品注册表尚未启用', { status: 503 });
        return this.artifactRegistry.acknowledgeApplied(payload.type, payload.artifactId);
      });
      case 'recovery.exportDiagnostics': return sanitizeObject({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        privacyMode: this.systemPolicy.read?.().privacyMode !== false,
        recovery: this.snapshot(),
        integrity: this.integritySnapshot(),
        operations: this.productionDiagnostics.snapshot({ limit: Number(payload.limit || 200) })
      }, { redactPaths: true });
      default: throw new CoreError('RECOVERY_COMMAND_UNSUPPORTED', `RecoveryManager 不支持命令：${command}`, { status: 404 });
    }
  }
}

module.exports = { RecoveryManager };
