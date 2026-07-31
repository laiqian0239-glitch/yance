'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AvatarSyncService, detectImageType, classifyJid } = require('../services/avatarService');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { cleanupSqliteTestStore } = require('../../tests/test-support/windows-cleanup');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(128, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0,0,0,0]), Buffer.from('WEBP'), Buffer.alloc(128, 3)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(128, 4)]);

function response(status, buffer = Buffer.alloc(0), headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => headers[String(key).toLowerCase()] || '' },
    body: (async function* stream() { if (buffer.length) yield buffer; })()
  };
}

function makeHarness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-avatar-test-'));
  const conversations = new Map();
  const logs = [];
  let fileCounter = 0;
  const media = {
    saveBuffer({ accountId, conversationId, buffer, descriptor }) {
      const dir = path.join(root, accountId, conversationId.replace(/[^a-z0-9._-]/gi, '_'));
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `avatar-${++fileCounter}.${descriptor.mimeType.split('/')[1].replace('jpeg', 'jpg')}`;
      const target = path.join(dir, fileName);
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, buffer);
      fs.renameSync(temp, target);
      return {
        localFile: target,
        mediaUrl: `/api/r32/messages/media/${encodeURIComponent(accountId)}/${encodeURIComponent(conversationId.replace(/[^a-z0-9._-]/gi, '_'))}/${encodeURIComponent(fileName)}`
      };
    },
    resolveFile(accountId, conversationId, fileName) {
      const file = path.join(root, accountId, conversationId, fileName);
      return fs.existsSync(file) ? file : '';
    }
  };
  const store = {
    getConversation(id) { return conversations.get(id) || null; },
    async updateConversationMetadata(id, patch) {
      if (options.databaseFailure) throw Object.assign(new Error('SQLITE_WRITE_FAILED'), { code: 'SQLITE_WRITE_FAILED' });
      const current = conversations.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      if (patch.clearAvatar) next.avatarUrl = '';
      conversations.set(id, next);
      return next;
    }
  };
  const service = new AvatarSyncService({
    fetchImpl: options.fetchImpl || (async () => response(200, JPEG)),
    mediaPipeline: media,
    messageStore: store,
    logger: { warn: (_channel, message, detail) => logs.push({ message, detail }) },
    concurrency: options.concurrency || 4,
    timeoutMs: options.timeoutMs || 100,
    profileUrlTimeoutMs: options.profileUrlTimeoutMs || 10000,
    refreshIntervalMs: options.refreshIntervalMs || 6 * 60 * 60 * 1000,
    knownPlatformAvatarHashes: options.knownPlatformAvatarHashes
  });
  function addConversation(id, patch = {}) {
    const row = { id, conversationId: id, sessionKey: id, accountId: 'wa-db', contactId: `contact-${id}`, chatJid: `${id}@s.whatsapp.net`, avatarUrl: '', avatarUpdatedAt: '', avatarStatus: '', ...patch };
    conversations.set(id, row);
    return row;
  }
  function task(id, patch = {}) {
    return { accountId: 'wa-db', conversationId: id, contactId: `contact-${id}`, jid: `${id}@s.whatsapp.net`, socket: { profilePictureUrl: async () => 'https://cdn.example/avatar' }, ...patch };
  }
  function cleanup() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  return { root, service, store, media, logs, conversations, addConversation, task, cleanup };
}

function allFiles(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else result.push(full);
  });
  walk(root);
  return result;
}

test('magic-byte validation accepts JPEG/PNG/WebP/GIF and rejects HTML/JSON', () => {
  assert.equal(detectImageType(JPEG).mimeType, 'image/jpeg');
  assert.equal(detectImageType(PNG).mimeType, 'image/png');
  assert.equal(detectImageType(WEBP).mimeType, 'image/webp');
  assert.equal(detectImageType(GIF).mimeType, 'image/gif');
  assert.equal(detectImageType(Buffer.from('<html>not image</html>')), null);
  assert.equal(detectImageType(Buffer.from('{"error":"not image"}')), null);
});

test('JID normalization distinguishes contacts, groups, broadcast, newsletter and system identities', () => {
  assert.deepEqual(classifyJid('49123:7@s.whatsapp.net'), { jid: '49123@s.whatsapp.net', kind: 'contact', applicable: true });
  assert.equal(classifyJid('12345@g.us').kind, 'group');
  assert.equal(classifyJid('status@broadcast').applicable, false);
  assert.equal(classifyJid('news@newsletter').kind, 'newsletter');
  assert.equal(classifyJid('server@system').kind, 'system');
});

test('first sync downloads, validates, atomically caches and only then persists ready state', async t => {
  const h = makeHarness(); t.after(h.cleanup);
  h.addConversation('100');
  const result = await h.service.syncWhatsAppContact(h.task('100'));
  assert.equal(result.status, 'downloaded');
  const row = h.conversations.get('100');
  assert.equal(row.avatarStatus, 'ready');
  assert.match(row.avatarUrl, /^\/api\/r32\/messages\/media\//);
  assert.ok(row.avatarUpdatedAt);
  assert.equal(h.service.validateCachedAvatar(row.avatarUrl).valid, true);
  assert.equal(allFiles(h.root).some(file => file.endsWith('.tmp')), false);
});

test('profilePictureUrl empty clears a broken cache and records profile-url-empty', async t => {
  const h = makeHarness(); t.after(h.cleanup);
  h.addConversation('101', { avatarUrl: '/api/r32/messages/media/wa-db/missing/old.jpg', avatarUpdatedAt: new Date().toISOString(), avatarStatus: 'ready' });
  const result = await h.service.syncWhatsAppContact(h.task('101', { force: true, socket: { profilePictureUrl: async () => '' } }));
  assert.equal(result.status, 'unavailable');
  assert.equal(h.conversations.get('101').avatarUrl, '');
  assert.equal(h.conversations.get('101').avatarStatus, 'profile-url-empty');
});

test('avatar replacement cleans superseded files while empty profile lookup preserves a known-good cache', async t => {
  let payload = PNG;
  const h = makeHarness({ fetchImpl: async () => response(200, payload) }); t.after(h.cleanup);
  h.addConversation('cleanup');
  const first = await h.service.cacheBuffer({ accountId: 'wa-db', conversationId: 'cleanup', buffer: JPEG, source: 'seed' });
  assert.equal(fs.existsSync(first.localFile), true);
  const replaced = await h.service.syncWhatsAppContact(h.task('cleanup', { force: true }));
  assert.equal(replaced.status, 'downloaded');
  assert.equal(fs.existsSync(first.localFile), false);
  assert.equal(fs.existsSync(replaced.localFile), true);
  assert.equal(allFiles(h.root).some(file => file.endsWith('.tmp')), false);

  const preservedFile = replaced.localFile;
  const unavailable = await h.service.syncWhatsAppContact(h.task('cleanup', { force: true, socket: { profilePictureUrl: async () => '' } }));
  assert.equal(unavailable.avatarStatus, 'profile-url-empty');
  assert.equal(unavailable.avatarUrl, replaced.avatarUrl);
  assert.equal(fs.existsSync(preservedFile), true);
  assert.equal(h.conversations.get('cleanup').avatarUrl, replaced.avatarUrl);
});



test('profilePictureUrl tries PN and LID candidates with an explicit timeout and logs empty responses', async t => {
  const calls = [];
  const h = makeHarness({ profileUrlTimeoutMs: 10000 }); t.after(h.cleanup);
  h.addConversation('pn-lid');
  const socket = {
    serverProps: { profilePicPrivacyToken: true },
    async profilePictureUrl(jid, type, timeoutMs) {
      calls.push({ jid, type, timeoutMs });
      if (jid.endsWith('@lid') && type === 'image') return 'https://cdn.example/avatar-lid';
      return undefined;
    }
  };
  const result = await h.service.syncWhatsAppContact(h.task('pn-lid', {
    socket,
    jid: '49123456789@s.whatsapp.net',
    jidCandidates: ['8844221100@lid'],
    reason: 'test-lid-fallback'
  }));
  assert.equal(result.status, 'downloaded');
  assert.equal(result.resolvedJid, '8844221100@lid');
  assert.deepEqual(calls, [
    { jid: '49123456789@s.whatsapp.net', type: 'image', timeoutMs: 10000 },
    { jid: '49123456789@s.whatsapp.net', type: 'preview', timeoutMs: 10000 },
    { jid: '8844221100@lid', type: 'image', timeoutMs: 10000 }
  ]);
  const emptyLogs = h.logs.filter(row => row.message === 'avatar-profile-picture-url-empty');
  assert.equal(emptyLogs.length, 2);
  assert.equal(emptyLogs[0].detail.profilePicPrivacyToken, true);
  assert.equal(emptyLogs[0].detail.reason, 'test-lid-fallback');
  assert.equal(emptyLogs[0].detail.timeoutMs, 10000);
  assert.equal(Object.hasOwn(emptyLogs[0].detail, 'candidateJid'), false);
});


test('WhatsApp Business avatars are trusted by WhatsApp provenance even when pixels contain another brand logo', async t => {
  const brandedHash = require('crypto').createHash('sha256').update(JPEG).digest('hex');
  const known = new Map([[brandedHash, { platform: 'facebook', reasonCode: 'test-brand-logo' }]]);
  const h = makeHarness({ knownPlatformAvatarHashes: known, fetchImpl: async () => response(200, JPEG) });
  t.after(h.cleanup);
  h.addConversation('business-brand', { platform: 'whatsapp' });
  const seeded = h.media.saveBuffer({
    accountId: 'wa-db', conversationId: 'business-brand', buffer: JPEG,
    descriptor: { kind: 'image', mimeType: 'image/jpeg', filename: 'contact-avatar.jpg', source: 'whatsapp-profile' }
  });
  h.conversations.set('business-brand', {
    ...h.conversations.get('business-brand'),
    avatarUrl: seeded.mediaUrl,
    avatarStatus: 'ready',
    avatarUpdatedAt: new Date().toISOString()
  });
  assert.equal(h.service.validateCachedAvatar(seeded.mediaUrl, { expectedPlatform: 'whatsapp' }).valid, true);
  assert.equal(h.service.needsRefresh('business-brand'), false);
  assert.equal(fs.existsSync(seeded.localFile), true);
});

test('privacy restriction and HTTP 403/404 are explicit and are not retried indefinitely', async t => {
  const h403 = makeHarness({ fetchImpl: async () => response(403) }); t.after(h403.cleanup);
  h403.addConversation('102');
  const forbidden = await h403.service.syncWhatsAppContact(h403.task('102'));
  assert.equal(forbidden.avatarStatus, 'privacy-restricted');
  assert.equal(h403.logs.at(-1).detail.errorCode, 'http-403');

  const h404 = makeHarness({ fetchImpl: async () => response(404) }); t.after(h404.cleanup);
  h404.addConversation('103');
  const missing = await h404.service.syncWhatsAppContact(h404.task('103'));
  assert.equal(missing.avatarStatus, 'no-profile-photo');
  assert.equal(h404.logs.at(-1).detail.errorCode, 'http-404');
});

test('request timeout becomes fetch-timeout without blocking the queue forever', async t => {
  const h = makeHarness({ timeoutMs: 50, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  }) });
  t.after(h.cleanup);
  h.addConversation('104');
  const result = await h.service.syncWhatsAppContact(h.task('104', { retries: 0 }));
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'fetch-timeout');
  assert.equal(h.conversations.get('104').avatarStatus, 'fetch-timeout');
});

for (const [label, payload] of [['HTML', Buffer.from('<html>403</html>')], ['JSON', Buffer.from('{"error":true}')]]) {
  test(`${label} response is never relabeled as image/jpeg`, async t => {
    const h = makeHarness({ fetchImpl: async () => response(200, payload, { 'content-type': 'image/jpeg' }) }); t.after(h.cleanup);
    h.addConversation(`fake-${label}`);
    const result = await h.service.syncWhatsAppContact(h.task(`fake-${label}`, { retries: 0 }));
    assert.equal(result.errorCode, 'invalid-image');
    assert.equal(h.conversations.get(`fake-${label}`).avatarUrl, '');
  });
}

test('missing or corrupt cache bypasses the six-hour TTL and is repaired immediately', async t => {
  const h = makeHarness(); t.after(h.cleanup);
  const fresh = new Date().toISOString();
  h.addConversation('105', { avatarUrl: '/api/r32/messages/media/wa-db/missing/avatar.jpg', avatarUpdatedAt: fresh, avatarStatus: 'ready' });
  assert.equal(h.service.needsRefresh('105'), true);
  const repaired = await h.service.syncWhatsAppContact(h.task('105'));
  assert.equal(repaired.cacheRepaired, true);

  h.addConversation('106');
  const first = await h.service.cacheBuffer({ accountId: 'wa-db', conversationId: '106', buffer: JPEG, source: 'test' });
  fs.writeFileSync(first.localFile, Buffer.from('<html>corrupt</html>'));
  assert.equal(h.service.needsRefresh('106'), true);
  const repairedCorrupt = await h.service.syncWhatsAppContact(h.task('106'));
  assert.equal(repairedCorrupt.cacheRepaired, true);
});

test('database update failure rolls back the just-written cache file and records a structured failure', async t => {
  const h = makeHarness({ databaseFailure: true }); t.after(h.cleanup);
  h.addConversation('107');
  const result = await h.service.syncWhatsAppContact(h.task('107', { retries: 0 }));
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'database-update-failed');
  assert.equal(allFiles(h.root).length, 0);
  assert.ok(h.logs.some(row => row.detail.stage === 'download-validate-persist' && row.detail.errorCode === 'database-update-failed'));
  assert.equal(JSON.stringify(h.logs).includes('cdn.example'), false);
});

test('transient network failure retries once with backoff and then succeeds', async t => {
  let calls = 0;
  const h = makeHarness({ fetchImpl: async () => (++calls === 1 ? response(500) : response(200, JPEG)) }); t.after(h.cleanup);
  h.addConversation('108');
  const result = await h.service.syncWhatsAppContact(h.task('108', { retries: 1 }));
  assert.equal(result.status, 'downloaded');
  assert.equal(calls, 2);
});

test('final retry failure records the actual attempt count without exposing the signed CDN URL', async t => {
  const h = makeHarness({ fetchImpl: async () => response(500) }); t.after(h.cleanup);
  h.addConversation('retry-fail');
  const result = await h.service.syncWhatsAppContact(h.task('retry-fail', { retries: 1 }));
  assert.equal(result.status, 'failed');
  const failure = h.logs.find(row => row.message === 'avatar-sync-failed' && row.detail.stage === 'download-validate-persist');
  assert.equal(failure.detail.attempt, 2);
  assert.equal(JSON.stringify(failure).includes('cdn.example'), false);
});

test('queue enforces bounded concurrency and de-duplicates identical JIDs', async t => {
  let active = 0;
  let maximum = 0;
  let fetchCalls = 0;
  const h = makeHarness({ concurrency: 3, fetchImpl: async () => {
    fetchCalls += 1; active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active -= 1; return response(200, JPEG);
  } });
  t.after(h.cleanup);
  const tasks = [];
  for (let index = 0; index < 18; index += 1) { h.addConversation(`bulk-${index}`); tasks.push(h.task(`bulk-${index}`)); }
  const stats = await h.service.syncWhatsAppContacts(tasks);
  assert.equal(stats.contactsScanned, 18);
  assert.equal(stats.avatarsDownloaded, 18);
  assert.ok(maximum <= 3);

  h.addConversation('dedupe');
  const duplicateTask = h.task('dedupe');
  const before = fetchCalls;
  const [a, b] = await Promise.all([h.service.enqueueWhatsApp(duplicateTask), h.service.enqueueWhatsApp(duplicateTask)]);
  assert.equal(a.avatarUrl, b.avatarUrl);
  assert.equal(fetchCalls - before, 1);
  assert.deepEqual(h.service.snapshot(), { concurrency: 3, active: 0, queued: 0, deduplicatedKeys: 0 });
});

test('manual sync returns the required machine-readable avatar statistics', async t => {
  const h = makeHarness(); t.after(h.cleanup);
  h.addConversation('ready');
  h.addConversation('none');
  const stats = await h.service.syncWhatsAppContacts([
    h.task('ready'),
    h.task('none', { socket: { profilePictureUrl: async () => '' } }),
    h.task('ignored', { jid: 'status@broadcast' })
  ]);
  for (const field of ['contactsScanned','avatarsRequested','avatarsDownloaded','avatarsUnchanged','avatarsUnavailable','avatarsFailed','cacheRepaired']) assert.equal(typeof stats[field], 'number');
  assert.equal(stats.contactsScanned, 3);
  assert.equal(stats.avatarsRequested, 2);
  assert.equal(stats.avatarsDownloaded, 1);
  assert.equal(stats.avatarsUnavailable, 1);
});

test('SQLite cleanup closes the store before bounded EBUSY-aware directory removal', () => {
  const steps = [];
  cleanupSqliteTestStore(
    { close: () => steps.push('close') },
    'C:/temp/avatar-db',
    {
      rmSync: (_dir, options) => {
        steps.push('remove');
        assert.deepEqual(options, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50
        });
      }
    }
  );
  assert.deepEqual(steps, ['close', 'remove']);
});

test('SQLite persists avatar_url, avatar_updated_at and avatar_status for contacts and conversations', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-avatar-db-'));
  const store = new R32SqliteStore({ dbPath: path.join(dir, 'avatar.db') });
  t.after(() => cleanupSqliteTestStore(store, dir));
  store.upsertContact({ id: 'contact-1', platform: 'whatsapp', accountId: 'wa-db', externalId: '1@s.whatsapp.net', displayName: 'Contact', avatarUrl: '/api/r32/messages/media/a/b/c.jpg', avatarUpdatedAt: '2026-07-13T00:00:00.000Z', avatarStatus: 'ready' });
  store.upsertConversation({ sessionKey: 'conv-1', contactId: 'contact-1', platform: 'whatsapp', accountId: 'wa-db', title: 'Contact', avatarUrl: '/api/r32/messages/media/a/b/c.jpg', avatarUpdatedAt: '2026-07-13T00:00:00.000Z', avatarStatus: 'ready' });
  assert.deepEqual({ ...store.db.prepare('SELECT avatar_url, avatar_updated_at, avatar_status FROM contacts WHERE id=?').get('contact-1') }, { avatar_url: '/api/r32/messages/media/a/b/c.jpg', avatar_updated_at: '2026-07-13T00:00:00.000Z', avatar_status: 'ready' });
  assert.deepEqual({ ...store.db.prepare('SELECT avatar_url, avatar_updated_at, avatar_status FROM r32_conversations WHERE session_key=?').get('conv-1') }, { avatar_url: '/api/r32/messages/media/a/b/c.jpg', avatar_updated_at: '2026-07-13T00:00:00.000Z', avatar_status: 'ready' });
});

test('Telegram buffer and Facebook signed-proxy avatar paths remain compatible with the shared service', async t => {
  const h = makeHarness({ fetchImpl: async () => response(200, JPEG) }); t.after(h.cleanup);

  h.addConversation('telegram-contact');
  const telegramUrl = await h.service.bestEffort({
    accountId: 'tg-db',
    conversationId: 'telegram-contact',
    buffer: PNG,
    source: 'telegram-profile',
    force: true
  });
  assert.match(telegramUrl, /^\/api\/r32\/messages\/media\//);
  assert.equal(h.conversations.get('telegram-contact').avatarStatus, 'ready');
  assert.equal(h.conversations.get('telegram-contact').avatarSource, 'telegram-profile');
  assert.equal(h.service.validateCachedAvatar(telegramUrl).valid, true);

  h.addConversation('facebook-contact');
  const facebookUrl = await h.service.bestEffort({
    accountId: 'fb-db',
    conversationId: 'facebook-contact',
    url: 'https://graph.example/avatar',
    source: 'facebook-profile',
    force: true
  });
  assert.match(facebookUrl, /^\/api\/r32\/messages\/media\//);
  assert.equal(h.conversations.get('facebook-contact').avatarStatus, 'ready');
  assert.equal(h.conversations.get('facebook-contact').avatarSource, 'facebook-profile');
  assert.equal(h.service.validateCachedAvatar(facebookUrl).valid, true);

  const root = path.resolve(__dirname, '..', '..');
  const telegramAdapter = fs.readFileSync(path.join(root, 'backend/services/telegramAdapter.js'), 'utf8');
  const facebookAdapter = fs.readFileSync(path.join(root, 'backend/services/facebookAdapter.js'), 'utf8');
  assert.match(telegramAdapter, /avatarService\.bestEffort\([\s\S]*source: 'telegram-profile'/);
  assert.match(facebookAdapter, /avatarBufferWithRetry\(secret, 'profile'/);
  assert.match(facebookAdapter, /avatarService\.cacheBuffer\([\s\S]*source: 'facebook-profile-proxy'/);
});

test('manual account sync exposes all required avatar counters in the visible result message', () => {
  const root = path.resolve(__dirname, '..', '..');
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  for (const field of ['contactsScanned','avatarsRequested','avatarsDownloaded','avatarsUnchanged','avatarsUnavailable','avatarsFailed','cacheRepaired']) {
    assert.match(runtime, new RegExp(`\\b${field}\\b`));
  }
  assert.match(runtime, /formatAccountSyncSummary/);
  assert.match(runtime, /已同步 \${stats\.okAccounts} 个账号/);
  assert.match(runtime, /修复缓存 \${stats\.cacheRepaired}/);
});

test('WhatsApp trigger matrix and frontend same-origin fallback/versioning are wired', () => {
  const root = path.resolve(__dirname, '..', '..');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/whatsappAdapter.js'), 'utf8');
  const avatarRuntime = fs.readFileSync(path.join(root, 'frontend/js/sqliteConversationRuntime.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'backend/routes/accounts.js'), 'utf8');
  assert.match(adapter, /reason: 'connection-ready'/);
  assert.match(adapter, /socket\.resyncAppState[\s\S]*reason: 'connection-app-state-ready'/);
  assert.match(adapter, /reconcileKnownIdentities\(accountId, databaseAccountId, socket/);
  assert.match(adapter, /contacts\.upsert[\s\S]*queueAvatarRows/);
  assert.match(adapter, /contacts\.update[\s\S]*queueAvatarRows/);
  assert.match(adapter, /new-contact-message/);
  assert.match(adapter, /reason: 'manual-sync'/);
  assert.doesNotMatch(adapter, /catch \(_\) \{\}[\s\S]{0,120}profilePictureUrl/);
  assert.match(avatarRuntime, /parsed\.origin !== window\.location\.origin/);
  assert.match(avatarRuntime, /\/api\/r32\/messages\/media\//);
  assert.match(avatarRuntime, /searchParams\.set\('v', version\)/);
  assert.match(avatarRuntime, /fallbackApplied/);
  assert.match(avatarRuntime, /avatar-load-failure/);
  assert.match(routes, /avatar-load-failure/);
});

test('bulk avatar sync bounds submitted work to worker concurrency instead of filling an unbounded queue', async t => {
  const h = makeHarness({ concurrency: 3 }); t.after(h.cleanup);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let submitted = 0;
  h.service.enqueueWhatsApp = async () => {
    submitted += 1;
    await gate;
    return { status: 'unchanged' };
  };
  const inputs = Array.from({ length: 40 }, (_, index) => h.task(`bounded-${index}`));
  const pending = h.service.syncWhatsAppContacts(inputs);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted, 3);
  release();
  const result = await pending;
  assert.equal(result.contactsScanned, 40);
  assert.equal(result.results.length, 40);
});

test('bulk avatar sync aborts active transport work and does not convert operation cancellation into an avatar failure', async t => {
  let observedSignal = null;
  const h = makeHarness({
    fetchImpl: async (_url, options = {}) => {
      observedSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
  });
  t.after(h.cleanup);
  h.addConversation('abort-active');
  const controller = new AbortController();
  const pending = h.service.syncWhatsAppContacts([h.task('abort-active')], { signal: controller.signal });
  while (!observedSignal) await new Promise(resolve => setImmediate(resolve));
  controller.abort(Object.assign(new Error('WhatsApp sync stopped'), { code: 'WHATSAPP_SYNC_ABORTED' }));
  await assert.rejects(pending, error => error.code === 'WHATSAPP_SYNC_ABORTED');
  assert.equal(observedSignal.aborted, true);
  assert.equal(h.conversations.get('abort-active').avatarStatus, '');
});

test('avatar refresh memo is bounded and evicts the oldest conversation key', () => {
  const service = new AvatarSyncService({ maxRefreshEntries: 2, backgroundJobs: null });
  service.rememberRefresh('conversation-a', 1);
  service.rememberRefresh('conversation-b', 2);
  service.rememberRefresh('conversation-c', 3);
  assert.deepEqual([...service.refreshedAt.keys()], ['conversation-b', 'conversation-c']);
});
