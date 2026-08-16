'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONFIG, PATHS } = require('../config');
const diagnostics = require('./diagnosticsService');
const backup = require('./backupService');
const accountManager = require('./accountManager');
const notificationPolicy = require('./notificationPolicy');
const systemPolicy = require('./systemPolicy');
const modelStatus = require('./modelStatusService');
const featureFlags = require('./featureFlags');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const healthHistory = require('./healthHistory');
const logger = require('./logger');
const runtimeRecovery = require('./runtimeRecoveryService');
const aiAutomation = require('./aiBrainOrchestrator');
const performancePolicy = require('./performancePolicy');
const settingsRepository = require('../repositories/settingsRepository');
const accountStore = require('./accountStore');
const integrityIssueAggregator = require('./integrityIssueAggregator');
const sendQueue = require('./sendQueueService');
const safeModeService = require('./safeModeService');
const productionDiagnostics = require('./productionDiagnosticsService');
const { getDiagnosticsReleaseIdentity, diagnosticsBuildIdentity } = require('../../diagnostics/releaseIdentity');
const { getBackendReleaseIdentity } = require('../releaseIdentity');
const { recentCoreFailures, buildReleaseReadiness } = require('./systemReleaseReadiness');
const { buildTopology, buildAvailability } = require('./systemHealthProjection');
const systemHealthAuthority = require('./systemHealthAuthority');
const dataProtectionAuthority = require('./dataProtectionAuthority');
const backgroundJobAuthority = require('./backgroundJobAuthority');
const asyncOperationLifecycleAuthority = require('./asyncOperationLifecycleAuthority').authority;
const { getRuntimeSafetySupervisor } = require('./runtimeSafetySupervisor');
const { verifyRuntimeGovernanceEvidence } = require('./runtimeGovernanceEvidenceService');

function bytes(value) {
  const number = Math.max(0, Number(value || 0));
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  if (number < 1024 * 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`;
  return `${(number / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const DIRECTORY_CACHE = new Map();
const DIRECTORY_CACHE_TTL_MS = Math.max(1000, Number(process.env.YANCE_DIRECTORY_STATS_TTL_MS || 30000));

function directorySize(root, options = {}) {
  const key = path.resolve(root);
  const cached = DIRECTORY_CACHE.get(key);
  if (!options.force && cached && Date.now() - cached.at < DIRECTORY_CACHE_TTL_MS) return { ...cached.value };
  let total = 0;
  let files = 0;
  const visit = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) visit(full);
        else { total += fs.statSync(full).size; files += 1; }
      } catch (_) {}
    }
  };
  visit(root);
  const value = { bytes: total, files, sizeLabel: bytes(total) };
  DIRECTORY_CACHE.set(key, { at: Date.now(), value });
  return { ...value };
}

function maskPath(value, privacyMode) {
  if (!value) return '';
  if (!privacyMode) return value;
  const normalized = path.normalize(value);
  const parts = normalized.split(path.sep).filter(Boolean);
  return parts.length <= 2 ? normalized : `${parts[0]}${path.sep}…${path.sep}${parts.slice(-2).join(path.sep)}`;
}

function ageHours(value) {
  const at = new Date(value || '').getTime();
  return Number.isFinite(at) ? Math.max(0, (Date.now() - at) / 3600000) : Infinity;
}

function sqliteSummary() {
  const pragma = name => settingsRepository.pragma(name);
  const required = ['desktop-settings', 'notification-settings', 'system-policy', 'performance-settings'];
  const rows = settingsRepository.listDocumentNamespaces();
  const namespaces = Object.fromEntries(rows.map(row => [row.namespace, { updatedAt: row.updatedAt, bytes: Number(row.bytes || 0) }]));
  return {
    path: settingsRepository.dbPath(),
    journalMode: String(pragma('journal_mode') || ''),
    synchronous: Number(pragma('synchronous') ?? -1),
    foreignKeys: Number(pragma('foreign_keys') || 0) === 1,
    busyTimeoutMs: Number(pragma('busy_timeout') || 0),
    walAutoCheckpoint: Number(pragma('wal_autocheckpoint') || 0),
    quickCheck: String(pragma('quick_check') || ''),
    namespaces,
    requiredNamespaces: required,
    persistenceHealthy: required.every(name => Boolean(namespaces[name])) && String(pragma('quick_check') || '') === 'ok'
  };
}

function performanceSummary() {
  const policy = performancePolicy.read();
  const memory = process.memoryUsage();
  return {
    ...policy,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      rssLabel: bytes(memory.rss),
      heapUsedLabel: bytes(memory.heapUsed),
      softLimitBytes: policy.softMemoryLimitMb * 1024 * 1024,
      withinSoftLimit: memory.rss <= policy.softMemoryLimitMb * 1024 * 1024
    },
    sqlite: sqliteSummary(),
    strategy: 'cursor-pagination+ndjson-stream+bounded-render-cache'
  };
}

function backupSummary() {
  const backups = backup.listBackups();
  const rows = backups.slice(0, 8).map((row, index) => {
    const verification = index < 5 ? backup.verifyBackup(row.name) : null;
    return {
      name: row.name,
      createdAt: row.manifest?.createdAt || '',
      label: row.manifest?.label || '',
      schemaVersion: Number(row.manifest?.schemaVersion || 0),
      productVersion: row.manifest?.product?.version || '',
      productBuild: row.manifest?.product?.build || '',
      roots: row.manifest?.roots || [],
      coverage: row.manifest?.coverage || [],
      excluded: row.manifest?.excluded || [],
      files: row.manifest?.files?.length || 0,
      size: row.manifest?.totalBytes || 0,
      sizeLabel: bytes(row.manifest?.totalBytes || 0),
      valid: verification ? Boolean(verification.ok) : null,
      verifyMessage: verification?.message || '尚未在本次会话验证'
    };
  });
  const latest = rows[0] || null;
  return {
    count: backups.length,
    latest,
    rows,
    latestAgeHours: latest ? ageHours(latest.createdAt) : null,
    pendingRestore: backup.pendingRestore(),
    restoreHistory: backup.restoreHistory(8),
    retention: backup.retentionState()
  };
}

function sendQueueSummary() {
  try {
    const status = sendQueue.status();
    return {
      ...status,
      writeBlocked: status.resumeBlocked === true || status.pausedReason === 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN',
      authority: 'SendQueueService'
    };
  } catch (error) {
    logger.error('system-center', 'send-queue-status-failed', { code: error.code || 'SEND_QUEUE_STATUS_FAILED', error: error.message });
    return {
      started: false,
      running: false,
      paused: true,
      pausedReason: 'SEND_QUEUE_STATUS_UNAVAILABLE',
      outcomeUnknown: 0,
      resumeBlocked: true,
      pending: 0,
      writeBlocked: true,
      authority: 'SendQueueService',
      error: error.message || String(error)
    };
  }
}

function accountSummary() {
  const data = accountManager.list();
  const engineLabel = {
    whatsapp: { label: 'WhatsApp实时连接引擎', technical: 'Baileys本地直连' },
    telegram: { label: 'Telegram个人账号引擎', technical: 'MTProto本地会话' },
    facebook: { label: 'Facebook公共主页引擎', technical: 'Graph API + Webhook' }
  };
  return {
    ...data.summary,
    credentialStorage: data.credentialStorage,
    platforms: data.summary.platforms.map(row => ({ ...row, ...(engineLabel[row.platform] || {}) })),
    rows: data.accounts.map(row => ({
      id: row.id,
      platform: row.platform,
      displayName: row.displayName,
      identityLabel: row.identityLabel,
      state: row.state,
      stateLabel: row.stateLabel,
      health: row.health,
      credentialReady: row.credentialReady,
      connectedAt: row.connectedAt,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      unread: row.unread,
      notificationsEnabled: row.notificationsEnabled !== false,
      autoReconnect: row.autoReconnect !== false,
      paused: row.paused === true,
      isDefaultSend: row.isDefaultSend === true,
      source: row.source || '',
      canAttemptSend: row.canAttemptSend,
      sendVerified: row.sendVerified,
      sendReadiness: row.sendReadiness,
      lastDeliveryAckAt: row.lastDeliveryAckAt,
      canSend: row.canSend,
      canReceive: row.canReceive,
      capabilities: row.capabilities
    })),
    capabilityMatrix: data.capabilityMatrix,
    audit: (data.audit || []).slice(0, 20)
  };
}

function modelBrainCapabilitySurface(row = {}) {
  const capabilities = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
  const privacy = String(capabilities.privacy || '').trim();
  return {
    ...row,
    modalities: Array.isArray(capabilities.modalities) ? [...capabilities.modalities] : [],
    languages: Array.isArray(capabilities.language) ? [...capabilities.language] : [],
    contextLength: Number(capabilities.context || 0),
    privacy: privacy ? [privacy] : []
  };
}

function aiSummary() {
  const state = modelStatus.read();
  const rows = Array.isArray(state.models) ? state.models : [];
  const summary = state.summary || {};
  const catalog = state.catalog || {};
  const modelBrain = state.modelBrain || {};
  const taskReadiness = state.taskReadiness || { pass: false, tasks: [], missing: [] };
  const evidence = modelBrain.lastEvidence && typeof modelBrain.lastEvidence === 'object' ? modelBrain.lastEvidence : null;
  const assets = directorySize(PATHS.aiAssets);
  const registryStats = directorySize(PATHS.models);
  return {
    online: modelBrain.runtimeAvailable === true,
    ollamaOnline: catalog.ollamaOnline === true,
    endpoint: catalog.endpoint || '',
    version: catalog.version || '',
    scannedAt: catalog.scannedAt || '',
    scanError: catalog.scanError || '',
    count: Number(summary.total || rows.length || 0),
    verified: Number(summary.verified || 0),
    experimental: Number(summary.experimental || 0),
    local: Number(summary.local || 0),
    cloud: Number(summary.cloud || 0),
    modelBrain: {
      name: 'Model Brain',
      litellm: modelBrain.litellm || 'LiteLLM v1.95.0',
      health: modelBrain.health || 'unavailable',
      runtimeAvailable: modelBrain.runtimeAvailable === true,
      complexityRouter: modelBrain.complexityRouter || 'ComplexityRouter',
      strictTagFiltering: modelBrain.strictTagFiltering || { enabled: true, matchAny: false }
    },
    hardEligibility: {
      privacy: 'privacy/local-cloud',
      local: Number(summary.local || 0),
      cloud: Number(summary.cloud || 0),
      modality: ['text', 'vision', 'audio', 'video'],
      language: 'native-register',
      context: 'context length',
      provider: 'explicit allow/deny'
    },
    taskReadiness,
    executionEvidence: evidence ? {
      selectedModel: evidence.selectedModel || '',
      provider: evidence.provider || '',
      latencyMs: Number(evidence.latencyMs || 0),
      inputTokens: Number(evidence.inputTokens || 0),
      outputTokens: Number(evidence.outputTokens || 0),
      costUsd: Number(evidence.costUsd || 0),
      retryCount: Number(evidence.retryCount || 0),
      fallbackCount: Number(evidence.fallbackCount || 0)
    } : null,
    lastUsedAt: rows.map(row => row.lastUsedAt).filter(Boolean).sort().at(-1) || '',
    automation: aiAutomation.status(),
    source: state.source,
    models: rows.slice(0, 20).map(modelBrainCapabilitySurface),
    openRouter: state.openRouter || {},
    assets: {
      path: PATHS.aiAssets,
      files: assets.files,
      bytes: assets.bytes,
      sizeLabel: assets.sizeLabel,
      registryFiles: registryStats.files,
      registryBytes: registryStats.bytes,
      registrySizeLabel: registryStats.sizeLabel,
      backupIncluded: true,
      baseModelsIncluded: false
    }
  };
}

function dataSummary(privacyMode) {
  const roots = [
    ['store', '核心数据与设置', PATHS.db, true],
    ['models', '模型目录与资格', PATHS.models, true],
    ['whatsappAuth', 'WhatsApp本地认证', PATHS.whatsappAuth, true],
    ['secure', '系统加密凭据', PATHS.secure, true],
    ['aiAssets', 'AI成果与知识资产', PATHS.aiAssets, true],
    ['notificationSounds', '用户自定义提示音', PATHS.notificationSounds, true],
    ['media', '媒体缓存', PATHS.media, false]
  ].map(([id, label, root, backupIncluded]) => dataProtectionAuthority.projectDataRoot({
    id,
    label,
    path: maskPath(root, privacyMode),
    backupIncluded
  }, directorySize(root), { formatBytes: bytes }));
  return {
    roots,
    totalBytes: roots.reduce((sum, row) => sum + row.bytes, 0),
    totalFiles: roots.reduce((sum, row) => sum + row.files, 0),
    totalSizeLabel: bytes(roots.reduce((sum, row) => sum + row.bytes, 0)),
    protectedBytes: roots.filter(row => row.backupIncluded).reduce((sum, row) => sum + row.bytes, 0),
    protectedSizeLabel: bytes(roots.filter(row => row.backupIncluded).reduce((sum, row) => sum + row.bytes, 0))
  };
}

function architectureIntegritySummary(report, accounts, ai, performance) {
  const schemaVersion = settingsRepository.schemaVersion();
  const migration = settingsRepository.getCompletedMigration('009_stage6_3_4_architecture_closure');
  const rawAccounts = accountStore.listAll();
  const blockedAliases = rawAccounts.filter(row => ['merged', 'tombstoned', 'migrating'].includes(String(row.lifecycleState || row.lifecycle_state || '')) || row.mergedIntoId || row.merged_into_id);
  const runtimeEligibleAliases = rawAccounts.filter(row => row.platform === 'whatsapp' && row.id !== (row.canonicalAccountId || row.id) && row.paused !== true && row.autoReconnect !== false);
  const interruptedSync = settingsRepository.countInterruptedSync();
  const activeAggregates = integrityIssueAggregator.listActive();
  const modelBrainReady = ai.modelBrain?.runtimeAvailable === true;
  const hardEligibilityReady = ai.count === 0 || ai.taskReadiness?.pass === true;
  const checks = [
    { id: 'schema-version', severity: 'critical', pass: schemaVersion >= 9, detail: `schemaVersion=${schemaVersion}, required>=9` },
    { id: 'migration-ledger', severity: 'critical', pass: Boolean(migration), detail: migration ? `已记录 ${migration.id}` : '缺少架构收口迁移记录' },
    { id: 'sqlite-persistence', severity: 'critical', pass: performance.sqlite.persistenceHealthy === true, detail: performance.sqlite.persistenceHealthy ? '设置命名空间与quick_check通过' : '设置命名空间缺失或quick_check失败' },
    { id: 'model-brain', severity: 'critical', pass: modelBrainReady, detail: modelBrainReady ? `Model Brain / ${ai.modelBrain?.litellm || 'LiteLLM'} sealed runtime health=${ai.modelBrain?.health || 'healthy'}` : `Model Brain / LiteLLM sealed runtime ${ai.modelBrain?.health || 'unavailable'}` },
    { id: 'model-brain-hard-eligibility', severity: 'high', pass: hardEligibilityReady, detail: hardEligibilityReady ? 'privacy/local/cloud/modality/language/context/provider hard eligibility ready' : `${Number(ai.taskReadiness?.missing?.length || 0)} logical tasks have no hard-qualified capability` },
    { id: 'account-runtime-aliases', severity: 'critical', pass: runtimeEligibleAliases.length === 0, detail: runtimeEligibleAliases.length ? `${runtimeEligibleAliases.length} 个别名仍可进入运行态` : '别名与迁移账号已被运行时门禁隔离' },
    { id: 'sync-checkpoints', severity: 'high', pass: Number(interruptedSync) === 0, detail: interruptedSync ? `${interruptedSync} 个同步检查点需要恢复` : '没有未完成的同步检查点' },
    { id: 'integrity-aggregates', severity: 'high', pass: activeAggregates.filter(row => ['critical','high'].includes(row.severity)).length === 0, detail: activeAggregates.length ? `${activeAggregates.length} 个聚合完整性根因处于活动状态` : '没有活动完整性根因' }
  ];
  return {
    schemaVersion,
    requiredSchemaVersion: 9,
    migration,
    checks,
    passed: checks.filter(row => row.pass).length,
    failed: checks.filter(row => !row.pass).length,
    criticalFailed: checks.filter(row => !row.pass && row.severity === 'critical').length,
    highFailed: checks.filter(row => !row.pass && row.severity === 'high').length,
    aliases: { total: blockedAliases.length, runtimeEligible: runtimeEligibleAliases.length },
    interruptedSync: Number(interruptedSync),
    modelBrain: { runtimeAvailable: modelBrainReady, hardEligibilityReady },
    activeAggregates
  };
}

function buildIssues(report, accounts, ai, backups, notifications, policy, secure, integrity = null, runtimeSignals = {}) {
  const issues = [];
  const add = (id, severity, title, detail, targetTab, actionLabel, extra = {}) => issues.push({ id, severity, title, detail, targetTab, actionLabel, ...extra });
  if (policy.emergencyStop) add('emergency-stop', 'critical', '全局写操作已停止', '所有平台发送与自动写入都被安全门禁阻断。', 'security', '检查安全控制');
  const safeMode = safeModeService.read();
  if (safeMode.active) add('safe-mode-active', 'high', '系统正在安全模式运行', safeMode.reason || '账号连接、发送、同步、AI自动任务和更新安装已暂停。', 'security', '打开恢复中心', { safeMode });
  const queueState = runtimeSignals.sendQueue || {};
  if (queueState.resumeBlocked === true || Number(queueState.outcomeUnknown || 0) > 0) {
    add('send-outcome-unknown-write-block', 'critical', '发送结果不确定，已阻止新增出站写入', `${Number(queueState.outcomeUnknown || 0)} 个任务无法确认平台是否已接受；必须完成对账后才能恢复发送。`, 'connections', '查看发送对账', { reasonCode: queueState.pausedReason || 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN', sendQueue: queueState });
  }
  const background = runtimeSignals.backgroundJobs || {};
  const backgroundCounts = background.counts || {};
  if (Number(backgroundCounts.FAILED_FINAL || 0) > 0) {
    const latest = Array.isArray(background.latestFinalFailures) ? background.latestFinalFailures[0] : null;
    add('background-jobs-final-failed', Number(backgroundCounts.FAILED_FINAL || 0) >= 10 ? 'critical' : 'high',
      `${Number(backgroundCounts.FAILED_FINAL || 0)} 个后台任务最终失败`,
      latest ? `${latest.jobType || '后台任务'} · ${latest.lastErrorCode || 'BACKGROUND_JOB_FAILED'} · ${latest.updatedAt || ''}` : '持久任务已耗尽重试预算，需要人工检查。',
      'diagnostics', '查看后台任务', { reasonCode: latest?.lastErrorCode || 'BACKGROUND_JOB_FAILED_FINAL', backgroundJobs: background });
  }
  if (Number(backgroundCounts.RETRY_WAIT || 0) > 0) {
    add('background-jobs-retry-wait', 'high', `${Number(backgroundCounts.RETRY_WAIT || 0)} 个后台任务等待重试`, '重试冷却和尝试次数已持久化；请检查平台连接及最近错误。', 'diagnostics', '查看后台任务', { reasonCode: 'BACKGROUND_JOB_RETRY_WAIT' });
  }
  if (background.consistency?.pass === false) {
    add('background-jobs-count-mismatch', 'critical', '后台任务状态数量无法对账', `状态汇总 ${Number(background.consistency.counted || 0)}，总数 ${Number(background.consistency.total || 0)}。`, 'diagnostics', '查看后台任务', { reasonCode: 'BACKGROUND_JOB_COUNT_MISMATCH' });
  }
  const supervisor = runtimeSignals.safetySupervisor || {};
  const safetyTriggers = Array.isArray(supervisor.activeTriggers) ? supervisor.activeTriggers : [];
  if (supervisor.globalWriteBlocked === true) {
    const reasons = supervisor.globalSafeModeReasons || [];
    add('automatic-global-safety-supervisor', 'critical', '共享基础设施触发全局安全模式', reasons.join('、') || '共享数据库、凭据、迁移或制品完整性异常。', 'security', '打开恢复中心', { reasonCode: reasons[0] || 'AUTOMATIC_GLOBAL_SAFETY_TRIGGER', safetySupervisor: supervisor });
  }
  for (const [accountId, issue] of Object.entries(supervisor.accounts || {})) {
    const title = issue.state === 'reauth-required' ? '账号需要重新授权' : '账号已隔离';
    add(`scoped-account-${accountId}`, 'high', title, `${issue.platform || '平台'} · ${accountId} · ${(issue.reasons || []).join('、')}`, 'connections', '处理该账号', { reasonCode: issue.reasons?.[0] || 'ACCOUNT_SCOPED_SAFETY_ISSUE', accountId, scopeType: 'account', blockedCapabilities: issue.blockedCapabilities || [] });
  }
  for (const [platform, issue] of Object.entries(supervisor.platforms || {})) {
    if (issue.state === 'attention' && Array.isArray(issue.affectedAccounts) && issue.affectedAccounts.length) continue;
    add(`scoped-platform-${platform}`, 'high', '平台能力降级', `${platform} · ${(issue.reasons || []).join('、')} · 受影响能力 ${(issue.blockedCapabilities || []).join('、') || '待诊断'}`, 'connections', '检查该平台', { reasonCode: issue.reasons?.[0] || 'PLATFORM_SCOPED_SAFETY_ISSUE', platform, scopeType: 'platform' });
  }
  for (const [capability, issue] of Object.entries(supervisor.capabilities || {})) {
    add(`scoped-capability-${capability}`, capability === 'send' ? 'critical' : 'high', '单项能力已暂停', `${capability} · ${(issue.reasons || []).join('、')}`, capability === 'ai-automation' ? 'ai' : 'diagnostics', '查看该能力', { reasonCode: issue.reasons?.[0] || 'CAPABILITY_SCOPED_SAFETY_ISSUE', capability, scopeType: 'capability' });
  }
  if (!secure.available && process.env.NODE_ENV !== 'test') add('secure-storage', 'critical', '系统安全存储不可用', '账号密钥无法可靠保存，请检查Windows凭据保护环境。', 'security', '查看凭据保护');
  for (const test of report.tests.filter(row => (row.status || (row.pass ? 'pass' : 'fail')) === 'fail')) add(`probe-${test.id}`, test.severity === 'critical' || test.group === 'security' || test.group === 'backup' ? 'critical' : 'high', test.name, test.detail, test.group === 'backup' ? 'data' : 'diagnostics', '立即处理', { reasonCode: test.reasonCode, evidence: test.evidence || {} });
  for (const failure of runtimeSignals.coreFailures || []) add(`recent-core-${failure.source}-${failure.code}-${failure.command || 'global'}`, failure.severity, failure.code || '核心操作失败', `${failure.command ? `${failure.command} · ` : ''}${failure.message || '最近核心操作失败'}`, 'diagnostics', '查看真实错误', { reasonCode: failure.code, at: failure.at, source: failure.source });
  if (integrity) {
    for (const check of integrity.checks.filter(row => !row.pass)) {
      const titles = {
        'schema-version': '数据库结构版本不兼容',
        'migration-ledger': '数据库迁移记录不完整',
        'sqlite-persistence': 'SQLite持久化配置不完整',
        'model-brain': 'Model Brain sealed runtime 不可用',
        'model-brain-hard-eligibility': 'Model Brain 硬资格能力不完整',
        'account-runtime-aliases': '旧账号别名仍可进入运行态',
        'sync-checkpoints': '存在未完成的同步检查点',
        'integrity-aggregates': '存在持续活动的完整性根因'
      };
      add(`integrity-${check.id}`, check.severity, titles[check.id] || check.id, check.detail, check.id.includes('model') ? 'ai' : check.id.includes('account') || check.id.includes('sync') ? 'connections' : 'data', '查看根因');
    }
    for (const aggregate of integrity.activeAggregates.slice(0, 12)) {
      add(`aggregate-${aggregate.fingerprint}`, aggregate.severity, aggregate.detail?.title || aggregate.code, aggregate.detail?.detail || `${aggregate.domain || 'system'} · ${aggregate.entityId || 'global'}`, 'diagnostics', '查看聚合记录', {
        occurrences: aggregate.occurrences,
        firstSeenAt: aggregate.firstSeenAt,
        lastSeenAt: aggregate.lastSeenAt,
        rootCauseCode: aggregate.code
      });
    }
  }
  for (const aggregate of runtimeSignals.logAggregates || []) {
    if (aggregate.state !== 'active' || aggregate.severity === 'info') continue;
    add(`runtime-log-${aggregate.fingerprint}`, aggregate.severity, aggregate.titleZh, `${aggregate.messageZh}${aggregate.occurrences > 1 ? ` · 本轮 ${aggregate.occurrences} 次` : ''}`, 'diagnostics', aggregate.actionZh || '查看诊断', {
      reasonCode: aggregate.code,
      occurrences: aggregate.occurrences,
      firstSeenAt: aggregate.firstSeenAt,
      lastSeenAt: aggregate.lastSeenAt,
      retryable: aggregate.retryable === true,
      domain: aggregate.domain
    });
  }
  if (accounts.abnormal > 0) add('account-abnormal', 'high', `${accounts.abnormal}个账号连接异常`, '登录凭据、网络或平台授权需要处理。', 'connections', '打开连接链路');
  if (accounts.total > 0 && accounts.connected === 0 && accounts.abnormal === 0) add('accounts-offline', 'medium', '当前没有在线账号', '系统可以运行，但暂时无法实时接收平台消息。', 'connections', '检查账号状态');
  if (!backups.latest) add('backup-missing', 'medium', '尚未创建完整恢复点', '建议立即创建一次包含账号认证、设置和AI资产的完整备份。', 'data', '立即备份');
  else if (backups.latest.valid === false) add('backup-invalid', 'critical', '最近备份完整性校验失败', backups.latest.verifyMessage, 'data', '重新验证');
  else if (backups.latestAgeHours > 36) add('backup-old', 'medium', '最近备份已超过36小时', `上次备份时间：${backups.latest.createdAt}`, 'data', '创建新备份');
  if (backups.pendingRestore) add('restore-pending', 'high', '存在等待重启执行的恢复任务', `目标恢复点：${backups.pendingRestore.backupName}`, 'data', '检查恢复计划');
  if (ai.modelBrain?.runtimeAvailable !== true) add('model-brain-unavailable', 'high', 'Model Brain / LiteLLM runtime unavailable', `sealed runtime health=${ai.modelBrain?.health || 'unavailable'}；不会回退到旧 provider client。`, 'ai', '检查 Model Brain', { reasonCode: 'MODEL_BRAIN_RUNTIME_UNAVAILABLE' });
  if (ai.count > 0 && ai.taskReadiness?.pass !== true) add('model-brain-hard-eligibility', 'high', 'Model Brain 硬资格能力不完整', `${Number(ai.taskReadiness?.missing?.length || 0)} 个 logical task 没有满足 privacy/local/cloud/modality/language/context/provider 约束的能力。`, 'ai', '检查硬资格', { reasonCode: 'MODEL_BRAIN_HARD_ELIGIBILITY_MISSING' });
  if (ai.count === 0) add('ai-empty', 'info', '尚未登记可用模型', '消息和账号功能不受影响，AI辅助能力暂不可用。', 'ai', '扫描模型');
  if (!notifications.enabled || notifications.paused) add('notification-paused', 'info', '消息提醒当前关闭或暂停', '后台消息仍会保存，但不会弹出桌面提醒。', 'notifications', '检查提醒设置');
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const unique = new Map();
  for (const issue of issues) if (!unique.has(issue.id)) unique.set(issue.id, issue);
  return [...unique.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}

function calculateHealth(report, accounts, ai, backups, policy, secure, integrity = null, issues = [], logProjection = null, backgroundJobs = null) {
  const healthAi = { ...ai, routingEligible: ai.modelBrain?.runtimeAvailable === true && ai.taskReadiness?.pass === true ? Math.max(1, Number(ai.verified || 0)) : 0 };
  return systemHealthAuthority.projectHealth({
    report,
    accounts,
    ai: healthAi,
    backups,
    policy,
    secure,
    integrity,
    issues,
    logProjection: logProjection || systemHealthAuthority.projectLogs([]),
    backgroundJobs: backgroundJobs || { counts: {}, total: 0 }
  });
}

function snapshot() {
  const policy = systemPolicy.read();
  const notifications = { ...notificationPolicy.read(), soundCatalog: notificationPolicy.soundCatalog() };
  const accounts = accountSummary();
  const ai = aiSummary();
  const backups = backupSummary();
  const report = diagnostics.snapshot();
  const recentLogs = logger.readRecent({ limit: 200 });
  const recentErrors = recentLogs.filter(row => row.level === 'error').slice(0, 40);
  const recentWarnings = recentLogs.filter(row => row.level === 'warn').slice(0, 60);
  const logProjection = systemHealthAuthority.projectLogs(recentLogs);
  const backgroundJobs = backgroundJobAuthority.snapshot({ limit: 1000 });
  const backgroundJobSummary = {
    total: backgroundJobs.total,
    counts: backgroundJobs.counts,
    byType: backgroundJobs.byType || {},
    unresolved: Number(backgroundJobs.unresolved || 0),
    latestFinalFailures: Array.isArray(backgroundJobs.latestFinalFailures) ? backgroundJobs.latestFinalFailures : [],
    consistency: backgroundJobs.consistency || { pass: true, counted: backgroundJobs.total, total: backgroundJobs.total }
  };
  const asyncOperations = asyncOperationLifecycleAuthority.snapshot({ limit: 500 });
  const productionDiagnosticSnapshot = productionDiagnostics.snapshot({ limit: 30 });
  const coreFailures = recentCoreFailures({ productionDiagnostics: productionDiagnosticSnapshot, recentErrors, diagnostics: report });
  const data = dataSummary(policy.privacyMode);
  const secure = { available: securityGuard.available, refs: securityGuard.credentials.listRefs().length };
  const messageState = report.messages || { count: 0, conversations: 0, pendingQueue: 0 };
  const runtime = runtimeRecovery.status();
  const sendQueueState = sendQueueSummary();
  const safetySupervisor = getRuntimeSafetySupervisor().snapshot();
  const performance = performanceSummary();
  const integrity = architectureIntegritySummary(report, accounts, ai, performance);
  const issues = buildIssues(report, accounts, ai, backups, notifications, policy, secure, integrity, { coreFailures, logAggregates: logProjection.active, sendQueue: sendQueueState, backgroundJobs: backgroundJobSummary, safetySupervisor });
  if (!performance.memory.withinSoftLimit) issues.unshift({ id: 'memory-soft-limit', severity: 'high', title: '进程内存超过软限制', detail: `当前RSS ${performance.memory.rssLabel}，软限制 ${performance.softMemoryLimitMb} MB。历史缓存会继续执行淘汰保护。`, targetTab: 'desktop', actionLabel: '检查历史缓存' });
  const availability = buildAvailability(report, coreFailures);
  const health = calculateHealth(report, accounts, ai, backups, policy, secure, integrity, issues, logProjection, backgroundJobSummary);
  const runtimeGovernance = verifyRuntimeGovernanceEvidence({ releaseIdentity: getBackendReleaseIdentity() });
  const releaseReadiness = buildReleaseReadiness({
    health,
    integrity,
    accounts,
    ai,
    coreFailures,
    sourcePreReviewPassed: runtimeGovernance.sourcePreReviewPassed === true,
    sourcePreReviewEvidence: runtimeGovernance,
    windowsUatAuthorized: runtimeGovernance.windowsUatAuthorized === true,
    windowsUatAuthorizationEvidence: runtimeGovernance,
    windowsFinalPassed: false
  });
  const history = healthHistory.record({ ...health, accountsConnected: accounts.connected, accountsAbnormal: accounts.abnormal, backupValid: backups.latest?.valid !== false, aiOnline: ai.modelBrain?.runtimeAvailable === true && ai.taskReadiness?.pass === true }).slice(0, 72);
  return {
    ok: true,
    releaseIdentity: diagnosticsBuildIdentity(getDiagnosticsReleaseIdentity({ releaseIdentity: getBackendReleaseIdentity() })),
    healthy: health.level === 'healthy',
    at: new Date().toISOString(),
    product: {
      name: CONFIG.product.publicName,
      nameEnglish: CONFIG.product.publicNameEnglish,
      version: CONFIG.product.publicVersion,
      updateName: CONFIG.product.updateName,
      updateVersion: CONFIG.product.updateVersion,
      build: CONFIG.product.build,
      buildId: CONFIG.product.buildId,
      internalProductId: CONFIG.product.internalProductId
    },
    health,
    availability,
    healthHistory: history,
    issues,
    integrity,
    releaseReadiness,
    runtimeGovernance,
    runtimeRecovery: runtime,
    sendQueue: sendQueueState,
    safeMode: safeModeService.snapshot(),
    safetySupervisor,
    productionDiagnostics: productionDiagnosticSnapshot,
    services: {
      backend: { state: 'online', pid: process.pid, uptimeSeconds: Math.round(process.uptime()) },
      database: report.tests.find(row => row.id === 'data-store') || null,
      eventBus: report.tests.find(row => row.id === 'event-bus') || null,
      backup: report.tests.find(row => row.id === 'backup-latest') || null,
      accounts: { total: accounts.total, connected: accounts.connected, abnormal: accounts.abnormal },
      ai
    },
    topology: buildTopology(report, accounts, ai, backups, notifications, policy),
    accounts,
    ai,
    data,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: policy.privacyMode ? '已隐藏' : os.hostname(),
      node: process.versions.node,
      cpuCount: os.cpus()?.length || 0,
      memoryTotal: os.totalmem(),
      memoryFree: os.freemem(),
      memoryTotalLabel: bytes(os.totalmem()),
      memoryFreeLabel: bytes(os.freemem()),
      dataRoot: maskPath(PATHS.root, policy.privacyMode),
      logRoot: maskPath(PATHS.logs, policy.privacyMode),
      dataBytes: data.totalBytes,
      dataSizeLabel: data.totalSizeLabel
    },
    messages: {
      count: Number(messageState.count || 0),
      conversations: Number(messageState.conversations || 0),
      pendingQueue: Number(messageState.pendingQueue || 0),
      outcomeUnknown: Number(sendQueueState.outcomeUnknown || 0),
      queuePausedReason: sendQueueState.pausedReason || ''
    },
    performance,
    notifications,
    policy,
    security: {
      secureStorageAvailable: secure.available,
      credentialRefs: secure.refs,
      legacyAuthChannelsAllowed: false,
      selfApprovalAllowed: false,
      aiAutomationBlocked: safetySupervisor.aiAutomationBlocked === true,
      aiIsolationReasons: safetySupervisor.aiIsolationReasons || [],
      writeGate: policy.emergencyStop || safeModeService.isActive() || sendQueueState.writeBlocked || safetySupervisor.globalWriteBlocked ? 'blocked' : 'open',
      writeGateReasons: [
        policy.emergencyStop ? 'GLOBAL_EMERGENCY_STOP' : '',
        safeModeService.isActive() ? 'SAFE_MODE_ACTIVE' : '',
        sendQueueState.writeBlocked ? (sendQueueState.pausedReason || 'SEND_QUEUE_WRITE_BLOCKED') : '',
        safetySupervisor.globalWriteBlocked ? (safetySupervisor.globalSafeModeReasons?.[0] || 'AUTOMATIC_SAFETY_TRIGGER') : ''
      ].filter(Boolean)
    },
    backups,
    featureFlags: featureFlags.read(),
    diagnostics: report,
    logProjection,
    backgroundJobs: backgroundJobSummary,
    asyncOperations,
    recentErrors,
    recentWarnings
  };
}

function exportBundle() {
  const data = snapshot();
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    product: data.product,
    health: data.health,
    healthHistory: data.healthHistory,
    issues: data.issues,
    integrity: data.integrity,
    releaseReadiness: data.releaseReadiness,
    services: data.services,
    runtimeRecovery: data.runtimeRecovery,
    sendQueue: data.sendQueue,
    safeMode: data.safeMode,
    safetySupervisor: data.safetySupervisor,
    productionDiagnostics: data.productionDiagnostics,
    topology: data.topology,
    accounts: {
      summary: { total: data.accounts.total, connected: data.accounts.connected, abnormal: data.accounts.abnormal, paused: data.accounts.paused, unread: data.accounts.unread, platforms: data.accounts.platforms },
      rows: data.accounts.rows.map(row => ({ id: row.id, platform: row.platform, state: row.state, health: row.health, credentialReady: row.credentialReady, lastSyncAt: row.lastSyncAt, lastError: row.lastError }))
    },
    ai: data.ai,
    data: data.data,
    environment: data.environment,
    performance: data.performance,
    notifications: {
      enabled: data.notifications.enabled,
      desktopEnabled: data.notifications.desktopEnabled,
      soundEnabled: data.notifications.soundEnabled,
      soundVolume: data.notifications.soundVolume,
      incomingSoundEnabled: data.notifications.incomingSoundEnabled,
      outgoingSoundEnabled: data.notifications.outgoingSoundEnabled,
      failureSoundEnabled: data.notifications.failureSoundEnabled,
      presenceSoundEnabled: data.notifications.presenceSoundEnabled,
      incomingSoundPattern: data.notifications.incomingSoundPattern,
      outgoingSoundPattern: data.notifications.outgoingSoundPattern,
      failureSoundPattern: data.notifications.failureSoundPattern,
      presenceOnlineSoundPattern: data.notifications.presenceOnlineSoundPattern,
      presenceOfflineSoundPattern: data.notifications.presenceOfflineSoundPattern,
      soundPatternCount: data.notifications.soundCatalog?.patterns?.length || 0,
      paused: data.notifications.paused,
      dnd: data.notifications.dnd,
      privacy: data.notifications.privacy
    },
    policy: data.policy,
    security: data.security,
    backups: data.backups,
    diagnostics: data.diagnostics,
    logProjection: data.logProjection,
    backgroundJobs: data.backgroundJobs,
    recentErrors: data.recentErrors,
    recentWarnings: data.recentWarnings
  };
}

module.exports = { snapshot, exportBundle, bytes, directorySize, maskPath, buildIssues, calculateHealth, architectureIntegritySummary, clearDirectoryStatsCache: () => DIRECTORY_CACHE.clear() };
