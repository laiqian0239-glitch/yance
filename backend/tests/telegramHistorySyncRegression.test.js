'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

test('Telegram production authority is mautrix-telegram and the retired protocol owner stays absent', () => {
  assert.equal(exists('backend/services/telegramAdapter.js'), false);
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /'telegram-personal-mautrix-telegram'/u);
  assert.match(registry, /protocolAuthority:\s*'mautrix-telegram'/u);
  assert.doesNotMatch(registry, /require\(['"]\.\/telegramAdapter['"]\)/u);
});

test('Telegram durable login and history are bridge-owned', () => {
  const config = read('config/matrix/mautrix-telegram/config.yaml');
  assert.match(config, /database:[\s\S]{0,140}uri:\s*\/data\/mautrix-telegram\.db/u);
  assert.match(config, /backfill:\s*\n\s+enabled:\s*true\b/u);
  assert.match(config, /max_initial_messages:\s*[1-9][0-9]*/u);
  assert.match(config, /max_catchup_messages:\s*[1-9][0-9]*/u);
});

test('frozen Telegram runtime materializes mature backfill config instead of a Yance history replay engine', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const start = compose.indexOf('  mautrix-telegram-registration:');
  const end = compose.indexOf('\n  synapse:', start);
  assert.ok(start >= 0 && end > start);
  const registration = compose.slice(start, end);
  assert.match(registration, /\.backfill = load\("\/bootstrap\/config\.yaml"\)\.backfill/u);
  assert.doesNotMatch(compose, /YANCE_MAUTRIX_TELEGRAM_BACKFILL__ENABLED/u);
});

test('Telegram Product capability copy delegates receive state to mautrix and Matrix', () => {
  const caps = read('backend/services/platformCapabilities.js');
  const start = caps.indexOf('  telegram: Object.freeze({');
  const end = caps.indexOf('\n  facebook: Object.freeze({', start);
  const telegram = caps.slice(start, end);
  assert.match(telegram, /mautrix-telegram/u);
  assert.match(telegram, /Matrix/u);
  assert.doesNotMatch(telegram, /GramJS|MTProto|Telegram receive pipeline|attachTypingHandler/u);
});

test('Telegram history renders through Element RoomView instead of a Product shadow timeline', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /renderRoomView\(session\.activeMatrixRoomId/u);
  assert.doesNotMatch(shell, /telegram-history-sync|recentMessages\.map\([\s\S]*yance-product-conversation__room-view/u);
});
