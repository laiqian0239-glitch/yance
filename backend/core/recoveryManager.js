'use strict';

const crypto = require('node:crypto');
const { CoreError } = require('../../shared/core/errors');
const { sanitizeObject } = require('../services/privacy');
const { isGlobalReason } = require('../services/scopedSafetyAuthority');

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

const GLOBAL_DIAGNOSTIC_IDS = new Set([
  'data-root', 'sqlite-store', 'secure-root', 'restore-engine',
  'runtime-authority', 'runtime-operating-mode-authority', 'artifact-integrity',
  'release-manifest-integrity', 'database-migration'
]);

function diagnosticReasonCode(row = {}) {
  return clean(row.reasonCode || row.code || row.id).toUpperCase();
}
function isGlobalDiagnosticFailure(row = {}) {
  if (row.pass !== false || !['critical', 'high'].includes(clean(row.severity).toLowerCase())) return false;
  const reasonCode = diagnosticReasonCode(row);
  if (isGlobalReason(reasonCode)) return true;
  if (clean(row.scopeType).toLowerCase() === 'system' && GLOBAL_DIAGNOSTIC_IDS.has(clean(row.id).toLowerCase())) return true;
  return GLOBAL_DIAGNOSTIC_IDS.has(clean(row.id).toLowerCase());
}

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
    artifactBootstrap = null,
    scopedSafety = null,
    clock = nowIso
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
    this.scopedSafety = scopedSafety || null;
    this.clock = clock;
    this.safeModeExitAuthorizations = new Map();
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
      artifactBootstrap: this.artifactBootstrapState || this.artifactBootstrap?.snapshot?.() || null,
      scopedSafety: this.scopedSafety?.snapshot?.() || { active: [], globalBlockers: [] },
      safeModeExitAssessment: this.safeModeExitAssessment()
    };
  }

  async secured(action, context, operation) {
    return this.securityGuard.execute(action, { actor: 'backend-core', recovery: true, ...context }, operation);
  }

  integritySnapshot() {
    const diagnostics = this.diagnosticsService.snapshot();
    const criticalFailures = (diagnostics.tests || []).filter(row => row.id !== 'safe-mode-state' && row.pass === false && ['critical', 'high'].includes(clean(row.severity).toLowerCase()));
    const globalCriticalFailures = criticalFailures.filter(isGlobalDiagnosticFailure);
    const scopedFailures = criticalFailures.filter(row => !isGlobalDiagnosticFailure(row));
    return { diagnostics, criticalFailures, globalCriticalFailures, scopedFailures, ok: globalCriticalFailures.length === 0 };
  }

  safeModeExitAssessment() {
    const integrity = this.integritySnapshot();
    let scoped = { active: [], globalBlockers: [] };
    try { scoped = this.scopedSafety?.snapshot?.() || scoped; } catch (_) {}
    const globalBlockers = [
      ...integrity.globalCriticalFailures.map(row => ({ source: 'diagnostics', reasonCode: diagnosticReasonCode(row), id: clean(row.id), detail: clean(row.detail) })),
      ...(scoped.globalBlockers || []).map(row => ({ source: 'scoped-safety', reasonCode: clean(row.reasonCode), issueId: clean(row.issueId), detail: row.detail || {} }))
    ];
    const seen = new Set();
    const uniqueBlockers = globalBlockers.filter(row => {
      const key = `${row.source}:${row.reasonCode}:${row.id || row.issueId || ''}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
    return {
      ok: uniqueBlockers.length === 0,
      globalBlockers: uniqueBlockers,
      scopedFailures: integrity.scopedFailures,
      scopedIssues: (scoped.active || []).filter(row => row.scopeType !== 'system'),
      assessedAt: this.clock()
    };
  }

  prepareSafeModeExit(payload = {}, context = {}) {
    if (clean(payload.confirmation) !== 'EXIT_SAFE_MODE') throw new CoreError('SAFE_MODE_CONFIRMATION_REQUIRED', '退出安全模式需要明确确认', { status: 409 });
    const assessment = this.safeModeExitAssessment();
    if (!assessment.ok) {
      throw new CoreError('SAFE_MODE_EXIT_BLOCKED_GLOBAL', '仍存在共享基础设施阻断，不能退出全局安全模式', { status: 409, details: { blockers: assessment.globalBlockers } });
    }
    const exitAuthorizationId = `safe-exit-${crypto.randomUUID()}`;
    const exitAuthorizationToken = crypto.randomBytes(32).toString('hex');
    const issuedAt = this.clock();
    const expiresAt = new Date(Date.parse(issuedAt) + 60_000).toISOString();
    this.safeModeExitAuthorizations.set(exitAuthorizationId, {
      tokenSha256: hash(exitAuthorizationToken), expiresAt, actor: clean(context.actor || 'user'), reason: clean(payload.reason || 'safe-mode-cleared')
    });
    return { exitAuthorizationId, exitAuthorizationToken, issuedAt, expiresAt, assessment };
  }

  consumeSafeModeExitAuthorization(payload = {}) {
    const id = clean(payload.exitAuthorizationId);
    const token = clean(payload.exitAuthorizationToken);
    if (!id || !token) {
      throw new CoreError('SAFE_MODE_EXIT_AUTHORIZATION_REQUIRED', '退出全局安全模式需要恢复权威签发的有效收据', { status: 409 });
    }
    const row = this.safeModeExitAuthorizations.get(id);
    if (!row) throw new CoreError('SAFE_MODE_EXIT_AUTHORIZATION_INVALID', '安全模式退出收据不存在、已使用或已失效', { status: 409 });
    this.safeModeExitAuthorizations.delete(id);
    if (Date.parse(row.expiresAt) <= Date.parse(this.clock()) || hash(token) !== row.tokenSha256) {
      throw new CoreError('SAFE_MODE_EXIT_AUTHORIZATION_INVALID', '安全模式退出收据无效或已过期', { status: 409 });
    }
    return true;
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
      case 'recovery.prepareSafeModeExit':
      case 'recovery.clearSafeMode': return this.secured(command, context, async () => this.prepareSafeModeExit(payload, context));
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
