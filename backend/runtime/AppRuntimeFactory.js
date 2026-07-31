'use strict';

const { AppRuntime } = require('./AppRuntime');
const { AppRuntimeError } = require('./errors');

let processRuntime = null;
let factoryCreateCount = 0;

class AppRuntimeFactory {
  static create(options = {}) {
    if (processRuntime) throw new AppRuntimeError('APP_RUNTIME_ALREADY_EXISTS', 'A backend process may create only one AppRuntime', { status: 409 });
    processRuntime = new AppRuntime(options);
    factoryCreateCount += 1;
    return processRuntime;
  }

  static current() { return processRuntime; }

  static clear(runtime) {
    if (runtime == null) return false;
    if (processRuntime !== runtime) return false;
    processRuntime = null;
    return true;
  }

  static diagnostics() {
    return Object.freeze({ currentPresent: Boolean(processRuntime), createCount: factoryCreateCount });
  }

  static resetForTests() {
    if (process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_RUNTIME_RESET !== '1') {
      throw new AppRuntimeError('APP_RUNTIME_TEST_RESET_FORBIDDEN', 'AppRuntime test reset is unavailable in production', { status: 403 });
    }
    processRuntime = null;
    factoryCreateCount = 0;
  }
}

module.exports = { AppRuntimeFactory };
