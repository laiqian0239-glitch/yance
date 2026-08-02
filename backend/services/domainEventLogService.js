'use strict';

const canonicalEventLedgerAuthority = require('./canonicalEventLedgerAuthority');

const AUTHORITY = canonicalEventLedgerAuthority.AUTHORITY;
const SCHEMA_VERSION = canonicalEventLedgerAuthority.SCHEMA_VERSION;
const REDACTION_VERSION = canonicalEventLedgerAuthority.REDACTION_VERSION;
const MAX_REDACTION_DEPTH = canonicalEventLedgerAuthority.MAX_REDACTION_DEPTH;
const MAX_REDACTION_NODES = canonicalEventLedgerAuthority.MAX_REDACTION_NODES;
const MAX_EVENT_PAYLOAD_BYTES = canonicalEventLedgerAuthority.MAX_EVENT_PAYLOAD_BYTES;

function authorityError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function assertCanonicalAuthorityBinding(authority) {
  if (!authority || (typeof authority !== 'object' && typeof authority !== 'function')) {
    throw authorityError(
      'CANONICAL_EVENT_LEDGER_AUTHORITY_REQUIRED',
      'DomainEventLogService requires the canonical ledger authority'
    );
  }
  if (authority instanceof canonicalEventLedgerAuthority.CanonicalEventLedgerAuthority) {
    const authorityTransactionCoordinator = authority.coordinator;
    if (!authorityTransactionCoordinator || typeof authorityTransactionCoordinator.execute !== 'function') {
      throw authorityError(
        'CANONICAL_EVENT_LEDGER_COORDINATOR_REQUIRED',
        'Canonical ledger authority is not bound to AuthorityTransactionCoordinator'
      );
    }
  }
  return authority;
}

function invokeCanonicalAuthority(authority, methodName, argument) {
  const method = authority?.[methodName];
  if (typeof method !== 'function') {
    throw authorityError(
      'CANONICAL_EVENT_LEDGER_CAPABILITY_REQUIRED',
      `Canonical ledger authority does not expose ${methodName}`
    );
  }
  return Reflect.apply(method, authority, [argument]);
}

class DomainEventLogService {
  constructor(options = {}) {
    // Compatibility facades never construct a ledger or resolve a primary
    // store. Without an explicitly supplied test authority they delegate to
    // the single runtime-configured canonical authority facade.
    const canonicalAuthority = assertCanonicalAuthorityBinding(
      options.canonicalAuthority || canonicalEventLedgerAuthority.singleton
    );
    Object.defineProperty(this, 'canonicalAuthority', {
      value: canonicalAuthority,
      enumerable: true,
      writable: false,
      configurable: false
    });
    Object.freeze(this);
  }

  append(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'append', input);
  }

  readEvent(eventId) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'readEvent', eventId);
  }

  recordShadowProjection(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'recordShadowProjection', input);
  }

  recordAppliedProjection(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'recordAppliedProjection', input);
  }

  convergence(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'convergence', input);
  }

  assertConverged(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'assertConverged', input);
  }

  recordProjectionFailure(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'recordProjectionFailure', input);
  }

  replay(input = {}) {
    return invokeCanonicalAuthority(this.canonicalAuthority, 'replay', input);
  }
}
Object.freeze(DomainEventLogService.prototype);

const singleton = new DomainEventLogService();

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
