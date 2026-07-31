'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const modelStatusProjection = require('../services/modelStatusProjection');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-real-windows-evidence-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  return { root, store, adapter: new SqliteStorePersistenceAdapter({ store }) };
}

function cleanup(value) {
  try { value.store.close(); } catch (_) {}
  fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

test('real Windows social-message projection can persist the 17-column interaction policy', async () => {
  const value = fixture();
  try {
    value.store.upsertContact({
      id: 'facebook-contact-1',
      platform: 'facebook',
      externalId: 'page-user-1',
      displayName: 'Facebook Contact'
    });
    await value.adapter.transaction(transaction => transaction.upsertInteractionPolicy({
      contactId: 'facebook-contact-1',
      policy: 'reply_normally',
      allowReplies: true,
      allowProactive: false,
      blocked: false,
      blockReason: '',
      proactiveMessageBudget7d: 2,
      usedThisWeek: 0,
      unansweredLimit: 1,
      minimumIntervalHours: 18,
      nextAllowedProactiveAt: '',
      replyStrategy: { style: 'warm' },
      config: { source: 'facebook-webhook' },
      version: 1
    }));
    const row = value.store.db
      .prepare('SELECT * FROM interaction_policies WHERE contact_id=?')
      .get('facebook-contact-1');
    assert.equal(row.contact_id, 'facebook-contact-1');
    assert.equal(row.policy, 'reply_normally');
    assert.equal(JSON.parse(row.config_json).source, 'facebook-webhook');
  } finally {
    cleanup(value);
  }
});

test('cloud qualification failure is not mislabeled as generic service offline', () => {
  const result = modelStatusProjection.project({
    ollamaOnline: false,
    models: [{
      id: 'gpt',
      name: 'gpt-4o',
      provider: 'openai-compatible',
      configured: true,
      available: true,
      endpoint: 'https://api.openai.com/v1',
      credentialRef: 'cred',
      qualification: 'failed',
      lastTest: { connectivity: { pass: false, status: 401, code: 'invalid_api_key', error: 'API key invalid' } }
    }],
    routes: {}
  }, { credentialReady: () => true });
  assert.equal(result.models[0].configured, true);
  assert.equal(result.models[0].credentialReady, true);
  assert.equal(result.models[0].runtimeOnline, false);
  assert.equal(result.models[0].runtimeState, modelStatusProjection.STATES.unavailable);
  assert.equal(result.models[0].runtimeStateLabel, '不可用');
  assert.match(result.models[0].userSummary, /凭据无效|权限不足/u);
  assert.equal(result.models[0].qualificationFailure.status, 401);
  assert.equal(result.models[0].qualificationFailure.code, 'invalid_api_key');
  assert.doesNotMatch(result.models[0].userSummary, /模型配置未发现|服务离线/u);
});

test('Facebook page and contact avatar chains retain platform-specific identity', () => {
  const root = path.resolve(__dirname, '..', '..');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/facebookAdapter.js'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'backend/services/accountManager.js'), 'utf8');
  const desktopApi = fs.readFileSync(path.join(root, 'services/facebook-worker/src/desktopApi.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(adapter, /pagePicture/u);
  assert.match(adapter, /avatarBufferWithRetry\(secret, 'profile'/u);
  assert.match(adapter, /avatarService\.cacheBuffer\([\s\S]*source: 'facebook-profile-proxy'/u);
  assert.match(manager, /metadata\.pagePicture = metadata\.picture/u);
  assert.match(desktopApi, /pagePicture: clean\(row\.page_picture_url\)/u);
  assert.match(runtime, /account\.page\?\.picture\s*\|\|\s*account\.metadata\?\.picture/u);
});

test('conversation capability bindings wait for the complete DOM and remain diagnosable', () => {
  const root = path.resolve(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(root, 'frontend/js/r32-conversation-capabilities.js'), 'utf8');
  assert.match(source, /BIND_REQUIRED_IDS=.*moreBtn.*imageInput.*messages/u);
  assert.match(source, /waiting-for-dom/u);
  assert.match(source, /binding-error/u);
  assert.match(source, /new MutationObserver/u);
  assert.match(source, /__YanceConversationCapabilitiesStatus/u);
  assert.match(source, /addEventListener\('contextmenu'/u);
  assert.match(source, /dataset\.r32CapabilityBound/u);
});

test('media controls load without unresolved viewer functions and render real playback elements', () => {
  const root = path.resolve(__dirname, '..', '..');
  const capabilities = fs.readFileSync(path.join(root, 'frontend/js/r32-conversation-capabilities.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  const sandbox = {
    window: {
      YanceSecurity: {
        escapeHtmlText: value => String(value ?? ''),
        escapeHtmlAttribute: value => String(value ?? ''),
        escapeUrlAttribute: value => String(value ?? ''),
        setUrlAttribute: () => 'safe'
      },
      addEventListener() {},
      setTimeout,
      clearTimeout
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById() { return null; },
      documentElement: null,
      body: null
    },
    navigator: {},
    location: { href: 'http://127.0.0.1/' },
    URL,
    console,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(capabilities, sandbox, { filename: 'r32-conversation-capabilities.js' });
  assert.equal(typeof sandbox.window.YanceR32ConversationCapabilities.openMediaViewer, 'function');
  assert.match(capabilities, /function handleMediaViewerAction/u);
  assert.match(capabilities, /function saveMediaViewerImage/u);
  assert.match(runtime, /<audio controls preload=/u);
  assert.match(runtime, /<video controls preload=/u);
  assert.match(runtime, /message-file-link/u);
  assert.match(runtime, /Boolean\(attachment\).*voice.*audio/u);
});

test('SQLite message payload preserves playable media descriptors', () => {
  const value = fixture();
  try {
    value.store.upsertConversation({ sessionKey: 'facebook:conversation:media', accountId: 'facebook-account', platform: 'facebook', title: 'Media Contact' });
    value.store.upsertMessage({
      id: 'facebook-message-media',
      sessionKey: 'facebook:conversation:media',
      accountId: 'facebook-account',
      direction: 'inbound',
      type: 'voice',
      text: '对方发送了一条语音',
      timestamp: '2026-07-21T10:00:00.000Z',
      attachments: [{ kind: 'voice', mimeType: 'audio/ogg', mediaUrl: '/api/r32/messages/media/facebook-account/facebook_conversation_media/voice.ogg', duration: 8, downloadStatus: 'ready' }]
    });
    const [row] = value.store.listMessages('facebook:conversation:media', { limit: 10 });
    assert.equal(row.type, 'voice');
    assert.equal(row.attachments[0].kind, 'voice');
    assert.equal(row.attachments[0].mimeType, 'audio/ogg');
    assert.match(row.attachments[0].mediaUrl, /^\/api\/r32\/messages\/media\//u);
  } finally {
    cleanup(value);
  }
});

test('real Windows expected-absence noise, stale OAuth polling and destroyed tray are contained', () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  const accounts = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  const electron = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(server, /request-missing-resource/u);
  assert.match(server, /PERSONA_PROFILE_NOT_FOUND.*CUSTOMER_NOT_FOUND.*FACEBOOK_OAUTH_FLOW_NOT_FOUND/su);
  assert.match(server, /logger\.rateLimited/u);
  assert.match(accounts, /code === 'FACEBOOK_OAUTH_FLOW_NOT_FOUND'/u);
  assert.match(accounts, /state\.facebookFlow = null/u);
  assert.match(electron, /tray\.isDestroyed\?\.\(\) === true/u);
});
