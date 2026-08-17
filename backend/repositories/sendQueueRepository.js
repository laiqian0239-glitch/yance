'use strict';

// WP-B M3 read-only command-custody projection.
//
// DurableExecutionAuthorityV2 and ExternalActionOutboxAuthority own execution,
// claiming, retry/reconciliation and terminal truth. This compatibility
// repository may only expose the historical send-command custody rows for
// reference resolution and UI projections; it owns no scheduler mutation.
const { getStore } = require('./storeProvider');

function get(id) { return getStore().getSendQueueItem(id); }
function list(options = {}) { return getStore().listSendQueue(options); }
function summary(options = {}) { return getStore().summarizeSendQueue(options); }

module.exports = { get, list, summary };
