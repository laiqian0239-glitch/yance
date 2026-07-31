'use strict';

const path = require('node:path');
const { BackendOwnerRegistry } = require('./BackendOwnerRegistry');

function cutoverError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.code = reasonCode;
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}

class LegacyRuntimeCutoverGate {
  constructor(options = {}) {
    if (!options.legacyDataRoot) throw new TypeError('legacyDataRoot is required');
    this.legacyDataRoot = path.resolve(options.legacyDataRoot);
    this.ownerRecordPath = path.resolve(options.ownerRecordPath || path.join(this.legacyDataRoot, 'secure', 'desktop-backend-owner.json'));
    this.killProcess = options.killProcess || ((pid, signal) => process.kill(pid, signal));
    this.isProcessAlive = options.isProcessAlive;
    this.captureProcessIdentity = options.captureProcessIdentity;
    this.fs = options.fs;
    this.clock = options.clock || (() => new Date().toISOString());
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.log = options.log || (() => {});
  }

  _registry() {
    return new BackendOwnerRegistry({
      file: this.ownerRecordPath,
      fs: this.fs,
      clock: this.clock,
      isProcessAlive: this.isProcessAlive,
      captureIdentity: this.captureProcessIdentity
    });
  }

  async _waitForExitOrReuse(registry, record, timeoutMs) {
    const deadline = Date.now() + Math.max(25, Number(timeoutMs || 1500));
    while (Date.now() < deadline) {
      const probe = registry.probe(record);
      if (probe.alive !== true || probe.identityMatch === false) return probe;
      if (probe.identityMatch !== true) return probe;
      await this.sleep(25);
    }
    return registry.probe(record);
  }

  async execute(options = {}) {
    const registry = this._registry();
    if (registry.loadFailure) {
      throw cutoverError(
        'WP5_LEGACY_OWNER_REGISTRY_INVALID',
        'Earlier Yance backend owner registry cannot be validated; Yance startup is blocked',
        { registryFailure: registry.loadFailure, ownerRecordPath: this.ownerRecordPath }
      );
    }

    const record = registry.snapshot();
    if (!record || record.ownershipActive !== true) {
      const result = {
        ok: true,
        state: 'LEGACY_OWNER_CLEARED',
        ownerRecordPath: this.ownerRecordPath,
        legacyDataRoot: this.legacyDataRoot,
        ownerRecordPresent: Boolean(record),
        sourceRegistryMutated: false,
        checkedAtUtc: this.clock()
      };
      this.log('wp5-legacy-owner-cutover-clear', result);
      return result;
    }

    let probe = registry.probe(record);
    const base = {
      ownerRecordPath: this.ownerRecordPath,
      legacyDataRoot: this.legacyDataRoot,
      backendPid: Number(record.backendPid || 0),
      sourceRegistryMutated: false,
      initialProbe: probe
    };

    if (probe.alive !== true) {
      const result = { ok: true, state: 'LEGACY_OWNER_EXIT_CONFIRMED', alreadyExited: true, ...base, finalProbe: probe, checkedAtUtc: this.clock() };
      this.log('wp5-legacy-owner-cutover-exited', result);
      return result;
    }

    if (probe.identityMatch === false) {
      const result = { ok: true, state: 'LEGACY_OWNER_CLEARED', pidReused: true, ...base, finalProbe: probe, checkedAtUtc: this.clock() };
      this.log('wp5-legacy-owner-cutover-pid-reused', result);
      return result;
    }

    if (probe.identityMatch !== true) {
      throw cutoverError(
        'WP5_LEGACY_OWNER_AMBIGUOUS',
        'Earlier Yance backend owner is live but its identity cannot be verified; Yance startup is blocked',
        base
      );
    }

    const backendPid = Number(record.backendPid || 0);
    let forced = false;
    try {
      this.killProcess(backendPid, 'SIGTERM');
    } catch (cause) {
      if (cause?.code !== 'ESRCH') {
        throw cutoverError(
          cause?.code === 'EPERM' ? 'WP5_LEGACY_OWNER_TERMINATION_EPERM' : 'WP5_LEGACY_OWNER_SIGTERM_FAILED',
          'Earlier Yance backend owner could not be terminated safely',
          { ...base, causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) }
        );
      }
    }

    probe = await this._waitForExitOrReuse(registry, record, options.gracefulMs || 1500);
    if (probe.alive === true && probe.identityMatch === true) {
      forced = true;
      try {
        this.killProcess(backendPid, 'SIGKILL');
      } catch (cause) {
        if (cause?.code !== 'ESRCH') {
          throw cutoverError(
            cause?.code === 'EPERM' ? 'WP5_LEGACY_OWNER_TERMINATION_EPERM' : 'WP5_LEGACY_OWNER_SIGKILL_FAILED',
            'Earlier Yance backend owner could not be force-terminated safely',
            { ...base, causeCode: cause?.code || '', causeMessage: cause?.message || String(cause) }
          );
        }
      }
      probe = await this._waitForExitOrReuse(registry, record, options.forceMs || 1500);
    }

    if (probe.alive === true && probe.identityMatch === true) {
      throw cutoverError(
        'WP5_LEGACY_OWNER_EXIT_NOT_CONFIRMED',
        'Earlier Yance backend owner remains live after containment; Yance startup is blocked',
        { ...base, finalProbe: probe, forced }
      );
    }
    if (probe.alive === true && probe.identityMatch === null) {
      throw cutoverError(
        'WP5_LEGACY_OWNER_EXIT_AMBIGUOUS',
        'Earlier Yance backend owner termination result is ambiguous; Yance startup is blocked',
        { ...base, finalProbe: probe, forced }
      );
    }

    const result = {
      ok: true,
      state: 'LEGACY_OWNER_EXIT_CONFIRMED',
      ...base,
      finalProbe: probe,
      forced,
      pidReusedAfterSignal: probe.identityMatch === false,
      checkedAtUtc: this.clock()
    };
    this.log('wp5-legacy-owner-cutover-contained', result);
    return result;
  }
}

module.exports = { LegacyRuntimeCutoverGate, cutoverError };
