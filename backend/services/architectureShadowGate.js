'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');

const AUTHORITY = 'ArchitectureShadowGate';
const SCHEMA_VERSION = 1;
function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function defaultClock() { return new Date().toISOString(); }

class ArchitectureShadowGate {
  constructor({ storeProvider = getStore, idFactory = defaultIdFactory, clock = defaultClock } = {}) { this.storeProvider = storeProvider; this.idFactory = idFactory; this.clock = clock; }
  store() { return this.storeProvider(); }
  recordComparison(input = {}) {
    const authority = clean(input.authority); const scopeId = clean(input.scopeId); const legacyHash = clean(input.legacyHash); const authorityHash = clean(input.authorityHash);
    if (!authority || !scopeId || !legacyHash || !authorityHash) throw Object.assign(new Error('Shadow comparison scope and hashes are required'), { code: 'SHADOW_COMPARISON_INCOMPLETE', status: 400 });
    const comparisonId = clean(input.comparisonId) || this.idFactory('shadow-comparison'); const observedAt = clean(input.observedAt) || this.clock(); const isMatch = legacyHash === authorityHash;
    this.store().db.prepare(`INSERT INTO architecture_shadow_comparisons(comparison_id,authority,scope_id,legacy_hash,authority_hash,is_match,observed_at) VALUES(?,?,?,?,?,?,?)`)
      .run(comparisonId, authority, scopeId, legacyHash, authorityHash, isMatch ? 1 : 0, observedAt);
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, comparisonId, targetAuthority: authority, scopeId, legacyHash, authorityHash, match: isMatch, observedAt };
  }
  evaluate({ authorities = [], minSamples = 100, windowSize = 1000 } = {}) {
    const ids = [...new Set((Array.isArray(authorities) ? authorities : []).map(clean).filter(Boolean))];
    const minimum = Math.max(1, Number(minSamples || 1)); const window = Math.max(minimum, Math.min(10000, Number(windowSize || minimum)));
    const store = this.store(); const rows = [];
    for (const authority of ids) {
      const samples = store.db.prepare(`SELECT * FROM architecture_shadow_comparisons WHERE authority=? ORDER BY observed_at DESC,comparison_id DESC LIMIT ?`).all(authority, window);
      const mismatches = samples.filter(row => Number(row.is_match) !== 1).length;
      rows.push({ authority, samples: samples.length, mismatches, pass: samples.length >= minimum && mismatches === 0, latestObservedAt: clean(samples[0]?.observed_at) });
    }
    const samples = rows.reduce((sum, row) => sum + row.samples, 0);
    const mismatches = rows.reduce((sum, row) => sum + row.mismatches, 0);
    const insufficientSamples = rows.filter(row => row.samples < minimum).length;
    return {
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      pass: ids.length > 0 && rows.every(row => row.pass),
      minSamples: minimum,
      windowSize: window,
      samples,
      mismatches,
      insufficientSamples,
      authorities: rows
    };
  }
}

const singleton = new ArchitectureShadowGate();
module.exports = singleton;
module.exports.ArchitectureShadowGate = ArchitectureShadowGate;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
