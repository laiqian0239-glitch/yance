'use strict';

const fs = require('node:fs');
const path = require('node:path');
const lockfile = require('proper-lockfile');
const { AppRuntimeError } = require('./errors');

function normalizeLockTarget(value) {
  const candidate = String(value || '').trim();
  if (!candidate) throw new TypeError('lockTarget is required');
  return path.resolve(candidate);
}

function lockFailure(error, target) {
  if (String(error?.code || '') === 'ELOCKED') {
    const wrapped = new AppRuntimeError(
      'BOOT_RUNTIME_MUTEX_HELD',
      'Another backend still owns the AppRuntime process lock',
      {
        status: 409,
        failedPhase: 'runtime_ownership',
        details: { provider: 'PROPER_LOCKFILE', lockTarget: target }
      }
    );
    wrapped.cause = error;
    return wrapped;
  }

  const wrapped = new AppRuntimeError(
    'BOOT_RUNTIME_MUTEX_UNAVAILABLE',
    'The AppRuntime process lock could not be acquired',
    {
      status: 500,
      failedPhase: 'runtime_ownership',
      details: {
        provider: 'PROPER_LOCKFILE',
        lockTarget: target,
        causeCode: String(error?.code || '')
      }
    }
  );
  wrapped.cause = error;
  return wrapped;
}

class NamedRuntimeMutex {
  constructor(options = {}) {
    this.lockTarget = normalizeLockTarget(options.lockTarget);
    this.name = this.lockTarget;
    this.provider = 'PROPER_LOCKFILE';
    this.acquireTimeoutMs = Math.max(500, Number(options.acquireTimeoutMs || 5000));
    this.staleMs = Math.max(5000, this.acquireTimeoutMs * 4);
    this._release = null;
    this._held = false;
  }

  get held() {
    return this._held;
  }

  async acquire() {
    if (this._held) return this.snapshot();

    fs.mkdirSync(path.dirname(this.lockTarget), { recursive: true });

    try {
      const release = await lockfile.lock(this.lockTarget, {
        realpath: false,
        retries: 0,
        stale: this.staleMs,
        update: Math.max(1000, Math.floor(this.staleMs / 2))
      });
      this._release = release;
      this._held = true;
      return this.snapshot();
    } catch (error) {
      throw lockFailure(error, this.lockTarget);
    }
  }

  async release() {
    if (!this._held) return;
    const release = this._release;
    if (typeof release !== 'function') {
      throw new AppRuntimeError(
        'BOOT_RUNTIME_MUTEX_UNAVAILABLE',
        'The AppRuntime process lock release handle is unavailable',
        {
          status: 500,
          failedPhase: 'runtime_ownership',
          details: { provider: this.provider, lockTarget: this.lockTarget }
        }
      );
    }

    try {
      await release();
      this._release = null;
      this._held = false;
    } catch (error) {
      throw lockFailure(error, this.lockTarget);
    }
  }

  snapshot() {
    return Object.freeze({
      name: this.name,
      target: this.lockTarget,
      provider: this.provider,
      held: this._held
    });
  }
}

module.exports = { NamedRuntimeMutex };
