'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const eventBus = require('./eventBus');

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  messagePageSize: 120,
  streamChunkSize: 40,
  maxMessagesPerConversation: 800,
  maxCachedConversations: 8,
  inactiveConversationRetain: 80,
  softMemoryLimitMb: 768,
  updatedAt: ''
});

const store = new SqliteDocumentStore('performance-settings', DEFAULTS);

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}

function normalize(value = {}) {
  return {
    ...DEFAULTS,
    ...value,
    schemaVersion: 1,
    messagePageSize: integer(value.messagePageSize, DEFAULTS.messagePageSize, 40, 250),
    streamChunkSize: integer(value.streamChunkSize, DEFAULTS.streamChunkSize, 10, 100),
    maxMessagesPerConversation: integer(value.maxMessagesPerConversation, DEFAULTS.maxMessagesPerConversation, 240, 2000),
    maxCachedConversations: integer(value.maxCachedConversations, DEFAULTS.maxCachedConversations, 2, 20),
    inactiveConversationRetain: integer(value.inactiveConversationRetain, DEFAULTS.inactiveConversationRetain, 0, 250),
    softMemoryLimitMb: integer(value.softMemoryLimitMb, DEFAULTS.softMemoryLimitMb, 256, 4096),
    updatedAt: String(value.updatedAt || '').slice(0, 64)
  };
}

function read() {
  return normalize(store.read());
}

async function update(patch = {}) {
  const allowed = {};
  for (const key of ['messagePageSize', 'streamChunkSize', 'maxMessagesPerConversation', 'maxCachedConversations', 'inactiveConversationRetain', 'softMemoryLimitMb']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  }
  const next = await store.update(current => normalize({ ...current, ...allowed, updatedAt: new Date().toISOString() }));
  eventBus.publish('system:performance-updated', next);
  return next;
}

module.exports = { read, update, normalize, DEFAULTS };
