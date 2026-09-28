'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const activeFiles = [
  'backend/services/accountManagerCore.js',
  'backend/services/expressionLibraryService.js',
  'backend/services/featureFlags.js',
  'backend/services/mediaPipeline.js',
  'backend/services/platformCapabilities.js',
  'backend/services/systemCenterService.js',
  'backend/services/systemHealthAuthority.js',
];

test('active Product source has no retired Baileys protocol or recovery semantics', () => {
  const forbidden = /Baileys|baileysMediaEnvelope|downloadMediaMessage|WhatsApp receive pipeline|messages\.upsert|whatsappBaileysV2|baileys-download-error|hasCredentials\(account\)|whatsapp:(?:state|qr)|mapWhatsAppState|whatsappAuthKey/iu;
  for (const rel of activeFiles) assert.doesNotMatch(read(rel), forbidden, `${rel} must not retain retired Yance/Baileys authority semantics`);
});

test('Product diagnostics name mautrix-whatsapp as the WhatsApp connection authority', () => {
  const core = read('backend/services/accountManagerCore.js');
  assert.match(core, /mautrix-whatsapp/u);
  assert.doesNotMatch(core, /adapter\.hasCredentials|whatsapp:(?:state|qr)|mapWhatsAppState|whatsappAuthKey/u);
  const projection = read('backend/core/projections/storeProjectionCoordinator.js');
  const typing = read('backend/services/typingStateService.js');
  assert.doesNotMatch(projection, /whatsapp:state/u);
  assert.doesNotMatch(typing, /whatsapp:state/u);
  const center = read('backend/services/systemCenterService.js');
  assert.match(center, /mautrix-whatsapp/u);
  assert.doesNotMatch(center, /Baileys本地直连/u);
});

test('WhatsApp media/history capability copy delegates to mature bridge and Matrix instead of a Yance recovery pipeline', () => {
  const caps = read('backend/services/platformCapabilities.js');
  assert.match(caps, /mautrix-whatsapp/u);
  assert.match(caps, /authority: 'mautrix-whatsapp'/u);
  assert.match(caps, /Matrix/u);
  assert.doesNotMatch(caps, /Baileys|downloadMediaMessage|messages\.upsert|WhatsApp receive pipeline/iu);
  const expressions = read('backend/services/expressionLibraryService.js');
  assert.doesNotMatch(expressions, /baileysMediaEnvelope|WhatsApp 重新恢复/u);
});
