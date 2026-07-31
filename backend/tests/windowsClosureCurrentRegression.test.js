'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const syncStability = require('../../frontend/js/r32-sync-stability');
const { WhatsAppHistoryMediaRecoveryQueue } = require('../services/whatsappHistoryMediaRecovery');
const modelStatus = require('../services/modelStatusProjection');
const cloud = require('../services/openAiCompatibleClient');
const modelExecutor = require('../services/modelExecutor');
const workspaceRepository = require('../repositories/workspaceRepository');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const accountManager = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const { RuntimeRecoveryService } = require('../services/runtimeRecoveryService');

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('WAIT_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('sync merge keeps stable WhatsApp identity and avatar during incomplete snapshots', () => {
  const existing = [{
    id: 'account:4477@s.whatsapp.net',
    displayName: 'Alois Weigel',
    avatarUrl: '/api/r32/messages/media/account/contact/avatar.jpg',
    contactId: 'contact-wa-4477',
    accountId: 'account',
    externalId: '4477@s.whatsapp.net',
    chatJid: '4477@s.whatsapp.net',
    lastMessage: 'hello'
  }];
  const incoming = [{
    id: 'account:4477@s.whatsapp.net',
    displayName: '+447974905090',
    avatarUrl: '',
    contactId: '',
    accountId: '',
    externalId: '',
    chatJid: '',
    unreadCount: 2
  }];
  const [merged] = syncStability.mergeContactCollections(existing, incoming);
  assert.equal(merged.displayName, 'Alois Weigel');
  assert.equal(merged.avatarUrl, existing[0].avatarUrl);
  assert.equal(merged.unreadCount, 2);
  assert.equal(merged.contactId, 'contact-wa-4477');
  assert.equal(merged.accountId, 'account');
  assert.equal(merged.externalId, '4477@s.whatsapp.net');
  assert.equal(merged.chatJid, '4477@s.whatsapp.net');
});

test('sync event storm is coalesced without media-triggered full conversation reload', async () => {
  const runs = [];
  const coordinator = syncStability.createRefreshCoordinator({
    delayMs: 250,
    run: async value => runs.push(value)
  });
  coordinator.schedule('contacts:update');
  coordinator.schedule('conversations:update');
  coordinator.schedule('whatsapp:history-media-recovered');
  await coordinator.flush();
  assert.equal(runs.length, 1);
  assert.deepEqual(new Set(runs[0].eventTypes), new Set(['contacts:update', 'conversations:update', 'whatsapp:history-media-recovered']));
  assert.equal(runs[0].reloadConversation, false);
});

test('history completion still requests one intentional full conversation reload', async () => {
  const runs = [];
  const coordinator = syncStability.createRefreshCoordinator({
    delayMs: 250,
    run: async value => runs.push(value)
  });
  coordinator.schedule('contacts:update');
  coordinator.schedule('whatsapp:history-synced');
  coordinator.schedule('whatsapp:history-synced');
  await coordinator.flush();
  assert.equal(runs.length, 1);
  assert.deepEqual(new Set(runs[0].eventTypes), new Set(['contacts:update', 'whatsapp:history-synced']));
  assert.equal(runs[0].reloadConversation, true);
});

test('authoritative merge and removal refreshes replace the visible contact set instead of retaining tombstones', () => {
  assert.equal(syncStability.shouldRetainMissingContacts(['contacts:update']), true);
  assert.equal(syncStability.shouldRetainMissingContacts(['conversation:merged']), false);
  assert.equal(syncStability.shouldRetainMissingContacts(['contacts:removed']), false);
  assert.equal(syncStability.shouldRetainMissingContacts(['conversations:deleted']), false);

  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /shouldRetainMissingContacts\?\.\(eventTypes\)/u);
});

test('conversation refresh fingerprint ignores volatile snapshots but detects visible changes', () => {
  const base = {
    activeId: 'wa:alice',
    contacts: [{ id: 'wa:alice', accountId: 'wa', platform: 'whatsapp', name: 'Alice', avatarUrl: '/media/a.jpg', snippet: 'hello', unreadCount: 1, updatedAt: 'old', payload: { volatile: 1 } }],
    accounts: [{ id: 'wa', platform: 'whatsapp', state: 'online', canSend: true, updatedAt: 'old' }]
  };
  const equivalent = {
    activeId: 'wa:alice',
    contacts: [{ ...base.contacts[0], updatedAt: 'new', payload: { volatile: 999 } }],
    accounts: [{ ...base.accounts[0], updatedAt: 'new' }]
  };
  assert.equal(syncStability.conversationUiFingerprint(base), syncStability.conversationUiFingerprint(equivalent));
  assert.notEqual(syncStability.conversationUiFingerprint(base), syncStability.conversationUiFingerprint({ ...equivalent, contacts: [{ ...equivalent.contacts[0], unreadCount: 2 }] }));
  assert.notEqual(syncStability.conversationUiFingerprint(base), syncStability.conversationUiFingerprint({ ...equivalent, contacts: [{ ...equivalent.contacts[0], avatarUrl: '/media/b.jpg' }] }));
});

test('typing fingerprint ignores cloned equivalent snapshots but detects actual typing changes', () => {
  const base = { ready: true, byContactId: { alice: { contact: { isTyping: true, activity: 'typing', expiresAt: '2026-07-21T10:00:00.000Z' }, self: { isTyping: false, phase: 'idle' } } } };
  const clone = JSON.parse(JSON.stringify(base));
  assert.equal(syncStability.typingStateFingerprint(base), syncStability.typingStateFingerprint(clone));
  clone.byContactId.alice.contact.isTyping = false;
  assert.notEqual(syncStability.typingStateFingerprint(base), syncStability.typingStateFingerprint(clone));
});

test('individual media recovery patches are not treated as full conversation reloads', () => {
  for (const type of ['media:ready', 'media:failed', 'whatsapp:history-media-started', 'whatsapp:history-media-recovered', 'whatsapp:history-media-failed']) {
    assert.equal(syncStability.isMessagePatchEvent(type), true, type);
    assert.equal(syncStability.requiresConversationReload(type), false, type);
    assert.equal(syncStability.shouldHandleEvent(type), false, type);
  }
  assert.equal(syncStability.requiresConversationReload('whatsapp:history-synced'), true);
  assert.equal(syncStability.requiresConversationReload('conversation:merged'), true);
});

test('media recovery repository updates are recognized without suppressing unrelated message updates', () => {
  assert.equal(syncStability.isMediaRecoveryMutationEvent({ type: 'media:ready', payload: {} }), true);
  assert.equal(syncStability.isMediaRecoveryMutationEvent({ type: 'message:updated', payload: { message: { attachments: [{ downloadStatus: 'recovering', recoveryStartedAt: 'now' }] } } }), true);
  assert.equal(syncStability.isMediaRecoveryMutationEvent({ type: 'message:updated', payload: { message: { attachments: [{ downloadStatus: 'ready', mediaUrl: '/normal.jpg' }], reactions: [{ emoji: '👍' }] } } }), false);
  assert.equal(syncStability.isMediaRecoveryMutationEvent({ type: 'message:receipt', payload: {} }), false);
});

test('conversation runtime suppresses unchanged DOM rebuilds and incremental refresh does not rebroadcast initial data-ready', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /host\.__yanceContactMarkup===markup/);
  assert.match(source, /conversationUiFingerprint/);
  assert.match(source, /summaryNoops\+=1/);
  assert.match(source, /yance:r32-summary-updated/);
  assert.doesNotMatch(source, /function applyMediaLifecycleEvent/);
  assert.match(source, /mediaEventConversationId/);
  assert.match(source, /Realtime events only invalidate the SQLite projection/);
  assert.match(source, /eventConversationId===String\(activeId\)/);
  assert.match(source, /isMessagePatchEvent/);
  const refreshBody = source.slice(source.indexOf('async function refreshConversationSummaries'), source.indexOf('async function bootstrapR32'));
  assert.doesNotMatch(refreshBody, /yance:r32-data-ready/);
  const capabilities = read('frontend/js/r32-conversation-capabilities.js');
  const desktopHandler = capabilities.slice(capabilities.indexOf('if(!capabilityDesktopEventsBound'), capabilities.indexOf('const BIND_REQUIRED_IDS'));
  assert.match(desktopHandler, /\^send-queue:/);
  assert.doesNotMatch(desktopHandler, /isMediaRecoveryMutationEvent/);
  assert.doesNotMatch(desktopHandler, /\^media:/);
});

test('history media recovery is deduplicated, concurrent and reaches a terminal state', async () => {
  const persisted = [];
  const events = [];
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    concurrency: 2,
    media: {
      async materializeBaileys({ descriptor, messageId }) {
        await new Promise(resolve => setTimeout(resolve, 10));
        if (messageId === 'failed') return { ...descriptor, downloadStatus: 'failed', downloadError: 'HTTP_404' };
        return { ...descriptor, downloadStatus: 'ready', mediaUrl: `/media/${messageId}.jpg` };
      }
    },
    store: { async upsert(message) { persisted.push(message); return { message }; } },
    events: { publish(type, payload) { events.push({ type, payload }); } },
    log: { warn() {} }
  });
  const base = {
    accountId: 'wa-account',
    conversationId: 'wa-account:contact',
    info: { key: { id: 'remote' } },
    socket: {},
    descriptor: { kind: 'image', downloadStatus: 'pending' }
  };
  const first = queue.enqueue({ ...base, messageId: 'ready', message: { id: 'ready', timestamp: '2026-07-21T00:00:00Z' } });
  const duplicate = queue.enqueue({ ...base, messageId: 'ready', message: { id: 'ready' } });
  const failed = queue.enqueue({ ...base, messageId: 'failed', message: { id: 'failed' } });
  assert.equal(first.queued, true);
  assert.equal(first.attachment.downloadStatus, 'queued');
  assert.equal(duplicate.queued, false);
  assert.equal(failed.queued, true);
  assert.equal(persisted.length, 0);
  queue.drain();
  await waitFor(() => queue.snapshot().active === 0 && queue.snapshot().queued === 0);
  assert.equal(persisted.some(row => row.id === 'ready' && row.attachments[0].downloadStatus === 'ready'), true);
  assert.equal(persisted.some(row => row.id === 'failed' && row.attachments[0].downloadStatus === 'failed' && row.attachments[0].retryable === true && row.attachments[0].retryCount === 1 && row.attachments[0].nextRetryAt), true);
  assert.equal(events.some(row => row.type === 'whatsapp:history-media-started'), true);
  assert.equal(events.some(row => row.type === 'whatsapp:history-media-recovered'), true);
  assert.equal(events.some(row => row.type === 'whatsapp:history-media-failed'), true);
});


test('history media queue limits settle excess records explicitly instead of leaving them recovering', () => {
  const events = [];
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    concurrency: 1,
    maxQueue: 10,
    maxPerConversation: 1,
    media: { async materializeBaileys() { return { downloadStatus: 'ready' }; } },
    store: { async upsert() {} },
    events: { publish(type, payload) { events.push({ type, payload }); } },
    log: { warn() {} }
  });
  const base = {
    accountId: 'wa-account', conversationId: 'wa-account:contact', info: { key: { id: 'remote' } }, socket: {},
    descriptor: { kind: 'image', downloadStatus: 'pending' }
  };
  const queued = queue.enqueue({ ...base, messageId: 'one', message: { id: 'one' } });
  const limited = queue.enqueue({ ...base, messageId: 'two', message: { id: 'two' } });
  assert.equal(queued.attachment.downloadStatus, 'queued');
  assert.equal(limited.queued, false);
  assert.equal(limited.reason, 'conversation-limit');
  assert.equal(limited.attachment.downloadStatus, 'failed');
  assert.equal(limited.attachment.downloadError, 'MEDIA_RECOVERY_CONVERSATION_LIMIT');
  assert.equal(limited.attachment.retryable, true);
  assert.equal(events.some(row => row.type === 'whatsapp:history-media-failed' && row.payload.retryable === true), true);
});

test('customer social context resolves a direct conversation id back to its canonical contact', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-contact-reference-'));
  const store = new R32SqliteStore({ dbPath: path.join(rootDir, 'store.db') });
  try {
    store.upsertContact({
      id: 'contact-canonical', platform: 'whatsapp', accountId: 'wa-account',
      externalId: '4477000111@s.whatsapp.net', displayName: 'Alois Weigel'
    });
    store.upsertConversation({
      sessionKey: 'wa-account:4477000111@s.whatsapp.net', contactId: 'contact-canonical',
      platform: 'whatsapp', accountId: 'wa-account', title: 'Alois Weigel',
      chatJid: '4477000111@s.whatsapp.net'
    });
    const resolved = workspaceRepository.resolveContactReference('wa-account:4477000111@s.whatsapp.net', store);
    assert.equal(resolved.contact.id, 'contact-canonical');
    assert.equal(resolved.matchedBy, 'conversation-id');
  } finally {
    store.close();
    fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('startup auto-connect restores Telegram sessions that are credential-ready but initially unconfigured', async t => {
  const recovery = new RuntimeRecoveryService();
  const originalList = accountManager.list;
  const originalConnect = accountManager.connect;
  const originalGet = accountStore.get;
  t.after(() => {
    accountManager.list = originalList;
    accountManager.connect = originalConnect;
    accountStore.get = originalGet;
    recovery.stop();
  });
  accountManager.list = () => ({ accounts: [
    { id: 'telegram-session', platform: 'telegram', state: 'unconfigured', credentialReady: true },
    { id: 'telegram-empty', platform: 'telegram', state: 'unconfigured', credentialReady: false }
  ] });
  accountStore.get = id => ({ id, platform: 'telegram', paused: false, autoReconnect: true, lifecycleState: 'active' });
  const connected = [];
  accountManager.connect = async id => { connected.push(id); return { id, state: 'connected' }; };

  const status = await recovery.recover('startup-auto-connect');
  assert.deepEqual(connected, ['telegram-session']);
  assert.equal(status.lastRecovery[0].ok, true);
});

test('cloud model failure remains configured and exposes the real HTTP error', () => {
  const failed = modelStatus.normalizeModel({
    id: 'cloud-1',
    provider: 'openai-compatible',
    configured: true,
    available: true,
    endpoint: 'https://api.openai.com/v1',
    name: 'test-model',
    credentialRef: 'vault:cloud',
    qualification: 'failed',
    lastTest: { connectivity: { pass: false, status: 404, code: 'model_not_found', error: 'The model does not exist' } }
  }, {}, { credentialReady: () => true, routedTasks: [] });
  assert.equal(failed.configured, true);
  assert.equal(failed.discovered, true);
  assert.equal(failed.runtimeOnline, false);
  assert.doesNotMatch(failed.stateLabel, /模型配置未发现/u);
  assert.match(failed.stateLabel, /HTTP 404/u);
  assert.match(failed.stateLabel, /model_not_found/u);

  const recovered = modelStatus.normalizeModel({
    ...failed,
    qualification: 'experimental',
    lastTest: { connectivity: { pass: true, status: 200 } },
    lastError: ''
  }, {}, { credentialReady: () => true, routedTasks: ['general'] });
  assert.equal(recovered.runtimeOnline, true);
  assert.equal(recovered.routingEligible, true);
});

test('OpenAI-compatible test retries modern completion parameter shape after a 400 compatibility error', async () => {
  const previousFetch = global.fetch;
  const bodies = [];
  let call = 0;
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'", code: 'unsupported_parameter', param: 'max_tokens' } }), {
        status: 400,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-first' }
      });
    }
    return new Response(JSON.stringify({
      id: 'chatcmpl-test',
      model: 'returned-model',
      choices: [{ message: { content: 'YANCE_MODEL_OK' } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await cloud.chat({
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'requested-model',
      messages: [{ role: 'user', content: 'test' }],
      options: { maxTokens: 24, temperature: 0 }
    });
    assert.equal(result.text, 'YANCE_MODEL_OK');
    assert.equal(result.returnedModel, 'returned-model');
    assert.equal(result.requestMode, 'chat-completions-compatible');
    assert.equal(bodies[0].max_tokens, 24);
    assert.equal(bodies[1].max_completion_tokens, 24);
    assert.equal('temperature' in bodies[1], false);
  } finally {
    global.fetch = previousFetch;
  }
});


test('cloud model verification performs discovery, text inference and optional image inference', async t => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  const requestBodies = [];
  global.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'vision-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(init.body || '{}');
    requestBodies.push(body);
    const vision = Array.isArray(body.messages?.[0]?.content);
    return new Response(JSON.stringify({
      id: vision ? 'vision-call' : 'text-call',
      model: 'vision-model',
      choices: [{ message: { content: vision ? 'YANCE_VISION_OK' : 'YANCE_MODEL_OK' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const verification = await modelExecutor.verifyCloudAccess({
    endpoint: 'https://api.example.test/v1', apiKey: 'test-key', model: 'vision-model', runInference: true, testVision: true
  });
  assert.deepEqual(verification.models, ['vision-model']);
  assert.equal(verification.tests.text.pass, true);
  assert.equal(verification.tests.vision.pass, true);
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[1].messages[0].content.some(part => part.type === 'image_url' && /^data:image\/png;base64,/u.test(part.image_url.url)), true);
});

test('cloud model network failures expose TLS and transport error categories', async t => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    const cause = Object.assign(new Error('self signed certificate'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    throw new TypeError('fetch failed', { cause });
  };
  await assert.rejects(
    cloud.listModels({ endpoint: 'https://api.example.test/v1', apiKey: 'test-key' }),
    error => error.code === 'CLOUD_MODEL_TLS_ERROR' && error.status === 0 && /TLS|证书/u.test(error.message)
  );
});

test('Facebook avatar proxy authorizes upstream Facebook image reads without exposing page token to desktop', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'services/facebook-worker/src/metaClient.js')).href;
  const meta = await import(moduleUrl);
  let authorization = '';
  const response = await meta.fetchProfilePictureAsset('https://graph.facebook.com/example/picture', 'page-token-secret', async (_url, init) => {
    authorization = init.headers.authorization;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '3' } });
  });
  assert.equal(response.status, 200);
  assert.equal(authorization, 'Bearer page-token-secret');
  const relay = read('backend/services/facebookRelayClient.js');
  assert.match(relay, /\/api\/desktop\/avatar\/profile\?psid=/u);
  assert.match(relay, /\/api\/desktop\/avatar\/page/u);
  assert.match(read('frontend/r32-account-center.js'), /account\.page\?\.picture/u);
});

test('Facebook account state persists the proxied Page avatar into account metadata', () => {
  const manager = read('backend/services/accountManager.js');
  assert.match(manager, /account && \(payload\.user \|\| payload\.page\)/u);
  assert.match(manager, /metadata\.picture = result\.page\.picture/u);
  assert.match(manager, /metadata\.pagePicture = metadata\.picture/u);
});


test('cloud model setup discovers visible models and requires a minimum real inference before save', () => {
  const routes = read('backend/routes/models.js');
  const executor = read('backend/services/modelExecutor.js');
  const ui = read('frontend/js/r32-ai-workbench-runtime.js');
  const html = read('frontend/index.html');
  assert.match(routes, /\/cloud\/discover/u);
  assert.match(routes, /verifyCloudCredential\(\{ endpoint, credentialRef, model: name, runInference: true, testVision \}\)/u);
  assert.match(routes, /YANCE_MODEL_OK/u);
  assert.match(routes, /YANCE_VISION_OK/u);
  assert.match(executor, /Reply with exactly: YANCE_MODEL_OK/u);
  assert.match(executor, /image_url/u);
  assert.match(ui, /discoverCloudModels/u);
  assert.match(ui, /测试并保存/u);
  assert.match(ui, /availableModels/u);
  assert.match(html, /aiwCloudModelOptions/u);
  assert.match(html, /aiwDiscoverCloudModels/u);
  assert.match(html, /aiwCloudVision/u);
  assert.match(html, /读取当前 Key 可用模型/u);
});

test('source launch authority imports data-root discovery while obsolete root launchers remain quarantined', () => {
  const entry = read('tools/runtime-delivery/start-source-uat.js');
  assert.match(entry, /discoverExistingDataRoots/u);
  assert.match(entry, /inspectDataRoot/u);
  assert.match(entry, /YANCE_UAT_SELECTED_DATA_ROOT/u);
  for (const file of [
    'START_YANCE_SOURCE_UAT.cmd',
    'INSTALL_AND_START_YANCE_SOURCE_UAT.cmd',
    'START_YANCE_SOURCE_UAT_EXISTING_DATA.cmd',
    'START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.cmd',
    'INSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.cmd',
    'INSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.ps1'
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must not remain in the product source root`);
});

test('diagnostic success no longer requires a returned path and route changes clear stale status', () => {
  const system = read('frontend/r32-system-center.js');
  assert.doesNotMatch(system, /!saved\.saved/u);
  assert.doesNotMatch(system, /rawSuccess/u);
  assert.match(system, /if \(!saved\.ok\) throw new Error\('诊断报告保存失败'\)/u);
  assert.match(system, /saved\.path/u);
  assert.match(system, /clearToast\('leave-system-center'\)/u);
  assert.match(system, /clearToast\('system-center-tab-change'\)/u);
  const status = read('frontend/js/r32-system-status-runtime.js');
  assert.match(status, /retainAcrossRoutes/u);
  assert.match(status, /clear\('route-change'\)/u);
});
