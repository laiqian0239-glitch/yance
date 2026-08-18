'use strict';

// WP-B M3 read-only compatibility projection.
//
// The legacy background-job authority used to own SQL job state, retry waits,
// leases and restart recovery. Production callers now use Schema 23 durable
// execution/outbox authority. Preserve only stable state labels for the
// zero-importer transitional facade; no writer or recovery surface remains.

const STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  RETRY_WAIT: 'RETRY_WAIT',
  FAILED_FINAL: 'FAILED_FINAL',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED'
});

module.exports = Object.freeze({ STATES });
