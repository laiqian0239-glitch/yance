'use strict';

class UpdateManager {
  constructor({ securityGuard, lifecycleManager, updatePreflight, eventBus }) {
    this.securityGuard = securityGuard;
    this.lifecycleManager = lifecycleManager;
    this.updatePreflight = updatePreflight;
    this.eventBus = eventBus;
    this.lastPreflight = null;
  }

  async prepare() { return this.snapshot(); }
  async start() { return this.snapshot(); }
  async stop() { return { stopped: true }; }

  preflight(context = {}) {
    return this.securityGuard.execute('update.preflight', { actor: 'backend-core', ...context }, async () => {
      this.lastPreflight = this.updatePreflight.snapshot();
      this.eventBus?.publish?.('update:preflight', this.lastPreflight);
      return this.lastPreflight;
    });
  }

  async prepareInstall(context = {}) {
    const report = await this.preflight(context);
    if (!report.safeToInstall) return report;
    await this.lifecycleManager.beginUpdate('update-install-approved');
    return { ...report, lifecycle: this.lifecycleManager.snapshot() };
  }

  snapshot() {
    return {
      module: 'UpdateManager',
      ready: true,
      lastPreflight: this.lastPreflight,
      lifecycleState: this.lifecycleManager.state
    };
  }
}

module.exports = { UpdateManager };
