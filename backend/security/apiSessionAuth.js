'use strict';

const crypto = require('node:crypto');
const { getApiSessionToken } = require('../bootstrap/desktopStartupContext');

const executionStats = { headerChecks: 0, webSocketChecks: 0, accepted: 0, rejected: 0 };

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return Boolean(a.length && a.length === b.length && crypto.timingSafeEqual(a, b));
}

function suppliedToken(headers = {}) {
  const bearer = String(headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return bearer || String(headers['x-yance-session'] || '').trim();
}

function currentApiSessionToken() {
  return getApiSessionToken();
}

function evaluate(headers = {}, kind = 'http') {
  if (kind === 'websocket') executionStats.webSocketChecks += 1;
  else executionStats.headerChecks += 1;
  const accepted = constantTimeEqual(suppliedToken(headers), currentApiSessionToken());
  executionStats[accepted ? 'accepted' : 'rejected'] += 1;
  return accepted;
}

function authorizeHeaders(headers = {}) {
  return evaluate(headers, 'http');
}

function authorizeWebSocketRequest(request) {
  return evaluate(request?.headers || {}, 'websocket');
}

function getApiSessionAuthStats() {
  return Object.freeze({ ...executionStats, module: 'backend/security/apiSessionAuth.js' });
}

module.exports = {
  authorizeHeaders,
  authorizeWebSocketRequest,
  constantTimeEqual,
  currentApiSessionToken,
  suppliedToken,
  getApiSessionAuthStats
};
