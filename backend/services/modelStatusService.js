'use strict';

const registry = require('./modelRegistry');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const projection = require('./modelStatusProjection');

function credentialReady(model) {
  return securityGuard.credentials.has(model?.credentialRef || '');
}

function project(state = registry.read()) {
  return projection.project(state, { credentialReady });
}

module.exports = {
  ...projection,
  project,
  read: () => project(registry.read())
};
