'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { FacebookRelayClient } = require('../services/facebookRelayClient');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Facebook history requests forward the caller AbortSignal and execution generation to the relay transport', async () => {
  const client = new FacebookRelayClient();
  const calls = [];
  client.request = async (...args) => { calls.push(args); return { data: [] }; };
  const controller = new AbortController();

  await client.history({ workerBaseUrl: 'https://relay.example' }, { limit: 3 }, {
    signal: controller.signal,
    executionGeneration: 'facebook-sync-generation-1'
  });
  await client.historyMessages({ workerBaseUrl: 'https://relay.example' }, 'conversation-1', { limit: 4 }, {
    signal: controller.signal,
    executionGeneration: 'facebook-sync-generation-1'
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].signal, controller.signal);
  assert.equal(calls[0][2].executionGeneration, 'facebook-sync-generation-1');
  assert.equal(calls[1][2].signal, controller.signal);
  assert.equal(calls[1][2].executionGeneration, 'facebook-sync-generation-1');
});

test('Facebook adapter passes its operation signal into every paged history transport call', () => {
  const source = read('backend/services/facebookAdapter.js');
  assert.match(source, /relayClient\.history\(secret,[\s\S]*?signal:\s*options\.signal[\s\S]*?executionGeneration/u);
  assert.match(source, /relayClient\.historyMessages\(secret,[\s\S]*?signal:\s*options\.signal[\s\S]*?executionGeneration/u);
});

test('WhatsApp manual sync forwards its operation signal into bulk avatar synchronization', () => {
  const source = read('backend/services/whatsappAdapter.js');
  assert.match(source, /avatarService\.syncWhatsAppContacts\(tasks,\s*\{[\s\S]*?signal:\s*options\.signal[\s\S]*?executionGeneration/u);
});
