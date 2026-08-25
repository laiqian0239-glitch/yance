'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  createSessionGenerationFence,
  createSocketGenerationGuard
} = require('../../backend/services/sessionGenerationFence');

const ROOT = path.resolve(__dirname, '../..');
const WHATSAPP = fs.readFileSync(path.join(ROOT, 'backend/services/whatsappAdapter.js'), 'utf8');

function section(startMarker, endMarker, source = WHATSAPP) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function generationOwnedContext(source, needle) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `missing required production seam: ${needle}`);
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const linePrefix = source.slice(lineStart, index);
  if (/\bawait\s*$/u.test(linePrefix)) return true;
  const context = source.slice(Math.max(0, index - 320), index);
  return /(socketGuard\.wrap|runSocketGenerationTask|launchSocketGenerationTask|scheduleSocketGenerationTask)/u.test(context);
}

function requireGenerationOwned(source, needles, label) {
  const detached = needles.filter(needle => !generationOwnedContext(source, needle));
  assert.deepEqual(detached, [], `${label} must keep every async continuation inside generation drain custody`);
}

test('KF-P0-22 preserve: the existing socket guard can own an explicitly launched background Promise', async () => {
  const fence = createSessionGenerationFence(() => true, { prefix: 'whatsapp:kf-p0-22-preserve' });
  const guard = createSocketGenerationGuard(fence, () => true);
  const started = deferred();
  const release = deferred();
  let finished = false;

  const background = guard.wrap(async () => {
    started.resolve();
    await release.promise;
    finished = true;
  })();
  await started.promise;
  fence.invalidate('WHATSAPP_STOP');
  let drained = false;
  const draining = fence.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false, 'explicitly wrapped background work must remain visible to generation drain');
  release.resolve();
  await background;
  await draining;
  assert.equal(finished, true);
});

test('KF-P0-22 connection.update background Promise/timer graph remains generation-owned after the online handler returns', () => {
  const source = section("onSocket('connection.update'", "onSocket('messaging-history.set'");
  requireGenerationOwned(source, [
    'this.reconcileKnownIdentities(accountId, databaseAccountId, socket',
    'this.subscribeKnownConversations(accountId)',
    "this.queueKnownAvatarSync(accountId, databaseAccountId, socket, { reason: 'connection-ready' })",
    'hydrateWhatsAppBusinessProfiles({ databaseAccountId, socket, limit: 30 })',
    'requestLegacyWhatsAppMediaHistory({ databaseAccountId, socket, maxRequests: 12, count: 50 })',
    'socket.resyncAppState(row.appStateCollections, true)'
  ], 'connection.update');

  assert.match(source, /mobile-device-echo-placeholders-removed/u,
    'synchronous mobile-echo repair remains an explicit preserve/negative-proof boundary');
});

test('KF-P0-22 messages.upsert and messaging-history.set background media/avatar/presence work remains generation-owned', () => {
  const history = section("onSocket('messaging-history.set'", "onSocket('messages.upsert'");
  requireGenerationOwned(history, [
    "this.queueKnownAvatarSync(accountId, databaseAccountId, socket, { reason: 'history-sync' })"
  ], 'messaging-history.set');

  const messages = section("onSocket('messages.upsert'", "onSocket('lid-mapping.update'");
  requireGenerationOwned(messages, [
    'this.ensurePresenceSubscription(accountId, message.chatJid)',
    'mediaPipeline.materializeBaileys({',
    'avatarService.enqueueWhatsApp(task)'
  ], 'messages.upsert');
  assert.match(messages, /syncCheckpoint\.(commit|fail)\(/u,
    'message checkpoint terminalization must remain in the guarded parent path');
});

test('KF-P0-22 presence metadata persistence and nested identity avatar work cannot escape parent generation custody', () => {
  const presence = section("onSocket('presence.update'", "onSocket('messages.update'");
  requireGenerationOwned(presence, [
    'messageStore.updateConversationMetadata('
  ], 'presence.update');

  const reconcile = section('  async reconcileKnownIdentities(', '  avatarTaskForConversation(');
  const directAwait = /await\s+avatarService\.enqueueWhatsApp\(task\)/u.test(reconcile);
  const joinedBatch = /avatarJobs\.push\(\s*avatarService\.enqueueWhatsApp\(task\)/u.test(reconcile)
    && /await\s+Promise\.(?:all|allSettled)\(avatarJobs\)/u.test(reconcile);
  assert.equal(directAwait || joinedBatch, true,
    'reconcileKnownIdentities must await or join every avatar Promise before its guarded generation task settles');
});

test('KF-P0-22 negative proof: returned-Promise directory handlers already remain owned by createSocketGenerationGuard', () => {
  for (const eventName of ['chats.upsert', 'chats.update', 'contacts.upsert', 'contacts.update']) {
    const source = section(`onSocket('${eventName}'`, eventName === 'contacts.update' ? "assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED'" : `onSocket('${({ 'chats.upsert': 'chats.update', 'chats.update': 'contacts.upsert', 'contacts.upsert': 'contacts.update' })[eventName]}'`);
    assert.match(source, /return\s+this\.queueAvatarRows\([\s\S]*?\.catch\(/u,
      `${eventName} must keep returning its async avatar Promise to the socket guard`);
  }
});

test('KF-P0-22 negative proof: durable history-media recovery owns cross-generation retry/fencing independently of socket-event custody', () => {
  const source = fs.readFileSync(path.join(ROOT, 'backend/services/whatsappHistoryMediaRecovery.js'), 'utf8');
  assert.match(source, /currentRuntimeInternalOperationAuthority/u);
  assert.match(source, /beginDurableMedia\(/u);
  assert.match(source, /failDurableMedia\(/u);
  assert.match(source, /succeedDurableMedia\(/u);
  assert.match(source, /generation:\s*lease\.generation/u,
    'durable media recovery must retain its own operation-generation fencing and is not replaced by socket-event custody');
});

test('KF-P0-22 preserves KF-P0-19 stop/drain and stale-entry quarantine contracts', () => {
  const contracts = [
    path.join(ROOT, 'tests/wp0/v21-whatsapp-stale-socket-inflight-custody-kf-p0-19.test.js'),
    path.join(ROOT, 'backend/tests/batch39WhatsappSessionFence.test.js')
  ];
  for (const contract of contracts) {
    const run = spawnSync(process.execPath, ['--test', contract], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' }
    });
    assert.equal(run.status, 0, `${path.relative(ROOT, contract)}\n${run.stdout || ''}\n${run.stderr || ''}`);
  }
});
