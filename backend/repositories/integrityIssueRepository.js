'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

function now() { return new Date().toISOString(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)]));
  return value;
}
function fingerprint(issue) {
  const identity = { ...issue };
  delete identity.severity;
  delete identity.at;
  delete identity.checkedAt;
  return crypto.createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex');
}

function record(issues = [], options = {}) {
  const store = options.store || getStore();
  const timestamp = now();
  const seen = new Set();
  let newCount = 0;
  store.transaction(() => {
    for (const issue of issues) {
      const fp = fingerprint(issue);
      seen.add(fp);
      const existing = store.db.prepare('SELECT occurrences, active FROM integrity_issue_aggregates WHERE fingerprint=?').get(fp);
      if (!existing || Number(existing.active || 0) === 0) newCount += 1;
      store.db.prepare(`
        INSERT INTO integrity_issue_aggregates(fingerprint, code, severity, domain, entity_id, detail_json, occurrences, active, first_seen_at, last_seen_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, '')
        ON CONFLICT(fingerprint) DO UPDATE SET
          severity=excluded.severity,
          domain=excluded.domain,
          entity_id=excluded.entity_id,
          detail_json=excluded.detail_json,
          occurrences=integrity_issue_aggregates.occurrences+1,
          active=1,
          last_seen_at=excluded.last_seen_at,
          resolved_at=''
      `).run(fp, String(issue.code || 'UNKNOWN'), String(issue.severity || 'high'), String(issue.domain || ''), String(issue.entityId || issue.contactId || issue.modelId || ''), JSON.stringify(issue), timestamp, timestamp);
    }
    const activeRows = store.db.prepare('SELECT fingerprint FROM integrity_issue_aggregates WHERE active=1').all();
    for (const row of activeRows) {
      if (!seen.has(row.fingerprint)) store.db.prepare('UPDATE integrity_issue_aggregates SET active=0, resolved_at=?, last_seen_at=? WHERE fingerprint=?').run(timestamp, timestamp, row.fingerprint);
    }
  });
  return { newCount, active: listActive(store), checkedAt: timestamp };
}

function listActive(store = getStore()) {
  return store.db.prepare(`
    SELECT fingerprint, code, severity, domain, entity_id AS entityId, detail_json,
           occurrences, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM integrity_issue_aggregates WHERE active=1
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, last_seen_at DESC
  `).all().map(row => ({ ...row, detail: parseJson(row.detail_json, {}) || {}, occurrences: Number(row.occurrences || 0) }));
}

module.exports = { record, listActive, fingerprint };
