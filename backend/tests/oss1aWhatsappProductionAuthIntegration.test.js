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

test('production WhatsApp socket uses only the composition-owned repository AuthenticationState', () => {
  const adapterSource = source(adapterPath);
  const block = startBlock(adapterSource);

  assert.doesNotMatch(
    adapterSource,
    /useMultiFileAuthState\s*\(/u,
    'production code must not retain a callable multi-file auth authority'
  );
  assert.doesNotMatch(
    adapterSource,
    /createWhatsAppAuthStateRepository/u,
    'adapter must consume the composition-owned auth repository instead of creating another authority'
  );
  assert.match(adapterSource, /createWhatsAppAuthStateStore/u);
  assert.match(block, /createWhatsAppAuthStateStore\(\{\s*repository:\s*this\.authRepository/u);
  assert.match(block, /authStateStore\.open\s*\(/u);

  const openPosition = block.search(/authStateStore\.open\s*\(/u);
  const socketPosition = block.search(/socketFactory\.create\s*\(|createSocket\s*\(/u);
  assert.ok(openPosition >= 0, 'auth lease must open inside start()');
  assert.ok(socketPosition > openPosition, 'auth lease must open before any socket creation');
  assert.doesNotMatch(block, /authDir|mkdirSync\s*\([^)]*auth/u);
});

test('production composition creates and injects exactly one auth repository authority', () => {
  const adapterSource = source(adapterPath);
  const compositionSource = source(compositionPath);

  assert.match(adapterSource, /configureRuntimeAuthorities/u);
  assert.match(adapterSource, /this\.authRepository/u);
  assert.match(compositionSource, /createWhatsAppAuthStateRepository/u);
  assert.match(
    compositionSource,
    /const\s+whatsappAuthRepository\s*=\s*createWhatsAppAuthStateRepository\s*\(/u
  );
  assert.match(compositionSource, /authRepository:\s*whatsappAuthRepository/u);
  assert.match(compositionSource, /whatsappAuthKeyAuthority/u);
  assert.match(compositionSource, /storeProvider/u);
});

test('production composition upgrades durable projection jobs to canonical event authority before runtime services', () => {
  const compositionSource = source(compositionPath);
  assert.match(compositionSource, /ensureCanonicalProjectionJobSchema\s*\(\s*authorityStore\s*\)/u);
  const schemaPosition = compositionSource.search(/ensureCanonicalProjectionJobSchema\s*\(\s*authorityStore\s*\)/u);
  const accountContextPosition = compositionSource.indexOf('new AccountContext(');
  assert.ok(schemaPosition >= 0);
  assert.ok(accountContextPosition > schemaPosition, 'canonical projection job schema must be ready before runtime participants');
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
