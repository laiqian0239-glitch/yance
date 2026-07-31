'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Telegram native expression authority uses the authenticated GramJS session', () => {
  const adapter = read('backend/services/telegramAdapter.js');
  assert.match(adapter, /async listNativeExpressions\(accountId, kind = 'sticker'/);
  assert.match(adapter, /new Api\.messages\.GetSavedGifs\(\{ hash: BigInt\(0\) \}\)/);
  assert.match(adapter, /new Api\.messages\.GetRecentStickers\(\{ hash: BigInt\(0\), attached: false \}\)/);
  assert.match(adapter, /row\.client\.downloadMedia\(media, \{\}\)/);
  assert.match(adapter, /source: 'telegram-native-library'/);
  assert.match(adapter, /async sendNativeExpression\(accountId, chatId, reference/);
  assert.match(adapter, /previewMode: isTgs \? 'format-icon'/);
  assert.match(adapter, /supportedSend: true/);
});

test('expression endpoint awaits native platform material aggregation', () => {
  const route = read('backend/routes/messages.js');
  const service = read('backend/services/expressionLibraryService.js');
  assert.match(route, /await expressionLibrary\.recent/);
  assert.match(service, /await platformDrivers\.call\('telegram', 'listNativeExpressions'/);
  assert.match(service, /nativePackBrowser: platform === 'telegram' && nativeLibrary\.available/);
});
