'use strict';

const { AppRuntimeError } = require('./errors');
let coordinator = null;

function setRuntimeCoordinator(value) {
  if (coordinator && coordinator !== value) throw new AppRuntimeError('APP_RUNTIME_ALREADY_EXISTS', 'Runtime coordinator is already configured', { status: 409 });
  coordinator = value;
  return coordinator;
}
function getRuntimeCoordinator() {
  if (!coordinator) throw new AppRuntimeError('APP_RUNTIME_NOT_INITIALIZED', 'Backend AppRuntime must be initialized before server routes', { status: 503 });
  return coordinator;
}
function getAppRuntime() { return getRuntimeCoordinator().runtime; }
function clearRuntimeCoordinator(value) { if (value && value === coordinator) { coordinator = null; return true; } return false; }

module.exports = { clearRuntimeCoordinator, getAppRuntime, getRuntimeCoordinator, setRuntimeCoordinator };
