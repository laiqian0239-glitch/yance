'use strict';

const { getStore } = require('./storeProvider');

function list(limit) { return getStore().listConversations({ limit }); }
function search(query, options = {}) { return getStore().searchMessages(String(query || ''), options); }
function storageStatus() {
  const store = getStore();
  const counts = store.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM r32_accounts) AS accounts,
      (SELECT COUNT(*) FROM contacts) AS contacts,
      (SELECT COUNT(*) FROM r32_conversations) AS conversations,
      (SELECT COUNT(*) FROM r32_messages) AS messages,
      (SELECT COUNT(*) FROM customer_profiles) AS customerProfiles,
      (SELECT COUNT(*) FROM relationship_insights) AS relationshipInsights
  `).get();
  return { engine: 'node:sqlite', dbPath: store.dbPath, schemaVersion: store.getMeta('schemaVersion', 0), counts };
}

module.exports = { list, search, storageStatus };
