'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapterPath = path.join(__dirname, '../services/whatsappAdapter.js');

function adapterSource() {
  return fs.readFileSync(adapterPath, 'utf8');
}

function methodBlock(source, name, nextName = '') {
  const start = source.indexOf(`  async ${name}(`);
  assert.ok(start >= 0, `WhatsAppAdapter.${name}() must exist`);
  const end = nextName ? source.indexOf(`\n  async ${nextName}(`, start) : source.length;
  assert.ok(end > start, `WhatsAppAdapter.${name}() block must be bounded`);
  return source.slice(start, end);
}

test('auth lease close primitive is idempotent and records one terminal reason', async () => {
  const module = require('../services/whatsappAdapter');
  assert.equal(typeof module.closeWhatsAppAuthLease, 'function');

  let closeCalls = 0;
  const row = {
    authLease: {
      async close() {
        closeCalls += 1;
        return true;
      }
    },
    authLeaseClosed: false,
    authLeaseCloseReason: ''
  };

  assert.equal(await module.closeWhatsAppAuthLease(row, 'WHATSAPP_STOP'), true);
  assert.equal(await module.closeWhatsAppAuthLease(row, 'WHATSAPP_LOGOUT'), false);
  assert.equal(closeCalls, 1);
  assert.equal(row.authLeaseClosed, true);
  assert.equal(row.authLeaseCloseReason, 'WHATSAPP_STOP');
});

test('socket initialization failure closes the unpublished auth lease exactly once', () => {
  const source = adapterSource();
  const start = methodBlock(source, 'start', 'sync');
  assert.match(start, /authLease/u);
  assert.match(start, /catch\s*\([^)]*\)\s*\{[\s\S]*closeWhatsAppAuthLease\s*\([^,]+,\s*'WHATSAPP_SOCKET_INIT_FAILED'/u);
  assert.match(start, /throw/u);
});

test('replacement, stop and logout close the old lease before removing the runtime row', () => {
  const source = adapterSource();
  const prepare = methodBlock(source, 'prepareStartGeneration', 'start');
  const stop = methodBlock(source, 'stop', 'restart');

  assert.match(prepare, /await\s+this\.stop\s*\(/u);
  assert.match(stop, /await\s+closeWhatsAppAuthLease\s*\(row,\s*logout\s*\?\s*'WHATSAPP_LOGOUT'\s*:\s*'WHATSAPP_STOP'\)/u);

  const closePosition = stop.search(/closeWhatsAppAuthLease/u);
  const deletePosition = stop.search(/this\.accounts\.delete/u);
  assert.ok(closePosition >= 0 && deletePosition > closePosition, 'lease must close before the runtime row is removed');
});

test('terminal disconnect closes the lease while retryable transport rebuilds never reuse it', () => {
  const source = adapterSource();
  const start = methodBlock(source, 'start', 'sync');

  assert.match(start, /if\s*\(connection\s*===\s*'close'\)/u);
  assert.match(start, /await\s+closeWhatsAppAuthLease\s*\(row,\s*policy\.reasonCode\)/u);
  assert.match(start, /if\s*\(!policy\.autoReconnect\)\s*return/u);
  assert.match(start, /this\.start\s*\([^)]*authEpoch/u);
  assert.doesNotMatch(start, /authLease\s*:\s*row\.authLease/u);
});

test('all required lifecycle paths converge on the single close primitive', () => {
  const source = adapterSource();
  const calls = [...source.matchAll(/closeWhatsAppAuthLease\s*\(/gu)].length;
  assert.ok(calls >= 5, `expected at least five lifecycle close sites, found ${calls}`);
  assert.match(source, /WHATSAPP_SOCKET_INIT_FAILED/u);
  assert.match(source, /WHATSAPP_STOP/u);
  assert.match(source, /WHATSAPP_LOGOUT/u);
  assert.match(source, /policy\.reasonCode/u);
});
