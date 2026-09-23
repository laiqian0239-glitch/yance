'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('WA/TG/Meta personal messaging production registry is owned by mautrix, not legacy adapters', () => {
  const registry = read('backend/services/platformDriverRegistry.js');
  assert.match(registry, /whatsapp-personal-mautrix-whatsapp/u);
  assert.match(registry, /telegram-personal-mautrix-telegram/u);
  assert.match(registry, /facebook-personal-messenger-mautrix-meta/u);
  assert.match(registry, /protocolAuthority:\s*'mautrix-whatsapp'/u);
  assert.match(registry, /protocolAuthority:\s*'mautrix-telegram'/u);
  assert.doesNotMatch(registry, /require\(['"]\.\/whatsappAdapter['"]\)/u);
  assert.doesNotMatch(registry, /require\(['"]\.\/telegramAdapter['"]\)/u);
  assert.doesNotMatch(registry, /facebookPersonalMessengerMautrixAdapter/u);
});
test('generic provisioning seam replaces Yance-owned platform login lifecycles', () => {
  const adapter = read('backend/services/mautrixProvisioningAdapter.js');
  const contracts = read('shared/core/contracts.js');
  const context = read('backend/core/accountContext.js');
  const accountManager = read('backend/services/accountManagerCore.js');
  const routes = read('backend/routes/accounts.js');
  const ipc = read('electron/r32StoreBridge.js');
  const ui = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');

  assert.match(adapter, /\/v3\/login\/flows/u);
  assert.match(adapter, /\/v3\/login\/start\//u);
  assert.match(adapter, /\/v3\/login\/step\//u);
  assert.match(adapter, /body:\s*options\.body === undefined \? undefined : JSON\.stringify\(options\.body\)/u);
  assert.match(adapter, /\['user_input', 'cookies', 'webauthn'\]\.includes\(type\)[\s\S]*\? \(input && typeof input === 'object' \? input : \{\}\)[\s\S]*: undefined/u);
  assert.doesNotMatch(adapter, /type === 'user_input' \? \{ input \}/u);
  assert.match(adapter, /body === undefined \? \{\} : \{ body \}/u);
  assert.match(adapter, /ELEMENT_MATRIX_SEND_AUTHORITY_REQUIRED/u);
  assert.doesNotMatch(adapter, /matrix-js-sdk|StringSession|useMultiFileAuthState/u);

  for (const source of [context, routes, ipc, ui]) {
    assert.match(source, /provisioning(?:\.login|-login|\/login)/u);
    assert.doesNotMatch(source, /telegram-qr-start|telegram-phone-start|telegram-password|facebook-messenger-start/u);
  }
  for (const command of ['flows', 'start', 'input', 'wait', 'cancel']) {
    assert.match(contracts, new RegExp(`account\\.provisioning\\.login\\.${command}`, 'u'));
  }
  assert.doesNotMatch(contracts, /account\.telegram\.(?:qr|phone|code|password|cancel)|account\.facebook\.messenger\.(?:start|input|wait|cancel)/u);
  assert.match(accountManager, /matureLifecycleAuthority[\s\S]*protocolAuthority/u);
  assert.match(accountManager, /matrixUserId:\s*String\(options\.matrixUserId \|\| ''\)\.trim\(\)/u);
  assert.match(ui, /personal-messenger" \? "messenger-lite"/u);
  assert.match(ui, /flow\.id\.toLowerCase\(\) === needle/u);
  assert.doesNotMatch(ui, /personal-messenger" \? "messenger"/u);
  assert.doesNotMatch(context, /telegram\.qr\.start|telegram\.phone\.start|facebook\.messenger\.start/u);
  assert.doesNotMatch(accountManager, /startTelegramQr|startTelegramPhone|submitTelegramCode|submitTelegramPassword|startFacebookMessengerLogin|submitFacebookMessengerInput/u);
  assert.doesNotMatch(ui, /auth-challenge/u);
});
test('account persistence migrates retired driver ids before hydration and never creates new legacy owners', () => {
  const repository = read('backend/repositories/accountRepository.js');
  const manager = read('backend/services/accountManagerCore.js');
  assert.match(repository, /'whatsapp-web-multidevice': 'whatsapp-personal-mautrix-whatsapp'/u);
  assert.match(repository, /'telegram-personal-mtproto': 'telegram-personal-mautrix-telegram'/u);
  assert.match(repository, /if \(platform === 'telegram'\) return 'telegram-personal-mautrix-telegram'/u);
  assert.match(repository, /return 'whatsapp-personal-mautrix-whatsapp'/u);
  assert.match(repository, /async function migrateRetiredDriverIds\(\)/u);
  assert.match(manager, /await accountStore\.migrateRetiredDriverIds\?\.\(\);[\s\S]*for \(const account of accountStore\.listAll\(\)\)/u);
  assert.doesNotMatch(repository, /function defaultDriverId[\s\S]*return 'telegram-personal-mtproto'/u);
});

test('runtime artifact registry fingerprints mature bridge authority, not retired WA/TG adapters', () => {
  const bootstrap = read('backend/services/runtimeArtifactBootstrapService.js');
  assert.match(bootstrap, /backend\/services\/platformDriverRegistry\.js/u);
  assert.match(bootstrap, /backend\/services\/mautrixProvisioningAdapter\.js/u);
  assert.doesNotMatch(bootstrap, /backend\/services\/whatsappAdapter\.js/u);
  assert.doesNotMatch(bootstrap, /backend\/services\/telegramAdapter\.js/u);
});

test('Electron statelessly projects all bridge ports/secrets and sealed Telegram application credentials', () => {
  const main = read('electron/main.js');
  const compose = read('services/matrix/docker-compose.yml');
  const materializedCompose = read('tools/product-experience/materialized-matrix-compose.yml');
  const sourceUat = read('tools/runtime-delivery/start-source-uat.js');

  for (const token of [
    'YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE',
    'YANCE_MAUTRIX_WHATSAPP_PROVISIONING_SECRET_FILE',
    'YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE',
    'YANCE_MAUTRIX_META_PROVISIONING_URL',
    'YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL',
    'YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL',
  ]) assert.match(main, new RegExp(token, 'u'), token);

  assert.match(main, /loadReleasePlatformAuth\(\{ resourcesPath \}\)/u);
  assert.match(main, /'mautrix-meta', 'mautrix-whatsapp', 'mautrix-telegram'/u);
  assert.match(main, /'port', 'mautrix-whatsapp', '29318'/u);
  assert.match(main, /'port', 'mautrix-telegram', '29317'/u);
  assert.match(compose, /YANCE_MATRIX_MAUTRIX_META_PORT_BINDING/u);
  assert.match(compose, /YANCE_MAUTRIX_TELEGRAM_NETWORK__API_ID/u);
  assert.match(compose, /YANCE_MAUTRIX_TELEGRAM_NETWORK__API_HASH/u);
  assert.equal((materializedCompose.match(/if \[ ! -f \/data\/config\.yaml \]/gu) || []).length, 3);
  assert.doesNotMatch(materializedCompose, /YANCE_MAUTRIX_META_NETWORK__MODE/u);
  assert.match(sourceUat, /label=com\.docker\.compose\.service=element/u);
  assert.match(sourceUat, /label=com\.docker\.compose\.project=/u);
  for (const service of ['synapse', 'mautrix-meta', 'mautrix-whatsapp', 'mautrix-telegram']) {
    assert.match(sourceUat, new RegExp("service\\('" + service + "'\\)", 'u'), service);
  }
  assert.match(sourceUat, /YANCE_MAUTRIX_META_PROVISIONING_URL:\s*'http:\/\/127\.0\.0\.1:' \+ metaPort/u);
  assert.match(sourceUat, /YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL:\s*'http:\/\/127\.0\.0\.1:' \+ whatsappPort/u);
  assert.match(sourceUat, /YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL:\s*'http:\/\/127\.0\.0\.1:' \+ telegramPort/u);
  assert.doesNotMatch(sourceUat, /53798\/_matrix\/provision|59051\/_matrix\/provision/u);
});
test('Product resolves mature portal rooms through bridge state and delegates rendering to Element', () => {
  const resolver = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  const entry = read('integration/element-module/src/index.tsx');

  assert.match(resolver, /readRoomStateEvents\(roomId, "m\.bridge"\)/u);
  assert.match(resolver, /readRoomStateEvents\(roomId, "uk\.half-shot\.bridge"\)/u);
  assert.match(resolver, /const receiver = clean\(identity\.receiver\)/u);
  assert.match(resolver, /const acceptedReceivers = new Set\(/u);
  assert.match(resolver, /\[accountId, \.\.\.bridgeReceiverAliases\]\.map\(clean\)\.filter\(Boolean\)/u);
  assert.match(resolver, /acceptedReceivers\.has\(receiver\)/u);
  assert.match(resolver, /metadata\.mautrixLoginId/u);
  assert.match(resolver, /bridgeLogins/u);
  assert.match(resolver, /if \(!platform \|\| !chatJid \|\| !accountId \|\| !receiver\) return false/u);
  assert.doesNotMatch(resolver, /receiver === accountId/u);
  assert.doesNotMatch(resolver, /receiverMatches\.length \? receiverMatches : platformMatches/u);
  assert.doesNotMatch(resolver, /!identity\.receiver \|\| route\.accountId === identity\.receiver/u);
  assert.match(resolver, /if \(!identity\.receiver\)[\s\S]*status: "unresolved"/u);
  assert.match(resolver, /matches\.size === 1/u);
  assert.match(entry, /builtins\.renderRoomView\(roomId, props\)/u);
  assert.match(entry, /resolveCanonicalConversationRoom\(\s*conversation,\s*candidateRoomIds,\s*readRoomStateEvents,\s*bridgeReceiverAliases,\s*\)/u);
});

test('Element OpenID is projected transiently into mautrix provisioning without a second Matrix session owner', () => {
  const personalAccess = read('backend/services/personalAccessService.js');
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  const entry = read('integration/element-module/src/index.tsx');
  const productShell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');
  const preload = read('electron/preload.js');
  const ipc = read('electron/r32StoreBridge.js');
  const routes = read('backend/routes/accounts.js');
  const adapter = read('backend/services/mautrixProvisioningAdapter.js');

  assert.match(personalAccess, /async matrixSubject\(matrixOpenId = \{\}\)/u);
  assert.match(personalAccess, /openid\/userinfo\?access_token=/u);
  assert.match(workspace, /getMatrixOpenIdToken=\{getMatrixOpenIdToken\}/u);
  assert.match(productShell, /PlatformAccountsSurface getMatrixUserId=\{getMatrixUserId\} getMatrixOpenIdToken=\{getMatrixOpenIdToken\}/u);
  assert.match(entry, /const resolveMatrixUserId = async \(\): Promise<string>/u);
  assert.match(entry, /desktop\.listPlatformAccounts\(\{ matrixUserId \}\)/u);
  assert.match(accounts, /getPersonalAccessStatus\(\{ matrixOpenId \}\)/u);
  assert.match(accounts, /entitlement\.usable === true \? text\(entitlement\.subject\) : ""/u);
  assert.doesNotMatch(accounts, /useState[^\n]*matrixUserId/iu);
  assert.match(preload, /listPlatformAccounts: input => invokeStore\('store:platform-accounts-list', input \|\| \{\}\)/u);
  assert.match(ipc, /matrixUserId = clean\(input\.matrixUserId\)/u);
  assert.match(routes, /account\.list'[\s\S]*matrixUserId: req\.query\.matrixUserId/u);
  assert.match(adapter, /const matrixUserId = clean\(options\.matrixUserId\)/u);
  assert.match(adapter, /\/v3\/login\/flows'[\s\S]*\{ \.\.\.options, signal:/u);
  assert.match(adapter, /\/v3\/login\/start\/[\s\S]*\.\.\.options, method: 'POST'/u);
  assert.match(adapter, /\/v3\/login\/cancel\/[\s\S]*\.\.\.options, method: 'POST'/u);
  assert.match(adapter, /\/v3\/logout\/all'[\s\S]*\.\.\.options, method: 'POST'/u);
  assert.doesNotMatch(adapter, /endUserMatrixIdentity|matrix-local-human-identity/u);
  assert.doesNotMatch(adapter, /matrix-js-sdk|createClient|loginWith/u);
});

test('Facebook Page remains on the existing Chatwoot production authority while Product UI avoids false environment absence', () => {
  const registry = read('backend/services/platformDriverRegistry.js');
  const bridge = read('backend/services/facebookChatwootMatrixBridge.js');
  const manager = read('backend/services/accountManagerCore.js');
  const contracts = read('shared/core/contracts.js');
  const routes = read('backend/routes/accounts.js');
  const preload = read('electron/preload.js');
  const accounts = read('integration/element-module/src/product-experience/PlatformAccountsSurface.tsx');

  assert.match(registry, /'facebook-page-official'[\s\S]*adapter:\s*facebookChatwoot[\s\S]*supportLevel:\s*'production'/u);
  assert.match(bridge, /async function listFacebookInboxes\(config, operation = \{\}\)/u);
  assert.match(bridge, /async function discoverFacebookPageInboxes\(/u);
  assert.match(bridge, /async function resolveFacebookPageInbox\(/u);
  assert.match(bridge, /Channel::FacebookPage/u);
  assert.match(bridge, /return `facebook_ads:\$\{normalized\}`/u);
  assert.match(manager, /async listFacebookPageInboxes\(/u);
  assert.match(manager, /async attachFacebookPageInbox\(/u);
  assert.match(contracts, /account\.facebook\.page\.inboxes/u);
  assert.match(contracts, /account\.facebook\.page\.attach/u);
  assert.match(routes, /facebook\/page\/inboxes/u);
  assert.match(routes, /facebook\/page\/attach/u);
  assert.match(accounts, /选择 Chatwoot 已授权主页/u);
  assert.match(accounts, /facebook-page-inboxes/u);
  assert.match(accounts, /facebook-page-attach/u);
  assert.doesNotMatch(accounts, /Facebook Page 请使用现有官方渠道完成授权/u);
});

test('Telegram conversation history is materialized by mautrix backfill for Element RoomView, not by a Yance shadow timeline', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const config = read('config/matrix/mautrix-telegram/config.yaml');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');

  assert.match(config, /(?:^|\n)backfill:\s*\n\s+enabled:\s*true\b/u,
    'fresh Telegram bridge data must enable mature-owner initial/catch-up history materialization');
  assert.match(compose, /YANCE_MAUTRIX_TELEGRAM_BACKFILL__ENABLED:\s*["']?true["']?/u,
    'the frozen named-volume runtime must receive the same mature-owner backfill setting through its supported env-config seam');
  assert.match(shell, /renderRoomView\(session\.activeMatrixRoomId/u,
    'Element RoomView remains the only Product timeline renderer');
  assert.doesNotMatch(shell, /recentMessages\.map\([\s\S]*yance-product-conversation__room-view/u,
    'stored Product context must not become a second chat-history renderer');
});