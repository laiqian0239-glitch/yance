'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { R32SqliteStore } = require('../lib/r32SqliteStore');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('conversation pages use a stable offset window without duplicates', t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-contact-pages-'));
  const store = new R32SqliteStore({ filePath: path.join(dataRoot, 'contacts.db') });
  t.after(() => {
    try { store.close(); } catch (_) {}
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (let index = 0; index < 6; index += 1) {
    store.upsertConversation({
      sessionKey: `conversation-${index}`,
      accountId: 'account-a',
      platform: 'telegram',
      title: `Contact ${index}`,
      lastMessageAt: new Date(Date.UTC(2026, 6, 30, 10, 0, index)).toISOString()
    });
  }

  const first = store.listConversations({ limit: 2, offset: 0 });
  const second = store.listConversations({ limit: 2, offset: 2 });
  const third = store.listConversations({ limit: 2, offset: 4 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(third.length, 2);
  assert.equal(new Set([...first, ...second, ...third].map(row => row.sessionKey)).size, 6);
});

test('workspace bootstrap exposes contact pagination and the UI lazy-loads additional pages', () => {
  const workspace = read('backend/services/workspaceService.js');
  const route = read('backend/routes/workspace.js');
  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(workspace, /conversationOffset/u);
  assert.match(workspace, /pagination:\s*\{/u);
  assert.match(route, /conversationOffset/u);
  assert.match(ui, /loadMoreConversationSummaries/u);
  assert.match(ui, /conversationOffset/u);
  assert.match(ui, /contactList[\s\S]*?addEventListener\('scroll'/u);
});

test('partial refresh pages cannot delete contacts outside the fetched window and merge tombstones are removed explicitly', () => {
  const syncStability = require('../../frontend/js/r32-sync-stability');
  assert.equal(syncStability.isCompleteContactSnapshot({ pagination: { conversationOffset: 0, hasMore: true } }), false);
  assert.equal(syncStability.isCompleteContactSnapshot({ pagination: { conversationOffset: 0, hasMore: false } }), true);
  assert.deepEqual(syncStability.removedConversationIdsForEvent({
    type: 'conversation:merged',
    payload: { sourceConversationIds: ['source-a', 'source-b'], conversationId: 'target' }
  }), ['source-a', 'source-b']);
  assert.deepEqual(syncStability.removedConversationIdsForEvent({
    type: 'conversation:deleted',
    payload: { conversationId: 'deleted-a' }
  }), ['deleted-a']);

  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /isCompleteContactSnapshot/u);
  assert.match(ui, /removedConversationIdsForEvent/u);
});
