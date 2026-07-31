'use strict';

const settings = require('./settingsRepository');

function sqliteCounts() {
  return {
    accounts: settings.countTable('r32_accounts'),
    contacts: settings.countTable('contacts'),
    conversations: settings.countTable('r32_conversations'),
    messages: settings.countTable('r32_messages'),
    customerProfiles: settings.countTable('customer_profiles'),
    relationshipInsights: settings.countTable('relationship_insights'),
    queue: Number(require('./storeProvider').getStore().db.prepare("SELECT COUNT(*) AS count FROM r32_send_queue WHERE state IN ('pending','retry','sending','platform_accepted_local_pending','send_outcome_unknown')").get()?.count || 0)
  };
}
function storageStatus() {
  const counts = sqliteCounts();
  return { dbPath: settings.dbPath(), schemaVersion: settings.schemaVersion(), counts };
}

module.exports = { sqliteCounts, storageStatus };
