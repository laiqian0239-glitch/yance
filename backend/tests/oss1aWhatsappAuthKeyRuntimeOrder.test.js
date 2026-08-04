'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSITION_PATH = path.join(__dirname, '..', 'runtime', 'AppRuntimeComposition.js');

function sourceText() {
  return fs.readFileSync(COMPOSITION_PATH, 'utf8');
}

function participantNames(source) {
  const match = source.match(/participants:\s*Object\.freeze\(\[([\s\S]*?)\]\)/u);
  assert.ok(match, 'production composition must expose a frozen participant list');
  return [...match[1].matchAll(/name:\s*'([^']+)'/gu)].map(value => value[1]);
}

test('production composition starts CredentialVault key authority immediately after SecurityGuard', () => {
  const source = sourceText();

  assert.match(
    source,
    /const\s*\{\s*createWhatsAppAuthKeyAuthority\s*\}\s*=\s*require\('\.\.\/services\/whatsappAuthKeyAuthority'\);/u,
    'production composition must import the sealed WhatsApp key authority factory'
  );
  assert.match(
    source,
    /const\s+whatsappAuthKeyAuthority\s*=\s*createWhatsAppAuthKeyAuthority\(\{\s*securityGuard,\s*credentials:\s*securityGuard\.credentials\s*\}\);/u,
    'production composition must bind the authority to SecurityGuard.credentials only'
  );
  assert.match(
    source,
    /\{\s*name:\s*'whatsapp-auth-key-authority',\s*service:\s*whatsappAuthKeyAuthority,\s*critical:\s*true\s*\}/u,
    'WhatsApp key authority must be a critical lifecycle participant'
  );

  const securityCreation = source.indexOf('const securityGuard = getSecurityGuard();');
  const authorityCreation = source.indexOf('const whatsappAuthKeyAuthority = createWhatsAppAuthKeyAuthority');
  const accountContextCreation = source.indexOf('const accountContext = new AccountContext');
  assert.ok(securityCreation >= 0);
  assert.ok(authorityCreation > securityCreation, 'authority must be created after SecurityGuard');
  assert.ok(accountContextCreation > authorityCreation, 'account context must not be created before key authority');

  const names = participantNames(source);
  const securityIndex = names.indexOf('security-guard');
  const authorityIndex = names.indexOf('whatsapp-auth-key-authority');
  assert.equal(authorityIndex, securityIndex + 1, 'key authority must start immediately after SecurityGuard');
  for (const later of [
    'ai-gateway',
    'recovery-manager',
    'account-lifecycle-saga',
    'account-context'
  ]) {
    assert.ok(
      names.indexOf(later) > authorityIndex,
      `${later} must start after the WhatsApp key authority`
    );
  }

  assert.match(
    source,
    /\n\s*whatsappAuthKeyAuthority,\n/u,
    'composition must expose the same authority instance for downstream capability binding'
  );
  assert.doesNotMatch(source, /WHATSAPP_AUTH_(?:KEY|DEK).*process\.env/iu);
  assert.doesNotMatch(source, /useMultiFileAuthState/u);
});
