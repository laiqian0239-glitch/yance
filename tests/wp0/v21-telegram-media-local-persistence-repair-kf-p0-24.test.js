'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mediaPipeline = require('../../backend/services/mediaPipeline');
const messageStore = require('../../backend/services/messageStore');
const { TelegramAdapter } = require('../../backend/services/telegramAdapter');
const { LocalPersistenceRepairService } = require('../../backend/services/localPersistenceRepairService');
const {
  localPersistenceRepairInput,
  persistLocalPersistenceRepair
} = require('../../backend/services/durableOperations/outboundMessageSendOperation');

function patch(object, replacements) {
  const originals = {};
  for (const [key, value] of Object.entries(replacements)) {
    originals[key] = object[key];
    object[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(originals)) object[key] = value;
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function attempt(overrides = {}) {
  return {
    attemptId: 'attempt-kf-p0-24',
    commandReference: 'queue-kf-p0-24',
    platform: 'telegram',
    accountReference: 'account-kf-p0-24',
    ...overrides
  };
}

test('KF-P0-24 RED: provider-accepted Telegram media repair survives durable restart boundary without caller-owned source path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-kf-p0-24-'));
  const sourcePath = path.join(root, 'telegram-upload.bin');
  const bytes = Buffer.from('kf-p0-24-telegram-provider-accepted-media', 'utf8');
  const expectedSha256 = sha256(bytes);
  fs.writeFileSync(sourcePath, bytes);

  const adapter = new TelegramAdapter();
  let providerSends = 0;
  adapter.sessions.set('account-kf-p0-24', {
    state: 'connected',
    client: {
      async sendFile() {
        providerSends += 1;
        return { id: 'remote-kf-p0-24' };
      }
    }
  });

  let upsertCalls = 0;
  const attachment = {
    localFile: path.join(root, 'durable-telegram-media.bin'),
    mediaUrl: '/api/r32/messages/media/account/conversation/durable-telegram-media.bin',
    fileHash: expectedSha256,
    size: bytes.length
  };
  const restoreMedia = patch(mediaPipeline, {
    saveFile() {
      return attachment;
    },
    saveBuffer(input) {
      assert.deepEqual(input.buffer, bytes, 'durable repair custody must retain the exact Telegram media bytes');
      return attachment;
    }
  });
  const restoreMessages = patch(messageStore, {
    async upsert(message) {
      upsertCalls += 1;
      if (upsertCalls === 1) {
        throw Object.assign(new Error('forced local projection failure after provider acceptance'), {
          code: 'SQLITE_BUSY'
        });
      }
      return message;
    }
  });

  try {
    const result = await adapter.sendMedia('account-kf-p0-24', 'telegram:peer-kf-p0-24', {
      kind: 'document',
      filePath: sourcePath,
      mimeType: 'application/octet-stream',
      filename: 'telegram-upload.bin',
      localMessageId: 'message-kf-p0-24',
      sessionKey: 'conversation-kf-p0-24',
      expectedSha256
    });

    assert.equal(providerSends, 1, 'diagnostic must model exactly one accepted provider send');
    assert.equal(result.messageId, 'remote-kf-p0-24');
    assert.equal(result.localPersistencePending, true);
    assert.equal(result.localPersistenceRepair?.kind, 'outbound-media-upsert');
    assert.equal(result.localPersistenceRepair?.sourceFile, path.resolve(sourcePath));
    assert.equal(result.localPersistenceRepair?.expectedSha256, expectedSha256);
    assert.equal(Object.prototype.hasOwnProperty.call(result.localPersistenceRepair || {}, 'source'), false,
      'current Telegram repair contract exposes the source at the repair root rather than the canonical source object');

    let persisted = null;
    const receipt = persistLocalPersistenceRepair({
      enqueueLocalPersistenceRepair(input) {
        persisted = JSON.parse(JSON.stringify(input));
        return { id: input.id, state: 'pending' };
      }
    }, attempt(), {
      localPersistencePending: result.localPersistencePending,
      platformMessageId: result.messageId,
      localPersistenceRepair: result.localPersistenceRepair
    });

    assert.equal(receipt.id, 'local-repair-attempt-kf-p0-24');
    assert.ok(persisted, 'Telegram repair must cross the durable enqueue boundary before success escapes');
    assert.equal(persisted.id, 'local-repair-attempt-kf-p0-24');
    assert.equal(persisted.queueId, 'queue-kf-p0-24');
    assert.equal(persisted.platform, 'telegram');

    fs.rmSync(sourcePath, { force: true });
    assert.equal(fs.existsSync(sourcePath), false, 'diagnostic must model restart/transient source loss');

    const service = new LocalPersistenceRepairService();
    await assert.doesNotReject(
      () => service.apply(persisted),
      'provider-accepted Telegram media repair must remain consumable after its caller-owned source path disappears'
    );
    assert.equal(providerSends, 1, 'local projection repair must never resend the accepted Telegram message');
    assert.equal(upsertCalls, 2, 'repair must complete the canonical local message projection exactly once after the forced failure');
  } finally {
    restoreMessages();
    restoreMedia();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

test('KF-P0-24 preserve: Telegram non-media repair keeps deterministic durable identity and pass-through semantics', () => {
  const payload = {
    kind: 'message-upsert',
    message: {
      id: 'message-kf-p0-24-preserve',
      accountId: 'account-kf-p0-24',
      conversationId: 'conversation-kf-p0-24-preserve',
      platform: 'telegram'
    }
  };
  const repair = localPersistenceRepairInput(attempt(), {
    localPersistencePending: true,
    localPersistenceRepair: payload
  });

  assert.equal(repair.id, 'local-repair-attempt-kf-p0-24');
  assert.equal(repair.queueId, 'queue-kf-p0-24');
  assert.equal(repair.platform, 'telegram');
  assert.equal(repair.accountId, 'account-kf-p0-24');
  assert.equal(repair.conversationId, 'conversation-kf-p0-24-preserve');
  assert.deepEqual(repair.payload, payload);
});

test('KF-P0-24 preserve: canonical buffer-backed media repair shape is already consumable without provider resend', async () => {
  const bytes = Buffer.from('kf-p0-24-buffer-preserve', 'utf8');
  let saveBufferCalls = 0;
  let upsertCalls = 0;
  const restoreMedia = patch(mediaPipeline, {
    saveBuffer(input) {
      saveBufferCalls += 1;
      assert.deepEqual(input.buffer, bytes);
      return { localFile: '/durable/telegram-buffer.bin', mediaUrl: '/media/telegram-buffer.bin' };
    }
  });
  const restoreMessages = patch(messageStore, {
    async upsert(message) {
      upsertCalls += 1;
      return message;
    }
  });

  try {
    const service = new LocalPersistenceRepairService();
    await service.apply({
      id: 'local-repair-kf-p0-24-buffer',
      payload: {
        kind: 'outbound-media-upsert',
        message: {
          id: 'message-kf-p0-24-buffer',
          externalMessageId: 'remote-kf-p0-24-buffer',
          accountId: 'account-kf-p0-24',
          conversationId: 'conversation-kf-p0-24-buffer',
          platform: 'telegram'
        },
        source: {
          bufferBase64: bytes.toString('base64'),
          expectedSha256: sha256(bytes)
        },
        descriptor: {
          kind: 'document',
          mimeType: 'application/octet-stream',
          filename: 'telegram-buffer.bin'
        }
      }
    });
    assert.equal(saveBufferCalls, 1);
    assert.equal(upsertCalls, 1);
  } finally {
    restoreMessages();
    restoreMedia();
  }
});
