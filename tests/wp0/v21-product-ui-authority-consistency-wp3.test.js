'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function manifestApis() {
  const manifest = readJson('electron/m2/ipcManifest.json');
  return new Set((manifest.handlers || [])
    .map((entry) => entry?.rendererExposure?.api)
    .filter(Boolean));
}

test('WP3 preserve: Element ProductExperienceShell remains the sole active Product renderer', () => {
  const elementIndex = read('integration/element-module/src/index.tsx');
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');

  assert.match(elementIndex, /registerGlobalRightPanel/u);
  assert.match(workspace, /<ProductExperienceShell/u);
  assert.doesNotMatch(elementIndex, /from\s+["'][^"']*frontend\//u);
  assert.doesNotMatch(workspace, /from\s+["'][^"']*frontend\//u);
});

test('WP3 preserve: Personal Access backend remains the sole entitlement authority and full owner mutation lifecycle', () => {
  const routes = read('backend/routes/personalAccess.js');
  const service = read('backend/services/personalAccessService.js');

  for (const route of [
    '/status',
    '/submit-request',
    '/refresh-request',
    '/owner/requests',
    '/owner/requests/:requestId/:action',
    '/owner/grants/:grantId/:action',
  ]) {
    assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(':requestId', '[^/]+').replace(':grantId', '[^/]+').replace(':action', '[^/]+'), 'u'));
  }
  assert.match(service, /ownerCredentialPresent/u);
  assert.match(service, /REQUEST_PENDING/u);
  assert.match(service, /GRANT_SUSPENDED/u);
  assert.match(service, /GRANT_REVOKED/u);
  assert.match(service, /INSTALLATION_MISMATCH/u);
  assert.match(service, /listOwnerRequests/u);
  assert.match(service, /mutateOwnerRequest/u);
  assert.match(service, /mutateOwnerGrant/u);
});

test('WP3-A RED: current Element Product must expose Personal Access status, request and OWNER management through the existing desktop bridge', () => {
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  const productSources = [
    workspace,
    fs.existsSync(path.join(ROOT, 'integration/element-module/src/product-experience/PersonalAccessSurface.tsx'))
      ? read('integration/element-module/src/product-experience/PersonalAccessSurface.tsx')
      : '',
  ].join('\n');
  const preload = read('electron/preload.js');
  const bridge = read('electron/r32StoreBridge.js');
  const apis = manifestApis();
  const requiredApis = [
    'getPersonalAccessStatus',
    'submitPersonalAccessRequest',
    'refreshPersonalAccessRequest',
    'listPersonalAccessOwnerRequests',
    'mutatePersonalAccessOwnerRequest',
    'mutatePersonalAccessOwnerGrant',
  ];

  assert.match(productSources, /personal[ -]?access|PersonalAccess/iu, 'the active Element Product must own the Personal Access user surface');
  assert.match(productSources, /申请使用权限/u, 'a TESTER must have a reachable request action in the active Product');
  assert.match(productSources, /刷新/u, 'a TESTER must have a reachable status refresh action in the active Product');
  assert.match(productSources, /批准/u, 'OWNER must have a reachable approve action in the active Product');
  assert.match(productSources, /拒绝/u, 'OWNER must have a reachable reject action in the active Product');
  assert.match(productSources, /暂停/u, 'OWNER must have a reachable suspend action in the active Product');
  assert.match(productSources, /撤销/u, 'OWNER must have a reachable revoke action in the active Product');

  for (const api of requiredApis) {
    assert.match(preload, new RegExp(`\\b${api}\\s*:`, 'u'), `${api} must be exposed by the real desktop preload`);
    assert.equal(apis.has(api), true, `${api} must be declared in the M2 IPC manifest`);
  }

  assert.match(bridge, /\/api\/r32\/personal-access\/status/u);
  assert.match(bridge, /\/api\/r32\/personal-access\/submit-request/u);
  assert.match(bridge, /\/api\/r32\/personal-access\/refresh-request/u);
  assert.match(bridge, /\/api\/r32\/personal-access\/owner\/requests/u);
  assert.match(bridge, /\/api\/r32\/personal-access\/owner\/grants/u);
});

test('WP3-A RED: active Personal Access regression must not pin the retired legacy System Center as Product UI authority', () => {
  const oldContract = read('tests/wp0/v21-personal-access-control-p0.test.js');
  assert.doesNotMatch(oldContract, /read\(['"]frontend\/r32-system-center\.js['"]\)/u);
  assert.match(oldContract, /integration\/element-module\/src\//u, 'Personal Access Product contract must point at the active Element surface');
});

test('WP3-B RED: current Chinese Product controls must not leak English-only native title tooltips', () => {
  const voice = read('integration/element-module/src/VoiceWorkspace.tsx');
  const media = read('integration/element-module/src/MediaWorkspace.tsx');
  const presence = read('integration/element-module/src/PresenceWorkspace.tsx');
  const learning = read('integration/element-module/src/LearningWorkspace.tsx');

  assert.doesNotMatch(voice, /title="(?:Language|Enroll|Delete|Generate|Test voice|Regenerate|Preview|Send)"/u);
  assert.doesNotMatch(media, /title="(?:Health|Import|Search|People|Albums|Generate|Edit|Preview|Save back|Send)"/u);
  assert.doesNotMatch(presence, /title="(?:Avatar|Connect|Disconnect|Microphone|Camera)"/u);
  assert.doesNotMatch(learning, /title=\{item\.id\}/u);
});

test('WP3-C RED: current Product relationship labels and facts must remain visually readable without ellipsis clipping', () => {
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');

  assert.doesNotMatch(css, /text-overflow\s*:\s*ellipsis/u, 'current Product labels/facts must not be clipped to ellipsis');
  assert.doesNotMatch(css, /\.yance-person-copy strong,[\s\S]*?white-space\s*:\s*nowrap/u, 'relationship list labels must wrap');
  assert.doesNotMatch(css, /\.yance-relationship-universe__node-copy strong,[\s\S]*?white-space\s*:\s*nowrap/u, 'relationship universe labels must wrap');
});

test('WP3 preserve: durable appearance, search/translation and relationship tool routing stay on their existing authorities', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');

  assert.match(shell, /setFontScale/u);
  assert.match(shell, /updateProductAppearance/u);
  for (const api of [
    'storeSearchWorkspace',
    'storeCreateTranslationJob',
    'storeGetTranslationJob',
    'storeCancelTranslationJob',
    'storeRetryTranslationJob',
  ]) assert.match(projection, new RegExp(`\\b${api}\\b`, 'u'));
  assert.match(overlay, /readRoomStateEvents\(roomId,\s*["']m\.bridge["']\)/u);
  assert.match(overlay, /<MediaWorkspace/u);
  assert.match(overlay, /<PresenceWorkspace/u);
  assert.match(overlay, /<VoiceWorkspace/u);
});
