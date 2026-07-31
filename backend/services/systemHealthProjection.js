'use strict';

function buildTopology(report, accounts, ai, backups, notifications, policy) {
  const byId = id => report.tests.find(row => row.id === id);
  return {
    nodes: [
      { id: 'desktop', label: '桌面主进程', state: 'unknown', detail: '由Electron桌面桥实时补充' },
      { id: 'backend', label: '本地服务', state: 'online', detail: `PID ${process.pid}` },
      { id: 'event', label: '实时事件总线', state: byId('event-bus')?.pass ? 'online' : 'error', detail: byId('event-bus')?.detail || '' },
      { id: 'accounts', label: '多平台账号', state: accounts.abnormal ? 'warning' : (accounts.connected ? 'online' : 'idle'), detail: `${accounts.connected}/${accounts.total} 已连接` },
      { id: 'messages', label: '消息与媒体', state: byId('message-store')?.pass ? 'online' : 'error', detail: byId('message-store')?.detail || '' },
      { id: 'ai', label: 'AI模型网关', state: ai.routingEligible > 0 ? 'online' : (ai.count ? 'warning' : 'idle'), detail: ai.routingEligible > 0 ? `${ai.routingEligible}/${ai.count} 可路由` : ai.count ? `${ai.verified}/${ai.count} 已验证 · 当前不可路由` : '尚无模型' },
      { id: 'notify', label: '通知与声音', state: notifications.enabled && !notifications.paused ? 'online' : 'paused', detail: notifications.paused ? '已暂停' : '策略已加载' },
      { id: 'backup', label: '数据保护', state: backups.latest?.valid === false ? 'error' : backups.latest ? 'online' : 'warning', detail: backups.latest ? backups.latest.verifyMessage : '尚无恢复点' },
      { id: 'writeGate', label: '写操作门禁', state: policy.emergencyStop ? 'blocked' : 'online', detail: policy.emergencyStop ? '全局紧急停止' : '正常开放' }
    ],
    edges: [
      ['desktop', 'backend'], ['backend', 'event'], ['event', 'accounts'], ['accounts', 'messages'],
      ['messages', 'ai'], ['event', 'notify'], ['backend', 'backup'], ['writeGate', 'accounts']
    ].map(([from, to]) => ({ from, to }))
  };
}

function buildAvailability(report = {}, coreFailures = []) {
  const probeFailCount = Number(report.fail || 0);
  const coreFailureCount = Array.isArray(coreFailures) ? coreFailures.length : 0;
  const rawScore = Number(report.executed || 0)
    ? Math.round((Number(report.pass || 0) / Math.max(1, Number(report.executed || 0))) * 100)
    : 0;
  return {
    online: probeFailCount === 0 && coreFailureCount === 0,
    level: probeFailCount === 0 && coreFailureCount === 0 ? 'online' : 'degraded',
    pass: Number(report.pass || 0),
    fail: probeFailCount + coreFailureCount,
    probeFailures: probeFailCount,
    blockingFailures: coreFailureCount,
    warning: Number(report.warning || 0),
    skipped: Number(report.skipped || 0),
    total: Number(report.tests?.length || 0),
    executed: Number(report.executed || 0),
    score: coreFailureCount ? Math.min(rawScore, 59) : rawScore
  };
}

module.exports = { buildTopology, buildAvailability };
