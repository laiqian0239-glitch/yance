'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-chat-export-repository-'));
process.env.YANCE_DATA_DIR = root;
process.env.WORKBUDDY_DATA_DIR = root;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../../backend/services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../../backend/lib/sqliteConnectionBroker');

const dbPath = path.join(root, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `chat-export-repository-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const { getR32Store, closeR32Store } = require('../../backend/lib/r32StoreSingleton');
const repository = require('../../backend/repositories/messageRepository');

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.WORKBUDDY_DATA_DIR;
  delete process.env.YANCE_DATA_DIR;
});

test('repository export reader returns the complete ordered conversation beyond UI page limits', () => {
  const store = getR32Store();
  store.upsertConversation({ sessionKey: 'conversation:all', title: 'Complete', platform: 'whatsapp' });
  for (let index = 0; index < 320; index += 1) {
    const value = String(index).padStart(3, '0');
    store.upsertMessage({
      id: `message-${value}`,
      sessionKey: 'conversation:all',
      sentAt: `2026-01-${String(1 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      direction: index % 2 ? 'outbound' : 'inbound',
      text: `message ${value}`,
      senderName: index % 2 ? 'Me' : 'Friend',
      apiSessionToken: `must-not-be-rendered-${value}`
    });
  }
  const page = repository.listMessages('conversation:all', { limit: 500 });
  assert.equal(page.length, 250, 'UI read remains capped by the performance policy');
  const exported = repository.listMessagesForExport('conversation:all', { limit: 321 });
  assert.equal(exported.length, 320);
  assert.equal(exported[0].text, 'message 000');
  assert.equal(exported.at(-1).text, 'message 319');
  assert.equal(exported[0].conversationId, 'conversation:all');
});

test('authoritative columns override conflicting payload fields', () => {
  const store = getR32Store();
  store.upsertConversation({ sessionKey: 'conversation:authority', title: 'Authority' });
  store.db.prepare(`
    INSERT INTO r32_messages(
      id,session_key,account_id,sender_id,role,direction,message_type,text,media_url,media_path,
      quoted_message_id,delivery_status,sent_at,payload_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'authority-message','conversation:authority','account','sender','user','inbound','text','authoritative text','','',
    '','delivered','2026-01-01T00:00:00.000Z',JSON.stringify({ text: 'payload conflict', direction: 'outbound', messageType: 'video' }),
    '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'
  );
  const [message] = repository.listMessagesForExport('conversation:authority');
  assert.equal(message.text, 'authoritative text');
  assert.equal(message.direction, 'inbound');
  assert.equal(message.messageType, 'text');
});
