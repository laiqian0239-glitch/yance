'use strict';

const fs = require('node:fs');

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: source block is ambiguous`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function repairMessageRepository() {
  const targetPath = 'backend/repositories/messageRepository.js';
  let source = fs.readFileSync(targetPath, 'utf8');

  source = replaceExact(source, "const crypto = require('node:crypto');\n", '', 'remove legacy job token dependency');

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

  source = replaceExact(
    source,
    ': appendInboundEventWithProjectionJob(store, {',
    ': domainEventLog.append({',
    'route ingress append through canonical ledger'
  );
  source = replaceExact(
    source,
    '  let projectionReceipt = null;\n  let projectionClaim = null;\n',
    '  let projectionReceipt = null;\n',
    'remove legacy projection claim state'
  );
  source = replaceExact(
    source,
    `  if (authoritativeDomainEvent?.event?.eventId) {
    projectionClaim = store.transaction(() => claimProjectionJob(store, authoritativeDomainEvent.event.eventId));
  }
`,
    '',
    'remove legacy projection job claim'
  );
  source = replaceExact(
    source,
    `        settleProjectionJobWithinTransaction(store, projectionClaim, 'applied');
`,
    '',
    'remove legacy applied checkpoint'
  );
  source = replaceExact(
    source,
    `      } catch (receiptError) {
        logger.error('domain-event', 'projection-failure-receipt-write-failed', {
          eventId: authoritativeDomainEvent.event.eventId,
          messageId: message.id,
          code: receiptError.code || 'PROJECTION_FAILURE_RECEIPT_FAILED',
          error: receiptError.message
        });
      }
`,
    `      } catch (receiptError) {
        throw Object.assign(receiptError, {
          code: receiptError.code || 'PROJECTION_FAILURE_RECEIPT_FAILED',
          projectionCause: cause,
          eventId: authoritativeDomainEvent.event.eventId,
          messageId: message.id
        });
      }
`,
    'fail closed when canonical failure receipt cannot commit'
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
}

function repairPlatformCoreRepository() {
  const targetPath = 'backend/repositories/platformCoreRepository.js';
  let source = fs.readFileSync(targetPath, 'utf8');

  source = replaceExact(
    source,
    "const { parseJson } = require('../lib/r32SqliteStore');\n",
    "const { parseJson } = require('../lib/r32SqliteStore');\nconst { canonicalHash } = require('../services/canonicalSerialization');\n",
    'bind canonical checkpoint hash authority'
  );
  source = replaceExact(
    source,
    `function json(value, fallback = '{}') {
  try { return JSON.stringify(value == null ? JSON.parse(fallback) : value); } catch (_) { return fallback; }
}
`,
    `function json(value, fallback = '{}') {
  try { return JSON.stringify(value == null ? JSON.parse(fallback) : value); } catch (_) { return fallback; }
}
function projectionCheckpointOutputHash(input = {}, ledgerSequence) {
  const explicitHash = clean(input.projectionHash).toLowerCase();
  if (/^[a-f0-9]{64}$/u.test(explicitHash)) return explicitHash;
  return canonicalHash({
    contractVersion: 1,
    projectorName: clean(input.projectorName),
    projectorVersion: clean(input.projectorVersion),
    eventId: clean(input.eventId),
    ledgerSequence,
    projectionStatus: clean(input.projectionStatus),
    failureCode: clean(input.failureCode),
    failureReason: clean(input.failureReason),
    targetRefs: input.targetRefs == null ? [] : input.targetRefs,
    attempt: Number(input.attempt || 1)
  });
}
`,
    'derive deterministic non-applied checkpoint hash'
  );
  source = replaceExact(
    source,
    `        clean(input.projectorName), clean(input.projectorVersion), ledgerSequence, token.hostId, token.hostGeneration, token.fencingToken,
        clean(input.projectionHash), 0, clean(input.projectedAt)
`,
    `        clean(input.projectorName), clean(input.projectorVersion), ledgerSequence, token.hostId, token.hostGeneration, token.fencingToken,
        projectionCheckpointOutputHash(input, ledgerSequence), 0, clean(input.projectedAt)
`,
    'write deterministic checkpoint output hash'
  );

  if ((source.match(/projectionCheckpointOutputHash\(/gu) || []).length !== 2) {
    throw new Error('checkpoint output hash authority must have one definition and one use');
  }
  fs.writeFileSync(targetPath, source, 'utf8');
}

repairMessageRepository();
repairPlatformCoreRepository();
