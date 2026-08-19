'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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

test('WP-2 inventory keeps Element ProductExperienceShell as the production renderer and legacy frontend out of the active mount', () => {
  const elementIndex = read('integration/element-module/src/index.tsx');
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');

  assert.match(elementIndex, /registerGlobalRightPanel/u);
  assert.match(elementIndex, /registerComposerPreview/u);
  assert.match(workspace, /<ProductExperienceShell/u);
  assert.doesNotMatch(elementIndex, /from\s+["'][^"']*frontend\//u);
  assert.doesNotMatch(workspace, /from\s+["'][^"']*frontend\//u);
});

test('WP-2 preserves the real search and durable translation lifecycle instead of replacing it with renderer-only state', () => {
  const search = read('integration/element-module/src/product-experience/BilingualSearchPanel.tsx');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');

  for (const api of [
    'storeSearchWorkspace',
    'storeCreateTranslationJob',
    'storeGetTranslationJob',
    'storeCancelTranslationJob',
    'storeRetryTranslationJob',
  ]) {
    assert.match(projection, new RegExp(`\\b${api}\\b`, 'u'));
  }
  assert.match(search, /createTranslationJob|storeCreateTranslationJob/u);
  assert.match(search, /cancelTranslationJob|storeCancelTranslationJob/u);
  assert.match(search, /retryTranslationJob|storeRetryTranslationJob/u);
});

test('WP-2 preserves relationship tool routing through Matrix bridge identity and canonical Store conversations', () => {
  const overlay = read('integration/element-module/src/product-experience/RelationshipOverlayHost.tsx');
  const composer = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');

  assert.match(composer, /requestRelationshipOverlay/u);
  assert.match(overlay, /readRoomStateEvents\(roomId,\s*["']m\.bridge["']\)/u);
  assert.match(overlay, /storeSnapshot\(\{\s*domains:\s*\[\s*["']conversations["']\s*\]\s*\}\)/u);
  assert.match(overlay, /status:\s*["']ambiguous["']/u);
  assert.match(overlay, /status:\s*["']unresolved["']/u);
  assert.match(overlay, /<MediaWorkspace/u);
  assert.match(overlay, /<PresenceWorkspace/u);
  assert.match(overlay, /<VoiceWorkspace/u);
});

test('WP2-A Learning declared Product APIs must have a real preload and M2 bridge contract', () => {
  const preload = read('electron/preload.js');
  const apis = manifestApis();

  for (const api of ['invokeLearningCoachAction', 'getLearningWorkspaceSnapshot']) {
    assert.match(preload, new RegExp(`\\b${api}\\s*:`, 'u'), `${api} must be exposed by the real desktop preload`);
    assert.equal(apis.has(api), true, `${api} must be registered in the M2 IPC manifest`);
  }
});

test('WP2-A Learning Daily Review cannot claim hard-coded lifecycle progress', () => {
  const workspace = read('integration/element-module/src/LearningWorkspace.tsx');

  assert.doesNotMatch(workspace, /status:\s*["']completed["']/u, 'completed must come from real runtime evidence');
  assert.doesNotMatch(workspace, /status:\s*["']in-progress["']/u, 'in-progress must come from real runtime evidence');
  assert.doesNotMatch(workspace, /status:\s*["']pending["']/u, 'pending must come from real runtime evidence');
});

test('WP2-A Learning approval UI is never decorative: an approval card must have both real decision callbacks', () => {
  const workspace = read('integration/element-module/src/LearningWorkspace.tsx');
  const usage = workspace.match(/<LearningProposalApproval\b[\s\S]*?\/>/u);

  if (!usage) return;
  assert.match(usage[0], /\bonApprove=/u, 'visible approval UI must have a real approve action');
  assert.match(usage[0], /\bonDeny=/u, 'visible approval UI must have a real deny action');
});

test('WP2-A Learning Privacy and Consent controls cannot be renderer-only toggles', () => {
  const workspace = read('integration/element-module/src/LearningWorkspace.tsx');

  assert.doesNotMatch(workspace, /const\s*\[doNotLearn,\s*setDoNotLearn\]\s*=\s*useState\(false\)/u);
  assert.doesNotMatch(workspace, /const\s*\[consent,\s*setConsent\]\s*=\s*useState\(false\)/u);
});

test('WP2-B Voice durable profiles must be discoverable and rehydrated after workspace remount or app restart', () => {
  const runtime = read('electron/voiceBrainRuntime.js');
  const preload = read('electron/preload.js');
  const workspace = read('integration/element-module/src/VoiceWorkspace.tsx');
  const apis = manifestApis();

  assert.match(runtime, /\blistVoiceProfiles\b/u, 'durably stored profiles need a bounded discovery API');
  assert.match(preload, /\blistVoiceProfiles\s*:/u, 'profile discovery must cross the existing desktop bridge');
  assert.equal(apis.has('listVoiceProfiles'), true, 'profile discovery must have an M2 IPC contract');
  assert.match(workspace, /\blistVoiceProfiles\s*\(/u, 'VoiceWorkspace must rehydrate saved profiles instead of starting from null forever');
});

test('WP2-B Voice Workspace consumes the already-exposed local ASR capability it presents to the user', () => {
  const preload = read('electron/preload.js');
  const workspace = read('integration/element-module/src/VoiceWorkspace.tsx');

  assert.match(preload, /\btranscribeVoiceAudio\s*:/u);
  assert.match(workspace, /api\.transcribeVoiceAudio\s*\(/u, 'visible local speech-recognition capability must have an actual UI action');
});

test('WP2-C Product sound, motion and atmosphere preferences use existing durable desktop authorities, never localStorage truth', () => {
  const preferences = read('integration/element-module/src/product-experience/experiencePreferences.ts');
  const preload = read('electron/preload.js');

  assert.doesNotMatch(preferences, /\blocalStorage\b/u);
  assert.match(preload, /\bstoreSetMotionLevel\s*:/u);
  assert.match(preload, /\bstoreSetBackgroundEffect\s*:/u);
  assert.match(preferences, /\bstoreSnapshot\b/u, 'preferences must rehydrate from durable UI state');
  assert.match(preferences, /\bstoreSetMotionLevel\b/u, 'motion preference must reuse the Store UI authority');
  assert.match(preferences, /\bstoreSetBackgroundEffect\b/u, 'atmosphere preference must reuse the Store UI authority');
  assert.match(preferences, /\bgetSettings\b/u, 'sound preference must rehydrate from the existing desktop settings authority');
  assert.match(preferences, /\bupdateSettings\b/u, 'sound preference must persist through the existing desktop settings authority');
});
