'use strict';

const { AppRuntime } = require('./AppRuntime');
const { AppRuntimeError } = require('./errors');
const { isAuthorityWriteHostCapability } = require('../services/authorityWriteHost');

let processRuntime = null;
let processAuthorityWriteHostToken = null;
let factoryCreateCount = 0;

class AppRuntimeFactory {
  static create(options = {}) {
    if (processRuntime) throw new AppRuntimeError('APP_RUNTIME_ALREADY_EXISTS', 'A backend process may create only one AppRuntime', { status: 409 });
    const capability = options.authorityWriteHostCapability || options.store?.authorityWriteHostCapability || null;
    if (options.store?.db && !isAuthorityWriteHostCapability(capability)) {
      throw new AppRuntimeError(
        'APP_RUNTIME_AUTHORITY_WRITE_HOST_REQUIRED',
        'AppRuntime cannot bind a live primary store without its AuthorityWriteHost capability',
        { status: 409 }
      );
    }
    processAuthorityWriteHostToken = capability ? capability.tokenSnapshot() : null;
    processRuntime = new AppRuntime({
      ...options,
      authorityWriteHostCapability: capability,
      authorityWriteHostToken: processAuthorityWriteHostToken
    });
    factoryCreateCount += 1;
    return processRuntime;
  }

  static current() { return processRuntime; }

  static clear(runtime) {
    if (runtime == null) return false;
    if (processRuntime !== runtime) return false;
    processRuntime = null;
    processAuthorityWriteHostToken = null;
    return true;
  }

  static diagnostics() {
    return Object.freeze({
      currentPresent: Boolean(processRuntime),
      createCount: factoryCreateCount,
      authorityWriteHostBound: Boolean(processAuthorityWriteHostToken),
      authorityWriteHostToken: processAuthorityWriteHostToken
    });
  }

  static resetForTests() {
    if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_RUNTIME_RESET !== '1') {
      throw new AppRuntimeError('APP_RUNTIME_TEST_RESET_FORBIDDEN', 'AppRuntime test reset is unavailable in production', { status: 403 });
    }
    processRuntime = null;
    processAuthorityWriteHostToken = null;
    factoryCreateCount = 0;
  }
}

module.exports = { AppRuntimeFactory };
