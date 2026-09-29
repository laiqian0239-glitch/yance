'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const servicePath = path.join(root, 'backend/services/facebookBusinessSuiteContactProjection.js');
const extractorPath = path.join(root, 'tools/facebook-business-suite-profile-companion/profile-extractor.js');
function reload(file) { delete require.cache[require.resolve(file)]; return require(file); }
function contact(id, sourceId, name = 'John Doe', thumbnail = '') {
  return { id, name, thumbnail, contact_inboxes: [{ source_id: sourceId, inbox: { channel_type: 'Channel::FacebookPage' } }] };
}

test('profile projection resolves by exact Chatwoot source id and never duplicate display name', async () => {
  const { createFacebookBusinessSuiteContactProjection } = reload(servicePath);
  const updates = [];
  const projection = createFacebookBusinessSuiteContactProjection({
    listContacts: async () => [contact(104, '111'), contact(105, '222')],
    patchContact: async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; }
  });
  const result = await projection.projectBatch([{ sourceIds: ['222'], displayName: 'Bernd Fleischmann', avatarUrl: 'https://scontent.xx.fbcdn.net/avatar.jpg' }]);
  assert.equal(result.updated, 1);
  assert.deepEqual(updates, [{ id: '105', patch: { name: 'Bernd Fleischmann', avatar_url: 'https://scontent.xx.fbcdn.net/avatar.jpg' } }]);
});

test('ambiguous source candidates and placeholder names never mutate Chatwoot', async () => {
  const { createFacebookBusinessSuiteContactProjection } = reload(servicePath);
  const updates = [];
  const projection = createFacebookBusinessSuiteContactProjection({
    listContacts: async () => [contact(1, '111'), contact(2, '222')],
    patchContact: async (id, patch) => updates.push({ id, patch })
  });
  const result = await projection.projectBatch([
    { sourceIds: ['111', '222'], displayName: 'Real Person', avatarUrl: '' },
    { sourceIds: ['111'], displayName: 'John Doe', avatarUrl: '' }
  ]);
  assert.equal(result.ambiguous, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(updates, []);
});

test('automatic enrichment preserves existing avatar and continues after one failed update', async () => {
  const { createFacebookBusinessSuiteContactProjection } = reload(servicePath);
  const updates = [];
  const projection = createFacebookBusinessSuiteContactProjection({
    listContacts: async () => [contact(10, 'aaa', 'Old Name', 'https://existing.example/avatar.jpg'), contact(11, 'bbb')],
    patchContact: async (id, patch) => {
      if (String(id) === '10') throw Object.assign(new Error('upstream failed'), { code: 'UPSTREAM_FAILED' });
      updates.push({ id: String(id), patch }); return { id, ...patch };
    }
  });
  const result = await projection.projectBatch([
    { sourceIds: ['aaa'], displayName: 'Updated Name', avatarUrl: 'https://scontent.xx.fbcdn.net/new.jpg' },
    { sourceIds: ['bbb'], displayName: 'René Gill', avatarUrl: 'https://scontent.xx.fbcdn.net/rene.jpg' }
  ]);
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(updates, [{ id: '11', patch: { name: 'René Gill', avatar_url: 'https://scontent.xx.fbcdn.net/rene.jpg' } }]);
  assert.equal(result.results[0].attemptedPatch.avatar_url, undefined);
});

test('companion authorization is exact-route, exact-extension and Personal Access minimal only', () => {
  const security = reload(path.join(root, 'backend/middleware/r32LocalApiSecurity.js'));
  const personal = reload(path.join(root, 'backend/middleware/personalAccessGuard.js'));
  const request = { method: 'POST', path: '/api/r32/accounts/facebook/profile-enrichment', headers: {
    origin: `chrome-extension://${security.FACEBOOK_PROFILE_COMPANION_EXTENSION_ID}`,
    'x-yance-extension-id': security.FACEBOOK_PROFILE_COMPANION_EXTENSION_ID
  } };
  assert.equal(security.isFacebookProfileCompanionRequest(request), true);
  assert.equal(security.isFacebookProfileCompanionRequest({ ...request, path: '/api/r32/accounts/facebook/webhook' }), false);
  assert.equal(security.isFacebookProfileCompanionRequest({ ...request, headers: { ...request.headers, 'x-yance-extension-id': 'wrong' } }), false);
  assert.equal(personal.isMinimalPersonalAccessPath('POST', '/api/r32/accounts/facebook/profile-enrichment'), true);
  assert.equal(personal.isMinimalPersonalAccessPath('GET', '/api/r32/accounts/facebook/profile-enrichment'), false);
});

test('profile extractor keeps exact URL identity candidates and rejects non-Facebook avatar hosts', () => {
  const extractor = reload(extractorPath);
  assert.deepEqual(extractor.sourceIdsFromHref('https://business.facebook.com/latest/inbox/all?asset_id=1203748086150141&selected_item_id=39723401007250925&thread_id=28513411744981937'), ['1203748086150141', '39723401007250925', '28513411744981937']);
  const safe = extractor.sanitizeObservedProfile({ href: 'https://business.facebook.com/latest/inbox/all?selected_item_id=39723401007250925', displayName: 'Cemal Kara', avatarUrl: 'https://scontent.xx.fbcdn.net/cemal.jpg' });
  assert.equal(safe.displayName, 'Cemal Kara');
  assert.deepEqual(safe.sourceIds, ['39723401007250925']);
  assert.equal(safe.avatarUrl, 'https://scontent.xx.fbcdn.net/cemal.jpg');
  const unsafe = extractor.sanitizeObservedProfile({ href: safe.href, displayName: 'Cemal Kara', avatarUrl: 'https://evil.example/avatar.jpg' });
  assert.equal(unsafe.avatarUrl, '');
});

test('new companion is stateless zero-click projection and retired importer stays absent', () => {
  const dir = 'tools/facebook-business-suite-profile-companion';
  for (const rel of ['manifest.json', 'profile-extractor.js', 'content.js', 'service-worker.js']) assert.equal(fs.existsSync(path.join(root, dir, rel)), true, `${rel} must exist`);
  const manifest = JSON.parse(read(`${dir}/manifest.json`));
  const content = read(`${dir}/content.js`);
  const worker = read(`${dir}/service-worker.js`);
  const combined = `${JSON.stringify(manifest)}\n${content}\n${worker}`;
  assert.equal(manifest.key.length > 100, true);
  assert.deepEqual(manifest.permissions, ['tabs']);
  assert.match(content, /MutationObserver/u);
  assert.match(worker, /chrome\.runtime\.onStartup/u);
  assert.match(worker, /chrome\.tabs\.create/u);
  assert.match(worker, /facebook\/profile-enrichment/u);
  const banned = [['local', 'Storage'], ['chrome.', 'storage'], ['session', 'Id'], ['/pre', 'view'], ['/im', 'port'], ['scroll', 'Top'], ['scrollInto', 'View'], ['auto', 'Scan']].map(parts => parts.join(''));
  for (const term of banned) assert.equal(combined.includes(term), false, `${term} must stay retired`);
  assert.equal(fs.existsSync(path.join(root, 'backend/services/facebookBusinessSuiteAvatarImportService.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'backend/routes/facebookAvatarImportBridge.js')), false);
});

test('accounts route exposes only stateless profile projection endpoint', () => {
  const accounts = read('backend/routes/accounts.js');
  assert.match(accounts, /facebook\/profile-enrichment/u);
  assert.match(accounts, /facebookBusinessSuiteContactProjection/u);
  assert.doesNotMatch(accounts, /avatar-import|facebookAvatarImportBridge/u);
});
