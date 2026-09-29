'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('legacy Facebook avatar proxy and Page adapter are retired behind Chatwoot and mautrix-meta authorities', () => {
  for (const rel of [
    'backend/services/facebookAdapter.js',
    'tools/facebook/deploy-avatar-proxy-routes.js',
    'docs/FACEBOOK_AVATAR_PROXY_DEPLOY_ZH.md',
  ]) assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `retired file must be absent: ${rel}`);

  for (const rel of [
    'backend/services/facebookRelayClient.js',
    'services/facebook-worker/src/desktopApi.js',
    'services/facebook-worker/src/media.js',
    'services/facebook-worker/src/webhook.js',
  ]) assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `retired relay file must be absent: ${rel}`);
  const legacySurface = [
    'backend/routes/accounts.js', 'backend/core/accountContext.js', 'backend/services/accountManagerCore.js',
    'backend/services/platformAdapterPorts.js', 'backend/services/runtimeArtifactBootstrapService.js',
    'shared/core/contracts.js', 'frontend/r32-account-center.js', 'frontend/js/core-client.js',
  ].map(read).join('\n');
  assert.doesNotMatch(legacySurface, /avatarClosure|avatar-closure|ACCOUNT_FACEBOOK_AVATAR_CLOSURE|Facebook Avatar Closure|facebook-avatar-diagnose|facebook-avatar-export/u);
  assert.doesNotMatch(read('backend/services/runtimeArtifactBootstrapService.js'), /facebookAdapter\.js/u);

  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /facebook-page-official[\s\S]*adapter:\s*facebookChatwoot/u);
  assert.match(registry, /facebook-personal-messenger-mautrix-meta[\s\S]*protocolAuthority:\s*'mautrix-meta'/u);
  assert.doesNotMatch(registry, /require\(['"]\.\/facebookAdapter['"]\)/u);
  assert.doesNotMatch(registry, /facebookRelayClient|cacheWebhookAttachments/u);
  assert.doesNotMatch(read('backend/services/accountManagerCore.js'), /async mediaTransfer\(/u);
  assert.doesNotMatch(read('backend/services/platformAdapterPorts.js'), /case ['"]media-transfer['"]/u);
  const workerIndex = read('services/facebook-worker/src/index.js');
  assert.doesNotMatch(workerIndex, /\/api\/desktop\/|webhooks\/facebook|persistedMediaResponse|cacheEventMedia/u);
  assert.doesNotMatch(read('backend/services/facebookOAuthService.js'), /facebookRelayClient/u);
});
