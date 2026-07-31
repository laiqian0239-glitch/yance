'use strict';

const { BackendProcessHost } = require('./BackendProcessHost');
const { CredentialVaultHost } = require('./CredentialVaultHost');
const { ReleaseManifestHost } = require('./ReleaseManifestHost');

const ALLOWED_CONTROL_COMMANDS = Object.freeze(new Set([
  'backend.start',
  'backend.stop',
  'backend.restart',
  'backend.status'
]));

class DesktopHost {
  constructor(options = {}) {
    this.releaseManifestHost = options.releaseManifestHost || new ReleaseManifestHost({ resourcesPath: options.resourcesPath });
    this.backendProcessHost = options.backendProcessHost || new BackendProcessHost({ log: options.log, ownerRecordPath: options.backendOwnerRecordPath, fs: options.fs, clock: options.clock, isProcessAlive: options.isProcessAlive, captureProcessIdentity: options.captureProcessIdentity, autoRecoverRejectedOwner: options.autoRecoverRejectedOwner === true });
    this.credentialVaultHost = options.credentialVaultHost || (options.vault ? new CredentialVaultHost({ vault: options.vault }) : null);
    this.credentialApplicationCoordinator = options.credentialApplicationCoordinator || null;
    this.log = options.log || (() => {});
  }

  setCredentialApplicationCoordinator(coordinator) {
    this.credentialApplicationCoordinator = coordinator || null;
    this.credentialVaultHost?.requireApplicationCoordinator?.(Boolean(coordinator));
    return this.credentialApplicationCoordinator;
  }

  verifyReleaseIdentity() { return this.releaseManifestHost.verify(); }

  async startBackend(options = {}) {
    if (this.credentialApplicationCoordinator?.isRejectedOwnerContainmentActive?.() && options.containmentRecoveryValidated !== true) {
      const error = new Error('Backend start is blocked while a rejected owner remains contained');
      error.reasonCode = 'WP4_DESKTOP_REJECTED_OWNER_CONTAINMENT_ACTIVE';
      error.retryable = true;
      throw error;
    }
    const releaseStartupConfig = this.releaseManifestHost.backendStartupConfig();
    const createCredentialSnapshot = this.credentialVaultHost
      ? context => this.credentialVaultHost.createHydrationFrame({ ...context, applicationLeaseToken: options.applicationLeaseToken || null })
      : options.createCredentialSnapshot;
    return this.backendProcessHost.start({
      ...options,
      releaseStartupConfig,
      credentialVaultHost: this.credentialVaultHost,
      createCredentialSnapshot,
      handleBackendOwnerExit: ownerContext => this.credentialVaultHost?.handleBackendOwnerExit?.(ownerContext),
      credentialHandshakeRequired: options.credentialHandshakeRequired !== false,
      onCredentialHydrated: metadata => { options.onCredentialHydrated?.(metadata); }
    });
  }

  stopBackend(options = {}) { return this.backendProcessHost.stop(options); }

  acceptBackendOwner(context = {}) {
    return this.backendProcessHost.acceptBackendOwner?.(context) || null;
  }

  containRejectedBackendOwner(context = {}) {
    return this.backendProcessHost.containRejectedOwner?.(context) || null;
  }

  persistRejectedBackendOwner(context = {}) {
    return this.backendProcessHost.persistRejectedOwnerMarker?.(context) || null;
  }

  clearRejectedBackendOwner(options = {}) {
    return this.backendProcessHost.clearRejectedOwner?.(options) || false;
  }

  recoverRejectedBackendOwnerForStart(options = {}) {
    return this.backendProcessHost.recoverRejectedOwnerForStart?.(options) || Promise.resolve({ recovered: false, notRequired: true });
  }

  isRejectedBackendOwnerLive() {
    return this.backendProcessHost.isRejectedOwnerLive?.() === true;
  }

  waitForBackendOwnerExitRecovery(child) {
    return this.backendProcessHost.waitForOwnerExitRecovery(child);
  }

  async restartBackend(options = {}) {
    const releaseStartupConfig = this.releaseManifestHost.backendStartupConfig();
    const createCredentialSnapshot = this.credentialVaultHost
      ? context => this.credentialVaultHost.createHydrationFrame({ ...context, applicationLeaseToken: options.applicationLeaseToken || null })
      : options.createCredentialSnapshot;
    return this.backendProcessHost.restart({
      ...options,
      releaseStartupConfig,
      credentialVaultHost: this.credentialVaultHost,
      createCredentialSnapshot,
      handleBackendOwnerExit: ownerContext => this.credentialVaultHost?.handleBackendOwnerExit?.(ownerContext),
      credentialHandshakeRequired: options.credentialHandshakeRequired !== false,
      onCredentialHydrated: metadata => { options.onCredentialHydrated?.(metadata); }
    });
  }

  async resetCredentialVault(options = {}) {
    if (!options.applicationLeaseToken) {
      if (!this.credentialApplicationCoordinator) {
        const error = new Error('Credential vault reset requires DesktopCredentialApplicationCoordinator');
        error.reasonCode = 'WP6_DESKTOP_COORDINATOR_REQUIRED';
        throw error;
      }
      return this.credentialApplicationCoordinator.resetCredentialVault(options);
    }
    if (!this.credentialVaultHost) {
      const error = new Error('Credential vault is unavailable');
      error.reasonCode = 'CREDENTIAL_VAULT_UNAVAILABLE';
      throw error;
    }
    const stopResult = await this.stopBackend(options);
    if (stopResult.stopped !== true || stopResult.exitConfirmed !== true) {
      const error = new Error('Credential vault reset requires confirmed backend exit');
      error.reasonCode = stopResult.reasonCode || 'CREDENTIAL_VAULT_RESET_BACKEND_EXIT_REQUIRED';
      throw error;
    }
    return this.credentialVaultHost.resetAfterBackendStopped({ ...options, exitConfirmed: true });
  }

  executeControl(commandType, options = {}) {
    if (!ALLOWED_CONTROL_COMMANDS.has(commandType)) {
      const error = new Error(`DesktopHost cannot execute business command: ${commandType}`);
      error.reasonCode = 'DESKTOP_HOST_BUSINESS_COMMAND_FORBIDDEN';
      throw error;
    }
    if (!options.applicationLeaseToken) {
      if (!this.credentialApplicationCoordinator) {
        const error = new Error('Desktop lifecycle control requires DesktopCredentialApplicationCoordinator');
        error.reasonCode = 'WP6_DESKTOP_COORDINATOR_REQUIRED';
        throw error;
      }
      if (commandType === 'backend.start') return this.credentialApplicationCoordinator.startBackend(options);
      if (commandType === 'backend.stop') return this.credentialApplicationCoordinator.stopBackend(options);
      if (commandType === 'backend.restart') return this.credentialApplicationCoordinator.restartBackend(options);
    }
    if (commandType === 'backend.start') return this.startBackend(options);
    if (commandType === 'backend.stop') return this.stopBackend(options);
    if (commandType === 'backend.restart') return this.restartBackend(options);
    return this.backendProcessHost.snapshot();
  }

  snapshot() {
    return Object.freeze({
      role: 'DESKTOP_HOST_ONLY',
      release: this.releaseManifestHost.snapshot(),
      backend: this.backendProcessHost.snapshot(),
      credentialVault: this.credentialVaultHost?.snapshotMetadata?.() || null,
      credentialApplication: this.credentialApplicationCoordinator?.snapshot?.() || null
    });
  }
}

module.exports = { ALLOWED_CONTROL_COMMANDS, DesktopHost };
