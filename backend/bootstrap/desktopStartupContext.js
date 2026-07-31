'use strict';

let context = null;

class BackendDesktopStartupError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'BackendDesktopStartupError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function configureDesktopStartupContext(value) {
  if (context) {
    throw new BackendDesktopStartupError('BOOT_DESKTOP_STARTUP_ALREADY_CONFIGURED', 'DesktopHost startup context is immutable once configured');
  }
  context = Object.freeze({ ...value });
  return context;
}

function getDesktopStartupContext() {
  if (!context) {
    throw new BackendDesktopStartupError('BOOT_DESKTOP_STARTUP_NOT_CONFIGURED', 'DesktopHost startup configuration is required before backend identity or runtime initialization');
  }
  return context;
}

function getApiSessionToken() {
  return getDesktopStartupContext().apiSessionToken;
}

function resetForTests() { context = null; }

module.exports = {
  BackendDesktopStartupError,
  configureDesktopStartupContext,
  getApiSessionToken,
  getDesktopStartupContext,
  resetForTests
};
