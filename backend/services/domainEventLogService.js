'use strict';

const canonicalEventLedgerAuthority = require('./canonicalEventLedgerAuthority');

const AUTHORITY = canonicalEventLedgerAuthority.AUTHORITY;
const SCHEMA_VERSION = canonicalEventLedgerAuthority.SCHEMA_VERSION;
const REDACTION_VERSION = canonicalEventLedgerAuthority.REDACTION_VERSION;
const MAX_REDACTION_DEPTH = canonicalEventLedgerAuthority.MAX_REDACTION_DEPTH;
const MAX_REDACTION_NODES = canonicalEventLedgerAuthority.MAX_REDACTION_NODES;
const MAX_EVENT_PAYLOAD_BYTES = canonicalEventLedgerAuthority.MAX_EVENT_PAYLOAD_BYTES;

class DomainEventLogService {
  constructor(options = {}) {
    this.canonicalAuthority = canonicalEventLedgerAuthority.createCanonicalEventLedgerAuthority(options);
  }

  append(input = {}) {
    return this.canonicalAuthority.append(input);
  }

  readEvent(eventId) {
    return this.canonicalAuthority.readEvent(eventId);
  }

  recordShadowProjection(input = {}) {
    return this.canonicalAuthority.recordShadowProjection(input);
  }

  recordAppliedProjection(input = {}) {
    return this.canonicalAuthority.recordAppliedProjection(input);
  }

  convergence(input = {}) {
    return this.canonicalAuthority.convergence(input);
  }

  assertConverged(input = {}) {
    return this.canonicalAuthority.assertConverged(input);
  }

  recordProjectionFailure(input = {}) {
    return this.canonicalAuthority.recordProjectionFailure(input);
  }

  replay(input = {}) {
    return this.canonicalAuthority.replay(input);
  }
}

const singleton = new DomainEventLogService({
  canonicalAuthority: canonicalEventLedgerAuthority.singleton
});

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  REDACTION_VERSION,
  MAX_REDACTION_DEPTH,
  MAX_REDACTION_NODES,
  MAX_EVENT_PAYLOAD_BYTES,
  DomainEventLogService,
  singleton,
  canonicalEventLedgerAuthority,
  canonical: canonicalEventLedgerAuthority.canonical,
  sha256: canonicalEventLedgerAuthority.sha256,
  redactPayload: canonicalEventLedgerAuthority.redactPayload
};
