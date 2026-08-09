'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CONFIG, PATHS } = require('../config');
const diagnosticsRepository = require('../repositories/diagnosticsRepository');
const modelStatus = require('./modelStatusService');
const backup = require('./backupService');
const accountManager = require('./accountManager');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const notificationPolicy = require('./notificationPolicy');
const systemPolicy = require('./systemPolicy');
const eventBus = require('./eventBus');
const safeModeService = require('./safeModeService');
const productionDiagnostics = require('./productionDiagnosticsService');
const { accountReadiness } = require('./diagnosticReadiness');
const { diagnosticResult, summarizeDiagnosticResults } = require('./diagnosticResult');
const platformProductionReadiness = require('./platformProductionReadinessAuthority');
const sendQueue = require('./sendQueueService');
const { getRuntimeSafetySupervisor } = require('./runtimeSafetySupervisor');
const modelExecutionEvidenceStore = require('./modelExecutionEvidenceStore');
const fix6mArchitectureDiagnostics = require('./fix6mArchitectureDiagnostics');

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(file, 'ok');
    fs.unlinkSync(file);
    return true;
  } catch (_) { return false; }
}

function sqliteState() {
  try {
    return { ok: true, ...diagnosticsRepository.sqliteCounts() };
  } catch (error) {
    return { ok: false, error: error.message, accounts: 0, contacts: 0, conversations: 0, messages: 0, customerProfiles: 0, relationshipInsights: 0, queue: 0 };
  }
}


function openRouterReadiness(modelState = {}) {
  const state = modelState.openRouter && typeof modelState.openRouter === 'object' ? modelState.openRouter : {};
  const configured = state.credentialConfigured === true;
  const authenticationStatus = String(state.authenticationStatus || 'unknown');
  const catalogStatus = String(state.catalogStatus || 'unknown');
  const onboardingSmokeStatus = String(state.onboardingSmokeStatus || 'not-run');
  const smokeResults = Array.isArray(state.onboardingSmokeResults) ? state.onboardingSmokeResults : [];
  const authenticated = authenticationStatus === 'passed';
  const catalogReady = ['passed', 'ready', 'success'].includes(catalogStatus);
  const smokePassed = onboardingSmokeStatus === 'passed' || smokeResults.some(row => row?.pass === true);
  return {
    configured,
    authenticated,
    catalogReady,
    smokePassed,
    ready: configured && authenticated && catalogReady,
    authenticationStatus,
    catalogStatus,
    onboardingSmokeStatus,
    modelCount: Number(state.modelCount || state.catalogCount || 0),
    registeredModelCount: Number(state.registeredModelCount || 0),
    smokeResults: smokeResults.map(row => ({
      modelId: String(row?.modelId || ''),
      modelSlug: String(row?.modelSlug || row?.returnedModel || ''),
      pass: row?.pass === true,
      requestId: String(row?.requestId || ''),
      code: String(row?.code || ''),
      message: String(row?.message || '')
    }))
  };
}

function candidateOperationReadiness(operationTrace = {}) {
  const active = (operationTrace.activeOperations || []).filter(row => row?.command === 'ai.reply.generate');
  const recent = (operationTrace.recent || []).filter(row => row?.command === 'ai.reply.generate').slice(0, 20);
  const latest = recent[0] || active[0] || null;
  const failures = recent.filter(row => row?.type === 'operation-failed');
  const latestFailed = latest?.type === 'operation-failed';
  const latestSucceeded = latest?.type === 'operation-completed';
  return { active, recent, latest, failures, latestFailed, latestSucceeded };
}


function snapshot() {
  const modelState = modelStatus.read();
  const db = sqliteState();
  const accountState = accountManager.list();
  const notifications = notificationPolicy.read();
  const policy = systemPolicy.read();
  const backups = backup.listBackups();
  const latestBackup = backups[0];
  const latestVerification = latestBackup ? backup.verifyBackup(latestBackup.name) : null;
  const pending = backup.pendingRestore();
  const safeMode = safeModeService.snapshot();
  const safetySupervisor = getRuntimeSafetySupervisor().snapshot();
  let sendQueueState;
  try { sendQueueState = sendQueue.status(); }
  catch (error) { sendQueueState = { paused: true, pausedReason: 'SEND_QUEUE_STATUS_UNAVAILABLE', outcomeUnknown: 0, resumeBlocked: true, error: error.message || String(error) }; }
  const operationTrace = productionDiagnostics.snapshot({ limit: 120 });
  const { activeAccounts, onboardingAccounts, transientAccounts, unreadyAccounts, operationFailures: accountOperationFailures } = accountReadiness(accountState, operationTrace.recent || []);
  const platformReadiness = platformProductionReadiness.evaluate(accountState);
  const modelBrainReadiness = {
    count: Number(modelState.summary?.total || modelState.models?.length || 0),
    verified: Number(modelState.summary?.verified || 0),
    local: Number(modelState.summary?.local || 0),
    cloud: Number(modelState.summary?.cloud || 0),
    modelBrain: modelState.modelBrain || {},
    taskReadiness: modelState.taskReadiness || { pass: false, tasks: [], missing: [] }
  };
  const aiTaskReadiness = modelBrainReadiness.taskReadiness;
  const openRouterReadinessState = openRouterReadiness(modelState);
  const candidateOperations = candidateOperationReadiness(operationTrace);
  const recentModelExecutions = modelExecutionEvidenceStore.readRecent(20);
  const latestModelExecution = recentModelExecutions[0] || null;
  const latestModelExecutionFailed = latestModelExecution?.terminated === true;
  const fix6mArchitectureState = fix6mArchitectureDiagnostics.snapshot();
  const backupRoots = Object.keys(backup.ROOTS || {});
  const sqliteExists = fs.existsSync(PATHS.sqlite);
  const rawTests = [
    { id: 'data-root', group: 'storage', severity: 'critical', name: '永久数据目录可写', pass: writable(PATHS.root), detail: PATHS.root },
    { id: 'sqlite-store', group: 'storage', severity: 'critical', name: 'SQLite核心数据库可读写', pass: db.ok && sqliteExists && writable(PATHS.db), detail: db.ok ? `${db.conversations} 个会话 · ${db.messages} 条消息` : db.error },
    { id: 'logs', group: 'storage', severity: 'medium', name: '日志目录可写', pass: writable(PATHS.logs), detail: PATHS.logs },
    { id: 'secure-root', group: 'security', severity: 'critical', name: '加密凭据目录可写', pass: writable(PATHS.secure), detail: '系统加密文件位于永久数据根并纳入备份' },
    { id: 'whatsapp-auth', group: 'security', severity: 'high', name: 'WhatsApp认证目录可用', pass: writable(PATHS.whatsappAuth), detail: PATHS.whatsappAuth },
    { id: 'ai-assets', group: 'ai', severity: 'medium', name: 'AI成果目录可用', pass: writable(PATHS.aiAssets), detail: '提示词、知识库与轻量适配器可纳入备份' },
    { id: 'models-store', group: 'ai', severity: 'medium', name: '模型注册表可读', pass: Array.isArray(modelState.models), detail: `${modelState.models?.length || 0} 个 catalog 模型 · local ${Number(modelState.summary?.local || 0)} · cloud ${Number(modelState.summary?.cloud || 0)} · verified ${Number(modelState.summary?.verified || 0)}` },
    { id: 'fix6m-architecture-authorities', group: 'architecture', severity: 'critical', name: '通信、任务、关系与学习公共权威', pass: fix6mArchitectureState.pass, status: fix6mArchitectureState.status, detail: `停滞任务 ${Number(fix6mArchitectureState.counts?.stalledExecutions || 0)} · 媒体失败 ${Number(fix6mArchitectureState.counts?.retryableMediaFailures || 0) + Number(fix6mArchitectureState.counts?.permanentMediaFailures || 0)} · 同步缺口 ${Number(fix6mArchitectureState.counts?.openSyncGaps || 0)} · 不确定发送 ${Number(fix6mArchitectureState.counts?.uncertainDeliveries || 0)} · 影子不一致 ${Number(fix6mArchitectureState.shadowGate?.mismatches || 0)}`, reasonCode: fix6mArchitectureState.reasonCode, evidence: fix6mArchitectureState },
    {
      id: 'openrouter-runtime-readiness',
      group: 'ai',
      severity: 'medium',
      name: 'OpenRouter catalog / credential readiness',
      pass: openRouterReadinessState.ready,
      status: !openRouterReadinessState.configured ? 'skipped' : openRouterReadinessState.ready ? 'pass' : 'warning',
      detail: !openRouterReadinessState.configured
        ? '尚未配置 OpenRouter；Model Brain 可继续使用其他合格 provider'
        : `${openRouterReadinessState.authenticationStatus} · catalog ${openRouterReadinessState.catalogStatus} · ${openRouterReadinessState.modelCount} models · logical smoke ${openRouterReadinessState.onboardingSmokeStatus}`,
      evidence: openRouterReadinessState
    },
    {
      id: 'model-brain-runtime',
      group: 'ai',
      severity: 'high',
      name: 'Model Brain / LiteLLM 运行状态',
      pass: modelBrainReadiness.modelBrain.runtimeAvailable === true,
      status: modelBrainReadiness.modelBrain.health === 'healthy' ? 'pass' : modelBrainReadiness.modelBrain.health === 'degraded' ? 'warning' : 'fail',
      detail: `${modelBrainReadiness.modelBrain.health || 'unavailable'} · ${modelBrainReadiness.modelBrain.litellm || 'LiteLLM v1.95.0'} · ${modelBrainReadiness.modelBrain.complexityRouter || 'ComplexityRouter'} · strict tags ${modelBrainReadiness.modelBrain.strictTagFiltering !== false ? 'AND' : 'off'}`,
      evidence: modelBrainReadiness.modelBrain
    },
    {
      id: 'ai-candidate-operation-observability',
      group: 'ai',
      severity: 'high',
      name: '候选生成任务可观测',
      pass: !candidateOperations.active.length && !candidateOperations.latestFailed,
      status: candidateOperations.active.length ? 'warning' : candidateOperations.latestFailed ? 'fail' : 'pass',
      detail: candidateOperations.active.length
        ? `${candidateOperations.active.length} 个候选生成任务正在运行，系统已记录真实操作ID与阶段`
        : candidateOperations.latest
          ? `${candidateOperations.latest.type === 'operation-completed' ? '最近候选生成已完成' : candidateOperations.latest.type === 'operation-failed' ? '最近候选生成失败' : '最近候选任务已记录'} · ${candidateOperations.latest.code || candidateOperations.latest.lifecycleState || ''}`
          : '尚无候选生成尝试；界面不得显示无法追踪的永久等待状态',
      reasonCode: candidateOperations.active.length
        ? 'AI_REPLY_GENERATION_IN_PROGRESS'
        : candidateOperations.latestFailed
          ? String(candidateOperations.latest?.code || 'AI_REPLY_GENERATION_FAILED')
          : candidateOperations.latest
            ? 'AI_REPLY_GENERATION_OBSERVABLE'
            : 'AI_REPLY_GENERATION_NOT_ATTEMPTED',
      evidence: {
        active: candidateOperations.active.map(row => ({ operationId: row.operationId, lifecycleState: row.lifecycleState, startedAt: row.startedAt })),
        recent: candidateOperations.recent.slice(0, 5).map(row => ({ operationId: row.operationId, type: row.type, code: row.code || '', lifecycleState: row.lifecycleState || '', completedAt: row.completedAt || row.startedAt || '' }))
      }
    },
    { id: 'message-store', group: 'messages', severity: 'critical', name: '消息存储结构完整', pass: db.ok, detail: `${db.messages} 条消息 · ${db.conversations} 个会话 · ${db.queue} 个待发送任务` },
    { id: 'backup-directory', group: 'backup', severity: 'critical', name: '备份目录可写', pass: writable(PATHS.backups), detail: `${backups.length} 个恢复点` },
    { id: 'backup-coverage', group: 'backup', severity: 'high', name: '完整备份覆盖范围', pass: ['store', 'models', 'whatsappAuth', 'secure', 'aiAssets'].every(root => backupRoots.includes(root)), detail: backupRoots.join('、') },
    { id: 'backup-latest', group: 'backup', severity: 'high', name: '最近备份完整性', pass: latestBackup ? Boolean(latestVerification?.ok) : true, detail: latestBackup ? (latestVerification?.message || latestBackup.name) : '尚无备份，不视为运行故障' },
    { id: 'restore-engine', group: 'backup', severity: 'critical', name: '安全恢复执行器', pass: !pending || ['verified-awaiting-restart', 'failed-awaiting-review'].includes(pending.state), detail: pending ? `${pending.state} · ${pending.backupName || ''}` : '当前没有待执行恢复任务' },
    { id: 'account-center', group: 'accounts', severity: 'critical', name: '统一账号状态模型', pass: Array.isArray(accountState.accounts) && Boolean(accountState.summary), detail: `${accountState.accounts.length} 个账号 · ${accountState.summary.connected} 个已连接` },
    { id: 'account-runtime-readiness', group: 'accounts', severity: 'critical', name: '账号真实连接与凭据状态', pass: unreadyAccounts.length === 0, detail: unreadyAccounts.length ? `${unreadyAccounts.length} 个已配置账号存在阻断：${unreadyAccounts.map(row => `${row.platform}:${row.state}:${row.credentialReady ? 'credential-ready' : 'credential-missing'}`).join(' · ')}` : (activeAccounts.length ? `已配置账号可用；${onboardingAccounts.length} 个账号仍在登录或未配置阶段` : (onboardingAccounts.length ? `${onboardingAccounts.length} 个账号尚未完成配置，不视为系统故障` : '尚无活动账号')) },
    { id: 'account-operation-health', group: 'accounts', severity: 'critical', name: '账号核心操作最近无失败', pass: accountOperationFailures.length === 0, detail: accountOperationFailures.length ? `${accountOperationFailures.length} 个最近失败：${accountOperationFailures.slice(0, 3).map(row => `${row.command}:${row.code || 'ERROR'}`).join(' · ')}` : 'connect/reconnect/logout 最近无失败记录' },
    { id: 'account-adapters', group: 'accounts', severity: 'high', name: '多平台适配层', pass: ['whatsapp', 'telegram', 'facebook'].every(platform => accountState.capabilityMatrix?.[platform]), detail: '平台能力矩阵只显示当前已接入能力' },
    ...['facebook', 'whatsapp', 'telegram'].map(platform => {
      const projection = platformReadiness.platforms[platform];
      const labels = { facebook: 'Facebook生产链', whatsapp: 'WhatsApp生产链', telegram: 'Telegram生产链' };
      const status = projection.status === 'not-configured' ? 'skipped'
        : projection.status === 'blocked' ? 'fail'
          : ['degraded', 'onboarding', 'ready-for-real-uat'].includes(projection.status) ? 'warning'
            : 'pass';
      const detail = projection.status === 'not-configured'
        ? '未配置该平台，不影响其他平台和系统健康'
        : projection.status === 'ready-for-real-uat'
          ? '自动运行门禁已通过，仍需真实账号与Windows证据'
          : projection.status === 'onboarding'
            ? '账号仍在登录或配置阶段，不判定为系统故障'
            : projection.status === 'degraded'
              ? '基础消息链可用，但存在能力降级或待补偿项'
              : projection.status === 'blocked'
                ? '至少一个已配置账号的核心消息链被阻断'
                : '自动运行门禁已通过';
      return { id: `platform-${platform}-production-readiness`, group: 'accounts', severity: 'high', name: labels[platform], pass: status === 'pass', status, detail, reasonCode: `PLATFORM_${platform.toUpperCase()}_${projection.status.toUpperCase().replace(/-/g, '_')}`, evidence: projection };
    }),
    { id: 'ai-hard-eligibility', group: 'ai', severity: 'high', name: 'Model Brain 硬资格目录', pass: modelBrainReadiness.count === 0 || modelBrainReadiness.verified > 0, status: modelBrainReadiness.count === 0 ? 'skipped' : modelBrainReadiness.verified > 0 ? 'pass' : 'warning', detail: modelBrainReadiness.count === 0 ? '尚未登记模型' : `catalog ${modelBrainReadiness.count} · verified ${modelBrainReadiness.verified} · local ${modelBrainReadiness.local} · cloud ${modelBrainReadiness.cloud} · privacy/modality/language/context/provider`, evidence: modelBrainReadiness },
    { id: 'ai-core-task-readiness', group: 'ai', severity: 'high', name: 'Model Brain 核心任务硬资格', pass: aiTaskReadiness.pass === true, detail: modelBrainReadiness.count === 0 ? '尚未登记模型' : aiTaskReadiness.pass ? '核心 logical task 均存在合格模型' : `${(aiTaskReadiness.missing || []).length} 个 logical task 缺少合格模型` },
    { id: 'ai-domain-isolation', group: 'ai', severity: 'high', name: 'AI自动任务域隔离', pass: safetySupervisor.aiAutomationBlocked !== true, status: safetySupervisor.aiAutomationBlocked ? 'warning' : 'pass', detail: safetySupervisor.aiAutomationBlocked ? `AI自动任务已隔离：${(safetySupervisor.aiIsolationReasons || []).join('、')}` : 'AI自动任务域未隔离', evidence: safetySupervisor.domainIsolation || {} },
    { id: 'credential-vault', group: 'security', severity: 'critical', name: '系统凭据隔离桥', pass: securityGuard.available || process.env.NODE_ENV === 'test', detail: securityGuard.available ? '敏感凭据由Electron safeStorage加密后持久化' : '独立服务模式不持久化明文凭据' },
    { id: 'notification-config', group: 'notification', severity: 'medium', name: '通知设置有效', pass: typeof notifications.enabled === 'boolean' && typeof notifications.soundEnabled === 'boolean' && notifications.soundVolume >= 0 && notifications.soundVolume <= 1, detail: `桌面 ${notifications.desktopEnabled ? '开启' : '关闭'} · 声音 ${notifications.soundEnabled ? Math.round(notifications.soundVolume * 100) + '%' : '关闭'}` },
    { id: 'write-gate', group: 'security', severity: 'critical', name: '全局写操作门禁', pass: policy.emergencyStop === true || safeMode.active === true || sendQueueState.resumeBlocked === true ? true : typeof policy.emergencyStop === 'boolean', status: policy.emergencyStop === true || safeMode.active === true || sendQueueState.resumeBlocked === true ? 'warning' : 'pass', detail: policy.emergencyStop ? '紧急停止已开启，新增写操作已阻止' : safeMode.active ? '安全模式已开启，自动写操作已阻止' : sendQueueState.resumeBlocked ? `发送结果不确定，队列写门禁已阻止新增出站：${sendQueueState.pausedReason || 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN'}` : '正常开放', evidence: { emergencyStop: policy.emergencyStop === true, safeMode: safeMode.active === true, sendQueue: sendQueueState } },
    { id: 'event-bus', group: 'runtime', severity: 'high', name: '系统事件总线', pass: eventBus.listenerCount('event') > 0, detail: `${eventBus.listenerCount('event')} 个实时事件订阅` },
    { id: 'safe-mode-state', group: 'recovery', severity: 'high', name: '安全模式与启动恢复状态', pass: safeMode.active !== true, detail: safeMode.active ? `${safeMode.reason || '安全模式已启用'} · ${safeMode.consecutiveBootFailures} 次连续启动失败` : '正常模式，启动恢复账本可用' },
    { id: 'runtime', group: 'runtime', severity: 'critical', name: '运行环境版本', pass: Number(process.versions.node.split('.')[0]) >= 20, detail: `Node ${process.versions.node} · ${os.platform()} ${os.release()} · ${os.arch()}` }
  ];
  const tests = rawTests.map(test => {
    let status = test.status || (test.pass ? 'pass' : 'fail');
    let reasonCode = test.reasonCode || (test.pass ? `${test.id.toUpperCase().replace(/-/g, '_')}_PASSED` : `${test.id.toUpperCase().replace(/-/g, '_')}_FAILED`);
    let evidence = test.evidence && typeof test.evidence === 'object' ? test.evidence : {};
    if (test.id === 'backup-latest' && !latestBackup) { status = 'skipped'; reasonCode = 'NO_BACKUP_NOT_APPLICABLE'; }
    if (test.id === 'account-runtime-readiness') {
      evidence = {
        activeAccounts: activeAccounts.length,
        onboardingAccounts: onboardingAccounts.map(row => ({ id: row.id, platform: row.platform, state: row.state, credentialReady: row.credentialReady })),
        transientAccounts: transientAccounts.map(row => ({ id: row.id, platform: row.platform, state: row.state, credentialReady: row.credentialReady })),
        unreadyAccounts: unreadyAccounts.map(row => ({ id: row.id, platform: row.platform, state: row.state, credentialReady: row.credentialReady }))
      };
      if (activeAccounts.length === 0) { status = 'skipped'; reasonCode = onboardingAccounts.length ? 'ACCOUNTS_ONBOARDING_NOT_FAILURE' : 'NO_ACTIVE_ACCOUNT_NOT_APPLICABLE'; }
      else if (unreadyAccounts.length) reasonCode = 'ACCOUNT_RUNTIME_NOT_READY';
      else if (transientAccounts.length) { status = 'warning'; reasonCode = 'ACCOUNT_RUNTIME_CONNECTING'; }
      else reasonCode = 'ACCOUNT_RUNTIME_READY';
    }
    if (test.id === 'account-operation-health') {
      evidence = { failures: accountOperationFailures.slice(0, 10).map(row => ({ command: row.command, code: row.code || '', at: row.completedAt || row.at || '' })) };
      reasonCode = accountOperationFailures[0]?.code || (test.pass ? 'ACCOUNT_OPERATIONS_HEALTHY' : 'ACCOUNT_OPERATION_FAILED');
    }
    if (test.id === 'ai-hard-eligibility') {
      evidence = modelBrainReadiness;
      if (modelBrainReadiness.count === 0) { status = 'skipped'; reasonCode = 'NO_AI_MODEL_NOT_APPLICABLE'; }
      else if (modelBrainReadiness.verified === 0) { status = 'warning'; reasonCode = 'MODEL_BRAIN_NO_VERIFIED_MODEL'; }
      else reasonCode = 'MODEL_BRAIN_HARD_ELIGIBILITY_READY';
    }
    if (test.id === 'ai-core-task-readiness') {
      evidence = {
        tasks: aiTaskReadiness.tasks || [],
        missing: aiTaskReadiness.missing || [],
        authority: 'Model Brain / LiteLLM'
      };
      if (modelBrainReadiness.count === 0) { status = 'skipped'; reasonCode = 'NO_AI_MODEL_NOT_APPLICABLE'; }
      else if (!aiTaskReadiness.pass) reasonCode = 'MODEL_BRAIN_CORE_TASKS_INCOMPLETE';
      else reasonCode = 'MODEL_BRAIN_CORE_TASKS_READY';
    }
    if (test.id === 'sqlite-store' && !test.pass) reasonCode = 'ERR_SQLITE_ERROR';
    return diagnosticResult({ ...test, status, reasonCode, evidence });
  });
  const summary = summarizeDiagnosticResults(tests);
  return {
    product: CONFIG.product,
    scope: 'r32-system-center-real-probes',
    at: new Date().toISOString(),
    tests,
    pass: summary.pass,
    fail: summary.fail,
    warning: summary.warning,
    skipped: summary.skipped,
    executed: summary.executed,
    models: {
      online: modelState.catalog?.ollamaOnline === true,
      count: modelBrainReadiness.count,
      verified: modelBrainReadiness.verified,
      local: modelBrainReadiness.local,
      cloud: modelBrainReadiness.cloud,
      source: modelState.source,
      modelBrain: modelBrainReadiness.modelBrain,
      taskReadiness: aiTaskReadiness,
      openRouter: openRouterReadinessState,
      executionEvidence: modelBrainReadiness.modelBrain.lastEvidence || null,
      candidateOperations: {
        active: candidateOperations.active.length,
        recent: candidateOperations.recent.slice(0, 10).map(row => ({ operationId: row.operationId, type: row.type, code: row.code || '', lifecycleState: row.lifecycleState || '', at: row.completedAt || row.startedAt || '' }))
      }
    },
    messages: { count: db.messages, conversations: db.conversations, pendingQueue: db.queue },
    platformReadiness,
    accounts: {
      summary: accountState.summary,
      rows: accountState.accounts.map(row => ({ id: row.id, platform: row.platform, state: row.state, health: row.health, credentialReady: row.credentialReady }))
    },
    memory: process.memoryUsage(),
    policy,
    notifications,
    backupRoots,
    pendingRestore: pending,
    safeMode,
    runtimeSafetySupervisor: safetySupervisor,
    fix6mArchitecture: fix6mArchitectureState
  };
}

module.exports = { snapshot, writable, sqliteState, openRouterReadiness, candidateOperationReadiness };
