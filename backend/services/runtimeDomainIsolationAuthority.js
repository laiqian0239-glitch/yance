'use strict';

const { normalizeTrigger } = require('./scopedSafetyAuthority');

const AUTHORITY = 'RuntimeDomainIsolationAuthority';
const SCHEMA_VERSION = 2;

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function projectAccount(rows) {
  const first = rows[0];
  return {
    state: first.state,
    blocked: true,
    platform: first.platform,
    reasons: unique(rows.map(row => row.code)),
    blockedCapabilities: unique(rows.flatMap(row => row.blockedCapabilities || [])),
    evidence: rows.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
  };
}
function projectPlatform(rows) {
  return {
    state: 'degraded',
    blocked: rows.some(row => row.blockedCapabilities?.includes('all')),
    reasons: unique(rows.map(row => row.code)),
    blockedCapabilities: unique(rows.flatMap(row => row.blockedCapabilities || [])),
    evidence: rows.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
  };
}
function projectCapability(rows) {
  return {
    state: 'paused',
    blocked: true,
    reasons: unique(rows.map(row => row.code)),
    evidence: rows.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
  };
}

class RuntimeDomainIsolationAuthority {
  constructor(options = {}) {
    this.clock = options.clock || nowIso;
    this.listeners = new Set();
    this.state = {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      updatedAt: '',
      aiAutomationBlocked: false,
      aiIsolationReasons: [],
      globalWriteBlocked: false,
      globalSafeModeReasons: [],
      accounts: {},
      platforms: {},
      capabilities: {},
      domains: {}
    };
  }

  evaluate(triggers = []) {
    const previous = this.snapshot();
    const rows = (Array.isArray(triggers) ? triggers : []).map(normalizeTrigger);
    const globalRows = rows.filter(row => row.globalEscalation === true);
    const aiRows = rows.filter(row => row.scopeType === 'capability' && row.capability === 'ai-automation');
    const accountGroups = {};
    const platformGroups = {};
    const capabilityGroups = {};
    for (const row of rows) {
      if (row.scopeType === 'account' && row.accountId) (accountGroups[row.accountId] ||= []).push(row);
      else if (row.scopeType === 'platform' && row.platform) (platformGroups[row.platform] ||= []).push(row);
      else if (row.scopeType === 'capability' && row.capability) (capabilityGroups[row.capability] ||= []).push(row);
    }
    const accounts = Object.fromEntries(Object.entries(accountGroups).map(([id, group]) => [id, projectAccount(group)]));
    const platforms = Object.fromEntries(Object.entries(platformGroups).map(([id, group]) => [id, projectPlatform(group)]));
    for (const [accountId, group] of Object.entries(accountGroups)) {
      const platform = clean(group[0]?.platform).toLowerCase();
      if (!platform || platforms[platform]) continue;
      platforms[platform] = {
        state: 'attention',
        blocked: false,
        reasons: unique(group.map(row => row.code)),
        blockedCapabilities: [],
        affectedAccounts: [accountId],
        evidence: group.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
      };
    }
    const capabilities = Object.fromEntries(Object.entries(capabilityGroups).map(([id, group]) => [id, projectCapability(group)]));
    this.state = {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      updatedAt: this.clock(),
      aiAutomationBlocked: aiRows.length > 0,
      aiIsolationReasons: unique(aiRows.map(row => row.code)),
      globalWriteBlocked: globalRows.length > 0,
      globalSafeModeReasons: unique(globalRows.map(row => row.code)),
      accounts,
      platforms,
      capabilities,
      domains: {
        ai: {
          blocked: aiRows.length > 0,
          reasons: unique(aiRows.map(row => row.code)),
          evidence: aiRows.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
        },
        accounts,
        platforms,
        capabilities,
        global: {
          blocked: globalRows.length > 0,
          reasons: unique(globalRows.map(row => row.code)),
          evidence: globalRows.map(row => ({ code: row.code, detail: row.detail, evidence: row.evidence || null }))
        }
      }
    };
    const next = this.snapshot();
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    if (changed) for (const listener of this.listeners) { try { listener(next, previous); } catch (_) {} }
    return next;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Runtime domain isolation listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() { return clone(this.state); }
}

let singleton = null;
function getRuntimeDomainIsolationAuthority() { if (!singleton) singleton = new RuntimeDomainIsolationAuthority(); return singleton; }

module.exports = { AUTHORITY, SCHEMA_VERSION, RuntimeDomainIsolationAuthority, getRuntimeDomainIsolationAuthority };
