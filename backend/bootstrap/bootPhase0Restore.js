'use strict';

function runBootPhase0Restore(options = {}) {
  // Lazy import keeps restore ahead of every module that could acquire the
  // broker-owned production database while still providing the actual service.
  const backupService = require('../services/backupService');
  const result = backupService.executePendingRestore({
    phase: 'boot-phase-0',
    requireClosedDatabase: true,
    ...options
  });
  if (result && result.ok === false) {
    throw Object.assign(new Error(result.error || 'Boot Phase 0 restore failed'), {
      code: result.code || 'BOOT_PHASE_0_RESTORE_FAILED',
      restore: result
    });
  }
  return result || { ok: true, executed: false, phase: 'boot-phase-0' };
}

module.exports = { runBootPhase0Restore };
