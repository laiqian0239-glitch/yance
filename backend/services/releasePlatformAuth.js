'use strict';

const sharedReleasePlatformAuth = require('../../shared/release/releasePlatformAuth');
const { getDesktopStartupContext } = require('../bootstrap/desktopStartupContext');

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function startupResourcesPath() {
  try { return clean(getDesktopStartupContext().resourcesPath); }
  catch (_) { return ''; }
}

function withBackendStartupResources(options = {}) {
  if (clean(options.resourcesPath)) return options;
  const resourcesPath = startupResourcesPath();
  return resourcesPath ? { ...options, resourcesPath } : options;
}

function candidatePaths(options = {}) {
  return sharedReleasePlatformAuth.candidatePaths(withBackendStartupResources(options));
}

function loadReleasePlatformAuth(options = {}) {
  return sharedReleasePlatformAuth.loadReleasePlatformAuth(withBackendStartupResources(options));
}

module.exports = {
  ...sharedReleasePlatformAuth,
  candidatePaths,
  loadReleasePlatformAuth
};
