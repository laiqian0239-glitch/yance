(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceModelRegistryProjection = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function finiteCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function callCount(service) {
    return finiteCount(service?.raw?.callCount ?? service?.callCount);
  }

  function qualification(service) {
    return String(service?.qualification || 'untested').trim().toLowerCase() || 'untested';
  }

  function summarizeServices(services = []) {
    const rows = Array.isArray(services) ? services : [];
    const summary = {
      count: rows.length,
      online: 0,
      verified: 0,
      routingEligible: 0,
      experimental: 0,
      failed: 0,
      testing: 0,
      untested: 0,
      used: 0,
      totalCalls: 0
    };

    for (const service of rows) {
      const state = qualification(service);
      const calls = callCount(service);
      if (String(service?.status || '').toLowerCase() === 'online') summary.online += 1;
      if (service?.verified === true) summary.verified += 1;
      if (service?.routingEligible === true) summary.routingEligible += 1;
      if (state === 'experimental') summary.experimental += 1;
      else if (state === 'testing') summary.testing += 1;
      else if (state === 'failed' || state === 'blocked') summary.failed += 1;
      else if (state === 'untested' || !state) summary.untested += 1;
      if (calls > 0) summary.used += 1;
      summary.totalCalls += calls;
    }

    return Object.freeze(summary);
  }

  function mergeAuthoritativeSummary(derived = {}, authoritative = {}) {
    const base = derived && typeof derived === 'object' ? derived : {};
    const source = authoritative && typeof authoritative === 'object' ? authoritative : {};
    return Object.freeze({ ...base, ...source });
  }

  return Object.freeze({ summarizeServices, mergeAuthoritativeSummary });
});
