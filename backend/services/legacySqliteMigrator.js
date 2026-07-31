'use strict';

// Compatibility export. Legacy database reads are migration-only and are not
// available to runtime services.
module.exports = require('../migrations/legacySqliteMigrator');
