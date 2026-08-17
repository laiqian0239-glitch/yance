'use strict';

// WP-B M3 read-only compatibility projection.
//
// The legacy async-operation authority used to own SQL lifecycle mutation and
// restart recovery. Production callers now use Schema 23 durable execution.
// Only stable state labels remain for the zero-importer transitional facade;
// no writer, schema, retry, recovery or timer surface is exported.

const STATES = Object.freeze({
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED'
});

const TERMINAL = new Set([
  STATES.SUCCEEDED,
  STATES.FAILED,
  STATES.CANCELLED,
  STATES.SUPERSEDED
]);

module.exports = Object.freeze({ STATES, TERMINAL });
