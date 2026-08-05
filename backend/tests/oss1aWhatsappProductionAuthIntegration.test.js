'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapterPath = path.join(__dirname, '../services/whatsappAdapter.js');
const compositionPath = path.join(__dirname, '../runtime/AppRuntimeComposition.js');

function source(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function startBlock(adapterSource) {
  const start = adapterSource.indexOf('  async start(');
  const stop = adapterSource.indexOf('\n  async stop(', start);
  assert.ok(start >= 0, 'WhatsAppAdapter.start() must exist');
  assert.ok(stop > start, 'WhatsAppAdapter.stop() must follow start()');
  return adapterSource.slice(start, stop);
}

test('production WhatsApp socket uses only repository-backed AuthenticationState', () => {
  const adapterSource = source(adapterPath);
  const block = startBlock(adapterSource);

  assert.doesNotMatch(
    adapterSource,
    /useMultiFileAuthState\s*\(/u,
    'production code must not retain a callable multi-file auth authority'
  );
  assert.match(adapterSource, /createWhatsAppAuthStateRepository/u);
  assert.match(adapterSource, /createWhatsAppAuthStateStore/u);
  assert.match(block, /authStateStore\.open\s*\(/u);

  const openPosition = block.search(/authStateStore\.open\s*\(/u);
  const socketPosition = block.search(/socketFactory\.create\s*\(|createSocket\s*\(/u);
  assert.ok(openPosition >= 0, 'auth lease must open inside start()');
  assert.ok(socketPosition > openPosition, 'auth lease must open before any socket creation');
  assert.doesNotMatch(block, /authDir|mkdirSync\s*\([^)]*auth/u);
});

test('production composition injects the key and primary Store authorities used to open auth leases', () => {
  const adapterSource = source(adapterPath);
  const compositionSource = source(compositionPath);

  assert.match(adapterSource, /configureRuntimeAuthorities/u);
  assert.match(adapterSource, /whatsappAuthKeyAuthority/u);
  assert.match(adapterSource, /runtimeStoreProvider/u);
  assert.match(compositionSource, /configureRuntimeAuthorities\s*\(/u);
  assert.match(compositionSource, /whatsappAuthKeyAuthority/u);
  assert.match(compositionSource, /storeProvider/u);
});

test('socket receives the exact creds and keys returned by one auth lease with no fallback', () => {
  const adapterSource = source(adapterPath);
  const block = startBlock(adapterSource);

  assert.match(block, /const\s+authLease\s*=\s*await\s+authStateStore\.open/u);
  assert.match(block, /auth:\s*\{\s*creds:\s*authLease\.state\.creds,\s*keys:\s*authLease\.state\.keys/u);
  assert.match(block, /saveCreds:\s*authLease\.saveCreds/u);
  assert.doesNotMatch(block, /catch\s*\([^)]*\)\s*\{[^}]*useMultiFileAuthState/su);
  assert.doesNotMatch(block, /WHATSAPP_AUTH.*FALLBACK|file auth fallback|multi-file fallback/iu);
});
