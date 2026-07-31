'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const sendQueue = require('./sendQueueService');
const aiBrain = require('./aiBrainOrchestrator');
const backup = require('./backupService');
const runtimeRecovery = require('./runtimeRecoveryService');
const accountManager = require('./accountManager');

function snapshot() {
  const blockers = [];
  const warnings = [];
  const queue = sendQueue.status();
  const ai = aiBrain.status();
  const runtime = runtimeRecovery.status();
  const pendingRestore = backup.pendingRestore();
  const migration = settingsRepository.findRunningMigration();
  const authenticating = accountManager.list().accounts.filter(account => ['connecting','waiting-verification'].includes(account.state));

  if (queue.running || queue.pending > 0) blockers.push({ id: 'outbox-active', severity: 'high', label: '发送队列仍有任务', detail: `${queue.pending} 个待处理任务` });
  if (Number(ai.activeJobs || 0) > 0) warnings.push({ id: 'ai-active', severity: 'low', label: 'AI任务将在安装前取消', detail: `${ai.activeJobs} 个可重建任务，不阻断更新` });
  if (runtime.recovering) blockers.push({ id: 'runtime-recovery', severity: 'high', label: '系统正在恢复连接', detail: runtime.lastEvent || 'runtime recovery' });
  if (migration) blockers.push({ id: 'migration-running', severity: 'critical', label: '数据库迁移正在进行', detail: migration.migration_id });
  if (pendingRestore) blockers.push({ id: 'restore-pending', severity: 'critical', label: '存在待执行的数据恢复', detail: pendingRestore.backupName || pendingRestore.state || '' });
  if (authenticating.length) blockers.push({ id: 'account-auth-active', severity: 'medium', label: '账号授权尚未完成', detail: authenticating.map(row => row.displayName).join('、') });

  return {
    ok: blockers.length === 0,
    safeToInstall: blockers.length === 0,
    blockers,
    warnings,
    queue,
    ai: { activeJobs: Number(ai.activeJobs || 0), pendingConversations: Number(ai.pendingConversations || 0) },
    runtime: { recovering: Boolean(runtime.recovering), online: Boolean(runtime.online) },
    checkedAt: new Date().toISOString()
  };
}

module.exports = { snapshot };
