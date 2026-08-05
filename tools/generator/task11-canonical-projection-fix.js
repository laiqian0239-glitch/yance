'use strict';

const fs = require('node:fs');

const targetPath = 'backend/repositories/messageRepository.js';
let source = fs.readFileSync(targetPath, 'utf8');

function replaceExact(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: source block is ambiguous`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

replaceExact("const crypto = require('node:crypto');\n", '', 'remove legacy job token dependency');

const legacyHelpersStart = source.indexOf('function projectionRetry(');
const legacyHelpersEnd = source.indexOf('function clone(value)', legacyHelpersStart);
if (legacyHelpersStart < 0 || legacyHelpersEnd <= legacyHelpersStart) {
  throw new Error('legacy projection job helper boundary not found');
}
const canonicalHelpers = `function existingAuthoritativeDomainEvent(eventId) {
  const canonicalEventId = String(eventId || '').trim();
  const event = domainEventLog.readEvent(canonicalEventId);
  if (!event) throw Object.assign(new Error('Authoritative canonical event for projection replay was not found'), {
    code: 'DOMAIN_EVENT_NOT_FOUND', status: 404, eventId: canonicalEventId
  });
  return { created: false, event };
}

`;
source = `${source.slice(0, legacyHelpersStart)}${canonicalHelpers}${source.slice(legacyHelpersEnd)}`;

replaceExact(
  ': appendInboundEventWithProjectionJob(store, {',
  ': domainEventLog.append({',
  'route ingress append through canonical ledger'
);

replaceExact(
  '  let projectionReceipt = null;\n  let projectionClaim = null;\n',
  '  let projectionReceipt = null;\n',
  'remove legacy projection claim state'
);

replaceExact(
  `  if (authoritativeDomainEvent?.event?.eventId) {
    projectionClaim = store.transaction(() => claimProjectionJob(store, authoritativeDomainEvent.event.eventId));
  }
`,
  '',
  'remove legacy projection job claim'
);

replaceExact(
  `        settleProjectionJobWithinTransaction(store, projectionClaim, 'applied');
`,
  '',
  'remove legacy applied checkpoint'
);

const catchStart = source.indexOf("    if (authoritativeDomainEvent?.event?.eventId && projectionClaim && !projectionClaim.applied) {");
const pendingMarker = source.indexOf('      const pending = {', catchStart);
if (catchStart < 0 || pendingMarker <= catchStart) {
  throw new Error('legacy failed projection job settlement boundary not found');
}
source = `${source.slice(0, catchStart)}    if (authoritativeDomainEvent?.event?.eventId) {\n${source.slice(pendingMarker)}`;

for (const forbidden of [
  'domain_event_projection_jobs',
  'claimProjectionJob(',
  'settleProjectionJobWithinTransaction(',
  'recoverExpiredProjectionJob(',
  'appendInboundEventWithProjectionJob(',
  'projectionClaim'
]) {
  if (source.includes(forbidden)) throw new Error(`legacy projection path remains: ${forbidden}`);
}
if (!source.includes('domainEventLog.recordProjectionFailure({')) {
  throw new Error('canonical failure receipt path is missing');
}
if (!source.includes(': domainEventLog.append({')) {
  throw new Error('canonical append path is missing');
}

fs.writeFileSync(targetPath, source, 'utf8');
