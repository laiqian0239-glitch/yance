'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const { FacebookAdapter } = require('../services/facebookAdapter');
const relayClient = require('../services/facebookRelayClient');
const messageStore = require('../services/messageStore');
const avatarService = require('../services/avatarService');

function patch(t, target, key, value) {
  const previous = target[key];
  target[key] = value;
  t.after(() => { target[key] = previous; });
}

test('Facebook Avatar Closure diagnostic traces identity, signed Worker bytes, SQLite and cache without exposing raw PSID', async t => {
  const adapter = new FacebookAdapter();
  patch(t, adapter, 'credentials', () => ({ secret: { workerBaseUrl: 'https://worker.example', pageId: 'page-1' } }));
  patch(t, global, 'fetch', async () => new Response(JSON.stringify({ ok: true, avatarProxyContract: { version: 9, evidenceContractVersion: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  patch(t, relayClient, 'health', async () => ({ status: 'ready', queue: { pending: 0 } }));
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind, psid) => {
    if (kind === 'profile') assert.equal(psid, '123456789');
    return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' };
  });
  patch(t, messageStore, 'listConversations', () => [{
    platform: 'facebook', accountId: 'fb-account', conversationId: 'fb-account:123456789',
    pageScopedUserId: '123456789', title: 'Contact', avatarUrl: '/api/r32/messages/media/fb-account/fb-account_123/avatar.jpg',
    avatarStatus: 'ready', avatarUpdatedAt: '2026-07-23T00:00:00.000Z', avatarSource: 'facebook-profile-proxy'
  }]);
  patch(t, avatarService, 'validateBuffer', buffer => ({ bytes: buffer.length, mimeType: 'image/jpeg', hash: 'a'.repeat(64) }));
  patch(t, avatarService, 'validateCachedAvatar', () => ({ valid: true, bytes: 4, mimeType: 'image/jpeg', avatarHash: 'b'.repeat(64), localFile: 'C:/redacted/avatar.jpg' }));

  const report = await adapter.diagnoseAvatarClosure({ id: 'fb-account' }, { limit: 5 });
  assert.equal(report.documentType, 'YANCE_FACEBOOK_AVATAR_CLOSURE_DIAGNOSTIC');
  assert.equal(report.worker.publicHealth.contract.version, 9);
  assert.equal(report.summary.fullyReady, 1);
  assert.equal(report.contacts[0].identity.source, 'pageScopedUserId');
  assert.equal(report.contacts[0].identity.confidence, 'authoritative');
  assert.equal(report.mutationsPerformed, false);
  assert.equal(report.contacts[0].rootCause, 'READY');
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('123456789'), false);
  assert.equal(serialized.includes('C:/redacted/avatar.jpg'), false);
});

test('Facebook Avatar Closure route and UI export are present', () => {
  const routes = fs.readFileSync(path.join(root, 'backend/routes/accounts.js'), 'utf8');
  const context = fs.readFileSync(path.join(root, 'backend/core/accountContext.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  assert.match(routes, /facebook\/avatar-closure\/diagnose/);
  assert.match(context, /account\.facebook\.avatarClosure\.diagnose/);
  assert.match(ui, /Facebook Avatar Closure 专项诊断/);
  assert.match(ui, /Yance-Facebook-Avatar-Closure-/);
});


test('Facebook Avatar Closure preserves Worker V9 Picture Edge, generic picture and Messenger profile evidence separately', async t => {
  const adapter = new FacebookAdapter();
  patch(t, adapter, 'credentials', () => ({ secret: { workerBaseUrl: 'https://worker.example', pageId: 'page-1' } }));
  patch(t, global, 'fetch', async () => new Response(JSON.stringify({ ok: true, avatarProxyContract: { version: 9, evidenceContractVersion: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  patch(t, relayClient, 'health', async () => ({ status: 'ready', queue: { pending: 0 } }));
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind) => {
    if (kind === 'page') return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' };
    const error = Object.assign(new Error('profile denied'), {
      code: 'FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED', status: 409,
      details: {
        requestId: 'req-safe-1',
        pictureEdgeCode: 'FACEBOOK_REQUEST_INVALID', pictureEdgeStatus: 409,
        pictureEdgeMetaCode: 100, pictureEdgeMetaSubcode: 33, pictureEdgeMetaReason: 'unsupported_get',
        identityPictureCode: 'FACEBOOK_IDENTITY_PICTURE_UNAVAILABLE', identityPictureStatus: 404,
        identityPictureMetaCode: 100, identityPictureMetaSubcode: 33, identityPictureMetaReason: 'unsupported_get',
        profileCode: 'FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED', profileStatus: 409,
        profileMetaCode: 200, profileMetaSubcode: 0, profileMetaReason: 'missing_permission',
        originalCode: 'FACEBOOK_PERMISSION_REVOKED', diagnosis: 'explicit-permission-denied'
      }
    });
    throw error;
  });
  patch(t, messageStore, 'listConversations', () => [{
    platform: 'facebook', accountId: 'fb-account', conversationId: 'fb-account:123456789',
    pageScopedUserId: '123456789', title: 'Contact', avatarUrl: '', avatarStatus: 'failed'
  }]);
  const report = await adapter.diagnoseAvatarClosure({ id: 'fb-account' }, { limit: 1 });
  assert.equal(report.schemaVersion, 6);
  assert.equal(report.evidenceContract, 'worker-v11-avatar-unavailable-and-translation-persistence');
  assert.equal(report.contacts[0].workerProbe.pictureEdge.code, 'FACEBOOK_REQUEST_INVALID');
  assert.equal(report.contacts[0].workerProbe.pictureEdge.metaCode, 100);
  assert.equal(report.contacts[0].workerProbe.pictureEdge.metaSubcode, 33);
  assert.equal(report.contacts[0].workerProbe.pictureEdge.metaReason, 'unsupported_get');
  assert.equal(report.contacts[0].workerProbe.identityPicture.code, 'FACEBOOK_IDENTITY_PICTURE_UNAVAILABLE');
  assert.equal(report.contacts[0].workerProbe.identityPicture.status, 404);
  assert.equal(report.contacts[0].workerProbe.identityPicture.metaCode, 100);
  assert.equal(report.contacts[0].workerProbe.identityPicture.metaSubcode, 33);
  assert.equal(report.contacts[0].workerProbe.identityPicture.metaReason, 'unsupported_get');
  assert.equal(report.contacts[0].workerProbe.messengerProfile.code, 'FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED');
  assert.equal(report.contacts[0].workerProbe.messengerProfile.metaCode, 200);
  assert.equal(report.contacts[0].workerProbe.messengerProfile.metaReason, 'missing_permission');
  assert.equal(report.contacts[0].workerProbe.primaryCode, 'FACEBOOK_REQUEST_INVALID');
  assert.equal(report.contacts[0].workerProbe.messengerProfileCode, 'FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED');
  assert.equal(report.contacts[0].rootCause, 'META_CONTACT_PROFILE_ACCESS_DENIED');
  assert.equal(report.contacts[0].capability.status, 'meta-access-denied');
  assert.equal(report.summary.contactAvatarAccessDenied, 1);
  assert.equal(report.summary.contactAvatarCapability, 'meta-access-denied');
});


test('Facebook Avatar Closure compares persisted identity with message-derived identity without exporting raw IDs', async t => {
  const adapter = new FacebookAdapter();
  patch(t, adapter, 'credentials', () => ({ secret: { workerBaseUrl: 'https://worker.example', pageId: '999999' } }));
  patch(t, global, 'fetch', async () => new Response(JSON.stringify({ ok: true, avatarProxyContract: { version: 9, evidenceContractVersion: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  patch(t, relayClient, 'health', async () => ({ status: 'ready', queue: { pending: 0 } }));
  patch(t, relayClient, 'historyMessages', async () => ({
    data: [
      { from: { id: '222222222', name: 'Correct Contact' }, to: { data: [{ id: '999999' }] } },
      { from: { id: '999999' }, to: { data: [{ id: '222222222', name: 'Correct Contact' }] } }
    ]
  }));
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind, identity) => {
    if (kind === 'page') return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' };
    if (identity === '111111111') {
      throw Object.assign(new Error('wrong persisted identity'), { code: 'FACEBOOK_AVATAR_FETCH_FAILED', status: 400, details: { requestId: 'req-persisted' } });
    }
    assert.equal(identity, '222222222');
    return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg', requestId: 'req-message' };
  });
  patch(t, messageStore, 'listConversations', () => [{
    platform: 'facebook', accountId: 'fb-account', conversationId: 'fb-account:111111111',
    externalConversationId: 't_external_1', pageScopedUserId: '111111111',
    title: 'Contact', avatarUrl: '', avatarStatus: 'failed'
  }]);
  patch(t, avatarService, 'validateBuffer', buffer => ({ bytes: buffer.length, mimeType: 'image/jpeg', hash: 'c'.repeat(64) }));

  const report = await adapter.diagnoseAvatarClosure({ id: 'fb-account' }, { limit: 1 });
  assert.equal(report.summary.persistedIdentityDiffers, 1);
  assert.equal(report.summary.messageDerivedWorkerReady, 1);
  assert.equal(report.contacts[0].identityProvenance.messageDerivedResolved, true);
  assert.equal(report.contacts[0].identityProvenance.differsFromPersisted, true);
  assert.equal(report.contacts[0].identityProvenance.workerProbe.ok, true);
  assert.equal(report.contacts[0].rootCause, 'PERSISTED_IDENTITY_WRONG_MESSAGE_ID_READY');
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('111111111'), false);
  assert.equal(serialized.includes('222222222'), false);
});

test('avatarService exposes read-only buffer and cache validators used by Avatar Closure', () => {
  assert.equal(typeof avatarService.validateBuffer, 'function');
  assert.equal(typeof avatarService.validateCachedAvatar, 'function');
  const result = avatarService.validateBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { expectedPlatform: 'facebook' });
  assert.equal(result.bytes, 4);
  assert.equal(result.mimeType, 'image/jpeg');
});

test('Avatar Closure renderer and core contracts include the real command path and V8 branch labels', () => {
  const coreClient = fs.readFileSync(path.join(root, 'frontend/js/core-client.js'), 'utf8');
  const contracts = fs.readFileSync(path.join(root, 'shared/core/contracts.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  assert.match(coreClient, /facebook\/avatar-closure\/diagnose/);
  assert.match(contracts, /ACCOUNT_FACEBOOK_AVATAR_CLOSURE_DIAGNOSE/);
  assert.match(ui, /Picture Edge/);
  assert.match(ui, /Messenger Profile/);
  assert.match(ui, /body:\{ limit:2 \}, timeoutMs:300000/);
});
