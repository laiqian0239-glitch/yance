'use strict';

// WP-B M3 compatibility tombstone.
//
// The legacy JobQueue implementation owned an independent in-memory queue,
// provider retry/circuit timers, physical persistence writes and recovery.
// Production callers were cut over to the Schema 23 durable execution/outbox
// authority before this module was retired. Keep this exact source path only so
// the transitional facade can remain loadable while owning no execution,
// scheduling, retry, persistence, recovery or physical-I/O authority.

module.exports = Object.freeze({});
