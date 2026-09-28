'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Facebook Page retires the Business Suite avatar companion and keeps Chatwoot as the only Page authority', () => {
  for (const rel of [
    'backend/services/facebookBusinessSuiteAvatarImportService.js',
    'backend/routes/facebookAvatarImportBridge.js',
    'tools/facebook-business-suite-avatar-importer',
  ]) assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `legacy companion must be absent: ${rel}`);

  const sources = [
    'backend/server.js', 'backend/routes/accounts.js', 'backend/core/accountContext.js',
    'backend/services/accountManagerCore.js', 'backend/services/platformAdapterPorts.js',
    'backend/services/runtimeArtifactBootstrapService.js', 'backend/services/runtimeArtifactRegistryService.js',
    'shared/core/contracts.js', 'frontend/r32-account-center.js', 'frontend/js/core-client.js',
  ].map(read).join('\n');
  assert.doesNotMatch(sources, /facebookBusinessSuiteAvatarImport|facebook-avatar-import|facebook\.avatar-import|account\.facebook\.avatarImport|facebook-web-companion/u);

  const accounts = read('backend/routes/accounts.js');
  const context = read('backend/core/accountContext.js');
  const registry = read('backend/services/platformDriverRegistry.js');
  const bridge = read('backend/services/facebookChatwootMatrixBridge.js');
  assert.match(accounts, /facebook\/page\/inboxes/u);
  assert.match(accounts, /facebook\/page\/attach/u);
  assert.match(context, /account\.facebook\.page\.inboxes/u);
  assert.match(context, /account\.facebook\.page\.attach/u);
  assert.match(registry, /facebook-page-official[\s\S]*facebookChatwoot/u);
  assert.match(bridge, /Channel::FacebookPage/u);
});
