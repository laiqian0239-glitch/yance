'use strict';

const backupService = require('./backupService');
const logger = require('./logger');

let timer = null;

function prune(maxBackups = 14) {
  const result = backupService.enforceRetention({ policy: { maxAutomaticCount: Math.max(1, Number(maxBackups || 14)) } });
  return {
    kept: result.keep?.length || 0,
    removed: result.removed?.length || 0,
    failures: result.failures || [],
    policy: result.policy,
    protected: result.protected,
    automatic: result.automatic
  };
}

function start({ intervalHours = 24, maxBackups = 14 } = {}) {
  stop();
  const run = () => {
    try {
      backupService.createBackup('automatic', { skipRetention: true });
      const result = prune(maxBackups);
      logger.info('backup', 'automatic-backup-complete', result);
    } catch (error) {
      logger.error('backup', 'automatic-backup-failed', { error: error.message });
    }
  };
  timer = setInterval(run, Math.max(1, Number(intervalHours || 24)) * 3600000);
  timer.unref?.();
  return { running: true, intervalHours, maxBackups };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, prune };
