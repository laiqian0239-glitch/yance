import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FacebookAdapter } = require('../../../backend/services/facebookAdapter.js');
const { getSecurityGuard } = require('../../../backend/core/securityGuardSingleton.js');
const securityGuard = getSecurityGuard();

function patch(t, object, key, value) {
  const original = object[key]; object[key] = value;
  t.after(() => { object[key] = original; });
}

test('FacebookAdapter rejects legacy Page Token-only credentials and requires Worker device identity', t => {
  const adapter = new FacebookAdapter();
  patch(t, securityGuard, 'readCredential', () => ({ pageId: 'page-1', pageAccessToken: 'legacy-token' }));
  assert.throws(() => adapter.credentials({ credentialRef: 'legacy' }), error => error.code === 'FACEBOOK_NOT_AUTHORIZED');
});

test('FacebookAdapter direct Graph transport is permanently fail-closed', async () => {
  const adapter = new FacebookAdapter();
  await assert.rejects(adapter.request('https://graph.facebook.com/v25.0/me'), error => error.code === 'FACEBOOK_DIRECT_GRAPH_FORBIDDEN' && error.status === 403);
});

test('Desktop Facebook source contains no send path that reads pageAccessToken', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../../backend/services/facebookAdapter.js'), 'utf8');
  assert.equal(/secret\.pageAccessToken/.test(source), false);
  assert.match(source, /relayClient\.send\(/);
  assert.match(source, /relayClient\.history\(/);
  assert.match(source, /relayClient\.downloadMedia\(/);
});

test('Local Express Facebook Webhook is disabled outside explicit test mode', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../../backend/routes/accounts.js'), 'utf8');
  assert.match(source, /FACEBOOK_WEBHOOK_MOVED_TO_CLOUDFLARE/);
  assert.match(source, /YANCE_FACEBOOK_LOCAL_WEBHOOK_TEST === '1'/);
  assert.match(source, /status\(410\)/);
});

test('Webhook ingestion never sends an automatic receipt or runs desktop AI', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/webhook.js'), 'utf8');
  assert.equal(/sendOperation|sendText|persona|relationship|aiReply|generateReply/i.test(source), false);
  assert.match(source, /cacheEventMedia/);
});

test('Worker repository contains examples only and no committed secret file', () => {
  const workerRoot = path.resolve(import.meta.dirname, '..');
  assert.equal(fs.existsSync(path.join(workerRoot, '.dev.vars')), false);
  assert.equal(fs.existsSync(path.join(workerRoot, '.env')), false);
  const example = fs.readFileSync(path.join(workerRoot, '.dev.vars.example'), 'utf8');
  for (const key of ['META_APP_ID', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'DESKTOP_AUTH_MASTER_KEY']) {
    assert.match(example, new RegExp(`^${key}=`, 'm'));
  }
  assert.equal(/access[_-]?token\s*=\s*['\"][A-Za-z0-9_-]{20,}/i.test(example), false);
});

test('Meta App ID remains Worker-only and is absent from Windows release configuration and OAuth start URL', () => {
  const releaseSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../../backend/services/releasePlatformAuth.js'), 'utf8');
  const platformSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../../backend/services/platformAuthConfig.js'), 'utf8');
  const oauthSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../../backend/services/facebookOAuthService.js'), 'utf8');
  const example = fs.readFileSync(path.resolve(import.meta.dirname, '../../../release/platform-auth.example.json'), 'utf8');
  assert.equal(/YANCE_FACEBOOK_APP_ID/.test(releaseSource), false);
  assert.equal(/facebook\?\.appId|input\.appId/.test(`${releaseSource}\n${platformSource}`), false);
  assert.equal(/searchParams\.set\(['"]app_id['"]/.test(oauthSource), false);
  assert.equal(/"appId"/.test(example), false);
});
