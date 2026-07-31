'use strict';

// The repository layer is the only application layer allowed to own the
// low-level SQLite singleton. Domain services, adapters, routes and core
// modules must depend on repository APIs instead of the raw store.
const { getR32Store, closeR32Store } = require('../lib/r32StoreSingleton');

function getStore() { return getR32Store(); }
function closeStore() { return closeR32Store(); }

module.exports = { getStore, closeStore };
