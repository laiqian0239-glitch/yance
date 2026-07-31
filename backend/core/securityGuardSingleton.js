'use strict';

const secureBridge = require('../services/secureBridge');
const systemPolicy = require('../services/systemPolicy');
const eventBus = require('../services/eventBus');
const logger = require('../services/logger');
const { SecurityGuard } = require('./securityGuard');

let singleton = null;
function getSecurityGuard() {
  if (!singleton) singleton = new SecurityGuard({ secureBridge, systemPolicy, eventBus, logger });
  return singleton;
}

module.exports = { getSecurityGuard };
