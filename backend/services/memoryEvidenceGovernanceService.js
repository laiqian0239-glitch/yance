'use strict';

const SINGLE_VALUE_KEYS = new Set(['age', 'birthday', 'country', 'city', 'region', 'address', 'job', 'occupation', 'languages', 'family', 'company', 'timezone']);
const VALID_STATUSES = new Set(['confirmed', 'inferred', 'conflicted', 'superseded', 'forgotten', 'rejected']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function nowIso(options = {}) { return clean(options.now) || new Date().toISOString(); }
function normalizeKey(value) { return clean(value).toLowerCase().replace(/[\s.-]+/gu, '_'); }
function normalizeValue(value) {
  const raw = Array.isArray(value) ? value.map(clean).filter(Boolean).join('、') : clean(value);
  return raw.normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
}
function evidenceRows(row = {}) { return array(row.evidence).filter(Boolean); }
function isPeerInboundEvidence(row = {}) {
  const direction = clean(row.direction).toLowerCase();
  const speaker = clean(row.speaker || row.role).toLowerCase();
  const messageId = clean(row.platformMessageId || row.messageId || row.sourceMessageId);
  const sourceText = clean(row.sourceText || row.text || row.quote);
  return direction === 'inbound' && speaker === 'peer' && Boolean(messageId && sourceText);
}
function hasVerifiedEvidence(row = {}) {
  if (isPeerInboundEvidence(row)) return true;
  return evidenceRows(row).some(isPeerInboundEvidence);
}
function lifecycleStatus(row = {}) {
  const status = clean(row.status).toLowerCase();
  if (VALID_STATUSES.has(status)) return status;
  return row.factClass === 'inference' || Number(row.confidence || 0) < 100 ? 'inferred' : 'confirmed';
}
function isExpired(row = {}, options = {}) {
  const expiresAt = clean(row.expiresAt);
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.parse(nowIso(options));
}
function normalizeFact(row = {}, options = {}) {
  const timestamp = nowIso(options);
  const key = normalizeKey(row.key || row.factKey || row.field);
  const value = Array.isArray(row.value) ? row.value.map(clean).filter(Boolean).join('、') : clean(row.value || row.factValue || row.text);
  const status = lifecycleStatus(row);
  const verifiedEvidence = hasVerifiedEvidence(row);
  const factClass = clean(row.factClass).toLowerCase() || (status === 'inferred' ? 'inference' : 'explicit');
  const allowInReply = row.allowInReply !== undefined
    ? row.allowInReply === true
    : status === 'confirmed' && factClass === 'explicit' && verifiedEvidence;
  return {
    ...row,
    key,
    value,
    status,
    factClass,
    confidence: Math.max(0, Math.min(100, Number(row.confidence ?? (status === 'confirmed' ? 100 : 50)))),
    evidenceStatus: verifiedEvidence ? 'verified' : clean(row.evidenceStatus) || 'missing',
    allowInReply,
    firstSeenAt: clean(row.firstSeenAt || row.confirmedAt || row.createdAt) || timestamp,
    lastSeenAt: clean(row.lastSeenAt || row.confirmedAt || row.updatedAt) || timestamp,
    lastVerifiedAt: verifiedEvidence ? clean(row.lastVerifiedAt || row.confirmedAt || row.updatedAt) || timestamp : clean(row.lastVerifiedAt),
    expiresAt: clean(row.expiresAt),
    forgottenAt: clean(row.forgottenAt),
    correctedAt: clean(row.correctedAt),
    supersededAt: clean(row.supersededAt),
    conflictKey: key,
    governanceVersion: 1,
    revision: Math.max(1, Number(row.revision || 1))
  };
}
function dedupeEvidence(rows = []) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row) continue;
    const messageId = clean(row.platformMessageId || row.messageId || row.sourceMessageId);
    const sourceText = clean(row.sourceText || row.text);
    const identity = `${messageId}\u001f${sourceText}`;
    if ((!messageId && !sourceText) || seen.has(identity)) continue;
    seen.add(identity);
    result.push(row);
  }
  return result.slice(-20);
}
function mergeFacts(existing = [], incoming = [], options = {}) {
  const timestamp = nowIso(options);
  const output = array(existing).filter(Boolean).map(row => normalizeFact(row, { now: timestamp }));
  for (const raw of array(incoming)) {
    if (!raw) continue;
    const row = normalizeFact(raw, { now: timestamp });
    if (!row.key || !row.value) continue;
    const exact = output.findIndex(current => current.key === row.key && normalizeValue(current.value) === normalizeValue(row.value));
    if (exact >= 0) {
      const previous = output[exact];
      output[exact] = normalizeFact({
        ...previous,
        ...row,
        evidence: dedupeEvidence([...evidenceRows(previous), ...evidenceRows(row)]),
        confidence: Math.max(Number(previous.confidence || 0), Number(row.confidence || 0)),
        firstSeenAt: clean(previous.firstSeenAt) || row.firstSeenAt,
        lastSeenAt: timestamp,
        lastVerifiedAt: row.evidenceStatus === 'verified' ? timestamp : previous.lastVerifiedAt,
        revision: Math.max(Number(previous.revision || 1), Number(row.revision || 1)) + 1
      }, { now: timestamp });
      continue;
    }
    if (SINGLE_VALUE_KEYS.has(row.key) && row.status === 'confirmed') {
      for (let index = 0; index < output.length; index += 1) {
        const previous = output[index];
        if (previous.key !== row.key || previous.status !== 'confirmed') continue;
        output[index] = normalizeFact({
          ...previous,
          status: 'superseded',
          allowInReply: false,
          supersededAt: timestamp,
          supersededBy: clean(row.id),
          revision: Number(previous.revision || 1) + 1
        }, { now: timestamp });
      }
    }
    output.push(row);
  }
  return output.slice(-200);
}
function forgetFact(rows = [], factId, options = {}) {
  const timestamp = nowIso(options);
  return array(rows).map(row => {
    if (clean(row.id) !== clean(factId)) return row;
    return normalizeFact({ ...row, status: 'forgotten', allowInReply: false, forgottenAt: timestamp, forgottenBy: clean(options.actor || 'user'), revision: Number(row.revision || 1) + 1 }, { now: timestamp });
  });
}
function correctFact(rows = [], factId, correction = {}, options = {}) {
  const timestamp = nowIso(options);
  const revised = array(rows).map(row => {
    if (clean(row.id) !== clean(factId)) return row;
    return normalizeFact({ ...row, status: 'superseded', allowInReply: false, supersededAt: timestamp, correctedAt: timestamp, revision: Number(row.revision || 1) + 1 }, { now: timestamp });
  });
  return mergeFacts(revised, [{ ...correction, status: 'confirmed', factClass: 'explicit', correctedAt: timestamp, correctionOf: clean(factId), allowInReply: true }], { now: timestamp });
}
function selectReplyFacts(rows = [], options = {}) {
  const timestamp = nowIso(options);
  const cooldownMs = Math.max(0, Number(options.cooldownMs || 6 * 60 * 60 * 1000));
  const now = Date.parse(timestamp);
  return array(rows)
    .map(row => normalizeFact(row, { now: timestamp }))
    .filter(row => row.status === 'confirmed' && row.factClass === 'explicit')
    .filter(row => row.allowInReply === true && row.evidenceStatus === 'verified')
    .filter(row => !isExpired(row, { now: timestamp }))
    .filter(row => {
      const lastUsed = Date.parse(clean(row.lastUsedInReplyAt));
      return !Number.isFinite(lastUsed) || !cooldownMs || now - lastUsed >= cooldownMs;
    })
    .sort((a, b) => Date.parse(clean(b.lastVerifiedAt || b.lastSeenAt)) - Date.parse(clean(a.lastVerifiedAt || a.lastSeenAt)));
}
function markFactsUsed(rows = [], factIds = [], options = {}) {
  const ids = new Set(array(factIds).map(clean).filter(Boolean));
  const timestamp = nowIso(options);
  return array(rows).map(row => ids.has(clean(row.id))
    ? normalizeFact({ ...row, lastUsedInReplyAt: timestamp, replyUsageCount: Number(row.replyUsageCount || 0) + 1, revision: Number(row.revision || 1) + 1 }, { now: timestamp })
    : row);
}

module.exports = {
  SINGLE_VALUE_KEYS,
  normalizeFact,
  mergeFacts,
  forgetFact,
  correctFact,
  selectReplyFacts,
  markFactsUsed,
  hasVerifiedEvidence,
  isPeerInboundEvidence,
  isExpired,
  normalizeKey,
  normalizeValue
};
