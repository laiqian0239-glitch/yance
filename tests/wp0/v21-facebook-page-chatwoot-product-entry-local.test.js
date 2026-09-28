'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Facebook Page Product entry delegates discovery and attach to the existing Chatwoot authority', () => {
  const bridge = read('backend/services/facebookChatwootMatrixBridge.js');
  const registry = read('backend/services/platformDriverRegistry.js');
  const manager = read('backend/services/accountManagerCore.js');
  const context = read('backend/core/accountContext.js');
  const contracts = read('shared/core/contracts.js');
  const routes = read('backend/routes/accounts.js');
  const ipc = read('electron/r32StoreBridge.js');
  const ui = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');

  assert.match(bridge, /async function discoverFacebookPageInboxes\(/u);
  assert.match(bridge, /requireRuntimeConfig\(\)/u);
  assert.match(bridge, /Channel::FacebookPage/u);
  assert.match(registry, /listFacebookPageInboxes/u);
  assert.match(registry, /resolveFacebookPageInbox/u);
  assert.match(manager, /async listFacebookPageInboxes\(/u);
  assert.match(manager, /async attachFacebookPageInbox\(/u);
  assert.match(manager, /facebook_ads:\$\{page\.pageId\}/u);
  assert.match(context, /account\.facebook\.page\.inboxes/u);
  assert.match(context, /account\.facebook\.page\.attach/u);
  assert.match(contracts, /ACCOUNT_FACEBOOK_PAGE_INBOXES:\s*'account\.facebook\.page\.inboxes'/u);
  assert.match(contracts, /ACCOUNT_FACEBOOK_PAGE_ATTACH:\s*'account\.facebook\.page\.attach'/u);
  assert.match(routes, /facebook\/page\/inboxes/u);
  assert.match(routes, /facebook\/page\/attach/u);
  assert.match(ipc, /facebook-page-inboxes/u);
  assert.match(ipc, /facebook-page-attach/u);
  assert.match(ui, /facebook-page-inboxes/u);
  assert.match(ui, /facebook-page-attach/u);
  assert.match(ui, /选择 Chatwoot 已授权主页/u);
  assert.doesNotMatch(ui, /Facebook Page 请使用现有官方渠道完成授权/u);
  assert.doesNotMatch(ui, /登录、主页选择与消息接入继续由现有官方渠道负责/u);
});
