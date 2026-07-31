'use strict';

const DEFAULT_ACTIVE_WINDOW_MS = Math.max(60000, Number(process.env.YANCE_HEALTH_ACTIVE_WINDOW_MS || 20 * 60 * 1000));
const DEFAULT_RECENT_WINDOW_MS = Math.max(DEFAULT_ACTIVE_WINDOW_MS, Number(process.env.YANCE_HEALTH_RECENT_WINDOW_MS || 24 * 60 * 60 * 1000));

const STATE = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  RECOVERING: 'recovering',
  UNKNOWN: 'unknown'
});

const LEVEL = Object.freeze({
  healthy: 'healthy',
  degraded: 'attention',
  recovering: 'attention',
  blocked: 'critical',
  unknown: 'attention'
});

const SEVERITY_WEIGHT = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, info: 0 });
const SEVERITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, info: 4 });

const CATALOG = Object.freeze([
  {
    match: row => row.channel === 'accounts' && row.message === 'avatar-sync-failed',
    code: 'ACCOUNT_AVATAR_SYNC_FAILED',
    domain: 'accounts',
    severity: 'medium',
    titleZh: '头像同步未完成',
    messageZh: '部分账号或联系人头像未能在本轮同步。系统会保留已验证缓存，并按失败原因决定是否重试。',
    actionZh: '检查账号授权、头像来源和缓存状态',
    retryable: row => !['http-403', 'http-404', 'invalid-image', 'avatar-too-large'].includes(String(row.detail?.errorCode || ''))
  },
  {
    match: row => row.channel === 'whatsapp' && row.message === 'avatar-sync-batch-failed',
    code: 'ACCOUNT_AVATAR_BATCH_FAILED',
    domain: 'accounts',
    severity: 'medium',
    titleZh: '头像批量同步未完成',
    messageZh: '账号头像批量同步任务未完成，但不会清除已验证头像。',
    actionZh: '查看账号连接与头像同步任务',
    retryable: true
  },
  {
    match: row => row.channel === 'media' && row.message === 'materialize-failed',
    code: 'MEDIA_MATERIALIZE_FAILED',
    domain: 'media',
    severity: 'medium',
    titleZh: '历史媒体恢复未完成',
    messageZh: '部分历史图片、语音、贴纸或文件未能恢复到本地缓存。文本消息和已成功缓存的媒体不受影响。',
    actionZh: '检查媒体来源、网络和重试状态',
    retryable: row => row.detail?.retryable !== false
  },
  {
    match: row => row.channel === 'server' && row.message === 'request-failed',
    code: row => String(row.detail?.code || 'SERVER_REQUEST_FAILED'),
    domain: 'server',
    severity: row => /SQLITE|CREDENTIAL|ACCOUNT_.*FAILED|GLOBAL_WRITE_BLOCKED/iu.test(String(row.detail?.code || '')) ? 'critical' : 'high',
    titleZh: '服务请求执行失败',
    messageZh: row => requestFailureMessage(row.detail?.code),
    actionZh: '查看错误码、受影响功能和重试条件',
    retryable: row => row.detail?.retryable !== false
  },
  {
    match: row => row.channel === 'server' && row.message === 'request-rejected',
    code: row => String(row.detail?.code || 'SERVER_REQUEST_REJECTED'),
    domain: 'server',
    severity: 'low',
    titleZh: '请求被安全或业务规则拒绝',
    messageZh: '请求没有执行写操作。请根据错误码检查输入、身份作用域或当前安全门禁。',
    actionZh: '核对请求条件后重试',
    retryable: false
  },
  {
    match: row => row.channel === 'media' && row.message === 'baileys-download-error',
    code: 'MEDIA_DOWNLOAD_PROVIDER_ERROR',
    domain: 'media',
    severity: 'medium',
    titleZh: '媒体下载组件报告错误',
    messageZh: '媒体下载组件返回错误，系统将保留消息记录并按可恢复性决定是否重试。',
    actionZh: '查看媒体任务和平台连接',
    retryable: true
  }
]);

function clean(value, max = 600) {
  return String(value == null ? '' : value).replace(/\s+/gu, ' ').trim().slice(0, max);
}

function requestFailureMessage(code) {
  const value = String(code || '').toUpperCase();
  if (/SQLITE/u.test(value)) return '本地数据库操作失败，相关写入已停止。本次错误会阻断健康状态，直到真实探针或后续成功操作确认恢复。';
  if (/CREDENTIAL|AUTH|TOKEN/u.test(value)) return '账号凭据或授权校验失败，相关账号功能可能受限。';
  if (/MODEL|AI_/u.test(value)) return 'AI 模型请求失败。消息和账号基础能力仍可运行，AI 能力按路由状态降级。';
  if (/NOT_FOUND/u.test(value)) return '请求的业务对象不存在或已经被移除，没有执行写入。';
  return '本地服务未能完成请求。请查看错误码、受影响功能及最近一次成功状态。';
}

function resolveCatalog(row) {
  const found = CATALOG.find(entry => {
    try { return entry.match(row); } catch (_) { return false; }
  });
  if (found) return found;
  const level = row.level === 'error' ? 'high' : row.level === 'warn' ? 'medium' : 'info';
  return {
    code: clean(row.detail?.code || row.detail?.errorCode || row.detail?.reasonCode || row.message || 'RUNTIME_LOG', 120).toUpperCase(),
    domain: clean(row.channel || 'system', 80).toLowerCase(),
    severity: level,
    titleZh: row.level === 'error' ? '运行错误' : row.level === 'warn' ? '运行警告' : '运行记录',
    messageZh: row.level === 'error' ? '运行过程中出现错误，请根据错误码和技术详情判断影响范围。' : '运行过程中出现需要关注的状态。',
    actionZh: '查看技术详情和最近状态',
    retryable: false
  };
}

function valueOf(field, row) {
  if (typeof field === 'function') return field(row);
  return field;
}

function parseAt(value, now) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : now;
}

function entityKey(row) {
  const detail = row.detail || {};
  return clean(detail.accountId || detail.conversationId || detail.contactId || detail.messageId || detail.path || detail.command || 'global', 200);
}

function technicalDetail(row, catalog) {
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};
  const fields = {
    code: clean(valueOf(catalog.code, row) || detail.code || detail.errorCode || detail.reasonCode || '', 160),
    channel: clean(row.channel || 'system', 80),
    stage: clean(detail.stage || detail.command || '', 160),
    httpStatus: Number(detail.httpStatus || detail.status || 0) || 0,
    attempt: Number(detail.attempt || 0) || 0,
    durationMs: Number(detail.durationMs || 0) || 0,
    error: clean(detail.error || detail.message || '', 500),
    method: clean(detail.method || '', 20),
    path: clean(detail.path || '', 240)
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== '' && value !== 0));
}

function normalizedLog(row = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const activeWindowMs = Number(options.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS);
  const recentWindowMs = Number(options.recentWindowMs || DEFAULT_RECENT_WINDOW_MS);
  const normalized = {
    at: clean(row.at || new Date(now).toISOString(), 80),
    channel: clean(row.channel || 'system', 80).toLowerCase(),
    level: ['error', 'warn', 'info'].includes(row.level) ? row.level : 'info',
    message: clean(row.message || 'runtime-log', 160),
    detail: row.detail && typeof row.detail === 'object' ? row.detail : {}
  };
  const catalog = resolveCatalog(normalized);
  const atMs = parseAt(normalized.at, now);
  const ageMs = Math.max(0, now - atMs);
  let severity = clean(valueOf(catalog.severity, normalized) || 'medium', 20).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) severity = normalized.level === 'error' ? 'high' : 'medium';
  const retryable = Boolean(valueOf(catalog.retryable, normalized));
  const code = clean(valueOf(catalog.code, normalized) || normalized.message, 160).toUpperCase();
  const domain = clean(valueOf(catalog.domain, normalized) || normalized.channel, 80).toLowerCase();
  return {
    code,
    domain,
    severity,
    titleZh: clean(valueOf(catalog.titleZh, normalized) || '运行状态', 160),
    messageZh: clean(valueOf(catalog.messageZh, normalized) || '运行过程中出现需要关注的状态。', 600),
    actionZh: clean(valueOf(catalog.actionZh, normalized) || '查看技术详情', 240),
    retryable,
    at: normalized.at,
    atMs,
    ageMs,
    state: ageMs <= activeWindowMs ? 'active' : ageMs <= recentWindowMs ? 'recent' : 'historical',
    entity: entityKey(normalized),
    technical: technicalDetail(normalized, catalog)
  };
}

function aggregateKey(row) {
  const stage = clean(row.technical?.stage || '', 120);
  return `${row.domain}:${row.code}:${stage}`;
}

function effectiveSeverity(base, occurrences, active) {
  if (!active) return base;
  if (occurrences >= 8 && base === 'medium') return 'high';
  if (occurrences >= 20 && base === 'low') return 'medium';
  return base;
}

function projectLogs(input = {}, options = {}) {
  const source = Array.isArray(input) ? input : [
    ...(Array.isArray(input.logs) ? input.logs : []),
    ...(Array.isArray(input.errors) ? input.errors : []),
    ...(Array.isArray(input.warnings) ? input.warnings : [])
  ];
  const uniqueRows = new Map();
  for (const row of source) {
    const key = `${row?.at || ''}:${row?.channel || ''}:${row?.level || ''}:${row?.message || ''}:${JSON.stringify(row?.detail || {})}`;
    if (!uniqueRows.has(key)) uniqueRows.set(key, row || {});
  }
  const normalized = [...uniqueRows.values()].map(row => normalizedLog(row, options));
  const aggregates = new Map();
  for (const row of normalized) {
    const key = aggregateKey(row);
    const existing = aggregates.get(key) || {
      fingerprint: key,
      code: row.code,
      domain: row.domain,
      severity: row.severity,
      titleZh: row.titleZh,
      messageZh: row.messageZh,
      actionZh: row.actionZh,
      retryable: row.retryable,
      occurrences: 0,
      affectedEntities: new Set(),
      firstSeenAt: row.at,
      lastSeenAt: row.at,
      firstSeenAtMs: row.atMs,
      lastSeenAtMs: row.atMs,
      state: row.state,
      technical: row.technical
    };
    existing.occurrences += 1;
    if (row.entity && row.entity !== 'global') existing.affectedEntities.add(row.entity);
    if (row.atMs < existing.firstSeenAtMs) { existing.firstSeenAtMs = row.atMs; existing.firstSeenAt = row.at; }
    if (row.atMs >= existing.lastSeenAtMs) {
      existing.lastSeenAtMs = row.atMs;
      existing.lastSeenAt = row.at;
      existing.state = row.state;
      existing.technical = row.technical;
      existing.retryable = row.retryable;
    }
    if (SEVERITY_WEIGHT[row.severity] > SEVERITY_WEIGHT[existing.severity]) existing.severity = row.severity;
    aggregates.set(key, existing);
  }
  const rows = [...aggregates.values()].map(row => {
    const active = row.state === 'active';
    const severity = effectiveSeverity(row.severity, row.occurrences, active);
    return {
      ...row,
      severity,
      affectedEntityCount: row.affectedEntities.size,
      affectedEntities: undefined,
      firstSeenAtMs: undefined,
      lastSeenAtMs: undefined
    };
  }).sort((a, b) => {
    const stateOrder = { active: 0, recent: 1, historical: 2 };
    return stateOrder[a.state] - stateOrder[b.state]
      || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt));
  });
  const active = rows.filter(row => row.state === 'active');
  const recent = rows.filter(row => row.state === 'recent');
  const historical = rows.filter(row => row.state === 'historical');
  const countBySeverity = list => Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map(severity => [severity, list.filter(row => row.severity === severity).length]));
  return {
    authority: 'SystemHealthAuthority',
    activeWindowMs: Number(options.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS),
    recentWindowMs: Number(options.recentWindowMs || DEFAULT_RECENT_WINDOW_MS),
    aggregates: rows,
    active,
    recent,
    historical,
    summary: {
      aggregateCount: rows.length,
      activeAggregateCount: active.length,
      activeOccurrences: active.reduce((sum, row) => sum + row.occurrences, 0),
      recentAggregateCount: recent.length,
      historicalAggregateCount: historical.length,
      activeBySeverity: countBySeverity(active),
      retryingAggregateCount: active.filter(row => row.retryable).length
    }
  };
}

function baseHealthScore(input = {}) {
  const report = input.report || {};
  const accounts = input.accounts || { total: 0, connected: 0, abnormal: 0 };
  const ai = input.ai || { count: 0, online: false, routingEligible: 0 };
  const backups = input.backups || {};
  const secure = input.secure || {};
  const integrity = input.integrity || null;
  const executedTests = Math.max(1, Number(report.executed || (Number(report.pass || 0) + Number(report.fail || 0) + Number(report.warning || 0))));
  const availabilityScore = (Number(report.pass || 0) / executedTests) * 40;
  const connectionScore = accounts.total === 0 ? 8 : Math.max(0, (Number(accounts.connected || 0) / Math.max(1, Number(accounts.total || 0))) * 10 - Number(accounts.abnormal || 0) * 2);
  const protectionScore = !backups.latest ? 5 : backups.latest.valid === false ? 0 : backups.latestAgeHours > 36 ? 10 : 15;
  const aiScore = ai.count === 0 ? 4 : ai.online && ai.routingEligible > 0 ? 10 : ai.online ? 5 : 2;
  const securityScore = secure.available || process.env.NODE_ENV === 'test' ? 10 : 0;
  const integrityScore = integrity ? (Number(integrity.passed || 0) / Math.max(1, Number(integrity.checks?.length || 0))) * 15 : 0;
  return Math.round(availabilityScore + connectionScore + protectionScore + aiScore + securityScore + integrityScore);
}

function projectHealth(input = {}) {
  const report = input.report || {};
  const integrity = input.integrity || null;
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const logProjection = input.logProjection || projectLogs([]);
  const active = Array.isArray(logProjection.active) ? logProjection.active : [];
  let score = Number.isFinite(Number(input.baseScore)) ? Number(input.baseScore) : baseHealthScore(input);
  const nonLogIssues = issues.filter(row => !String(row.id || '').startsWith('runtime-log-'));
  const issueCritical = nonLogIssues.filter(row => row.severity === 'critical').length;
  const issueHigh = nonLogIssues.filter(row => row.severity === 'high').length;
  const activeCritical = active.filter(row => row.severity === 'critical').length;
  const activeHigh = active.filter(row => row.severity === 'high').length;
  const activeMedium = active.filter(row => row.severity === 'medium').length;
  const activeLow = active.filter(row => row.severity === 'low').length;
  const activeOccurrences = active.reduce((sum, row) => sum + Number(row.occurrences || 0), 0);
  const backgroundJobs = input.backgroundJobs && typeof input.backgroundJobs === 'object' ? input.backgroundJobs : { counts: {} };
  const jobCounts = backgroundJobs.counts || {};
  const jobRunning = Number(jobCounts.RUNNING || 0);
  const jobRetryWait = Number(jobCounts.RETRY_WAIT || 0);
  const jobFailedFinal = Number(jobCounts.FAILED_FINAL || 0);

  const penalty = Math.min(35, activeCritical * 22 + activeHigh * 10 + activeMedium * 4 + activeLow * 1)
    + Math.min(20, jobFailedFinal * 6 + jobRetryWait * 2);
  score -= penalty;
  if (issueCritical || activeCritical) score = Math.min(score, 49);
  else if (issueHigh || activeHigh) score = Math.min(score, 74);
  else if (activeMedium || jobFailedFinal) score = Math.min(score, jobFailedFinal ? 79 : 89);
  else if (activeLow || jobRetryWait || jobRunning) score = Math.min(score, jobRetryWait || jobRunning ? 89 : 94);
  if (input.policy?.emergencyStop) score = Math.min(score, 49);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const fail = Number(report.fail || 0) + Number(integrity?.failed || 0);
  const pass = Number(report.pass || 0) + Number(integrity?.passed || 0);
  let state = STATE.HEALTHY;
  if (!Number(report.executed || 0) && !issues.length && !active.length && !jobRunning && !jobRetryWait && !jobFailedFinal) state = STATE.UNKNOWN;
  else if (issueCritical || activeCritical || input.policy?.emergencyStop) state = STATE.BLOCKED;
  else if (issueHigh || activeHigh || fail > 0 || jobFailedFinal > 0) state = STATE.DEGRADED;
  else if (activeMedium || activeLow || jobRetryWait || jobRunning) state = (jobRetryWait || jobRunning || (active.length && active.every(row => row.retryable))) ? STATE.RECOVERING : STATE.DEGRADED;
  const level = LEVEL[state];
  const summaryZh = state === STATE.HEALTHY
    ? '当前探针和活动错误均未发现异常'
    : state === STATE.BLOCKED
      ? `${issueCritical + activeCritical} 项当前阻断需要立即处理`
      : state === STATE.RECOVERING
        ? `${active.length + jobRetryWait + jobRunning} 类后台任务正在运行、恢复或等待重试`
        : state === STATE.UNKNOWN
          ? '当前证据不足，尚不能判断系统健康状态'
          : `${issueHigh + activeHigh + activeMedium + activeLow + fail + jobFailedFinal} 项当前降级或失败需要关注`;
  return {
    authority: 'SystemHealthAuthority',
    state,
    score,
    level,
    pass,
    fail,
    criticalCount: issueCritical + activeCritical,
    highCount: issueHigh + activeHigh,
    activeErrorAggregates: active.length,
    activeErrorOccurrences: activeOccurrences,
    recoveringCount: active.filter(row => row.retryable).length + jobRetryWait + jobRunning,
    backgroundJobCounts: { running: jobRunning, retryWait: jobRetryWait, failedFinal: jobFailedFinal },
    summaryZh,
    dimensions: {
      probes: { pass: Number(report.pass || 0), fail: Number(report.fail || 0), warning: Number(report.warning || 0) },
      integrity: { passed: Number(integrity?.passed || 0), failed: Number(integrity?.failed || 0) },
      runtimeDegradation: logProjection.summary || {},
      backgroundJobs: { running: jobRunning, retryWait: jobRetryWait, failedFinal: jobFailedFinal, total: Number(backgroundJobs.total || 0) }
    }
  };
}

module.exports = {
  STATE,
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_RECENT_WINDOW_MS,
  normalizedLog,
  projectLogs,
  projectHealth,
  baseHealthScore
};
