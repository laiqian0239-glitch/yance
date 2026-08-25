'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mediaPipeline = require('../../backend/services/mediaPipeline');
const messageStore = require('../../backend/services/messageStore');
const {
  LocalPersistenceRepairService
} = require('../../backend/services/localPersistenceRepairService');
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
    attemptId: 'attempt-kf-p0-20',
    commandReference: 'queue-kf-p0-20',
    platform: 'whatsapp',
    accountReference: 'account-kf-p0-20',
    ...overrides
  };
}

function mediaObservation(source) {
  return {
    localPersistencePending: true,
    platformMessageId: 'remote-kf-p0-20',
    localPersistenceRepair: {
      kind: 'outbound-media-upsert',
      message: {
        id: 'message-kf-p0-20',
        externalMessageId: 'remote-kf-p0-20',
        accountId: 'account-kf-p0-20',
        conversationId: 'conversation-kf-p0-20',
        platform: 'whatsapp',
        direction: 'outbound'
      },
      source,
      descriptor: {
        kind: 'image',
        mimeType: 'image/png',
        renderable: true
      }
    }
  };
}

function persistAcrossProcessBoundary(observation) {
  let persisted = null;
  const receipt = persistLocalPersistenceRepair({
    enqueueLocalPersistenceRepair(input) {
      persisted = JSON.parse(JSON.stringify(input));
      return { id: input.id, state: 'pending' };
    }
  }, attempt(), observation);
  assert.equal(receipt.id, 'local-repair-attempt-kf-p0-20');
  assert.ok(persisted, 'provider-accepted local repair must cross the durable enqueue boundary');
  assert.equal(persisted.id, 'local-repair-attempt-kf-p0-20');
  assert.equal(persisted.queueId, 'queue-kf-p0-20');
  return persisted;
}

test('KF-P0-20 RED: provider-accepted file-backed WhatsApp media remains locally repairable after original source path disappears', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-kf-p0-20-'));
  const sourcePath = path.join(root, 'transient-upload.bin');
  const bytes = Buffer.from('kf-p0-20-provider-accepted-media-custody', 'utf8');
  fs.writeFileSync(sourcePath, bytes);

  const persisted = persistAcrossProcessBoundary(mediaObservation({
    filePath: sourcePath,
    expectedSha256: sha256(bytes)
  }));

  fs.rmSync(sourcePath, { force: true });
  assert.equal(fs.existsSync(sourcePath), false, 'test must model restart/transient-source loss after durable enqueue');

  let fileMaterializations = 0;
  let bufferMaterializations = 0;
  const upserts = [];
  const attachment = {
    localFile: path.join(root, 'durable-media.bin'),
    mediaUrl: '/api/r32/messages/media/account/conversation/durable-media.bin',
    fileHash: sha256(bytes),
    size: bytes.length
  };

  const restoreMedia = patch(mediaPipeline, {
    saveFile(input) {
      fileMaterializations += 1;
      const restoredBytes = fs.readFileSync(input.filePath);
      assert.deepEqual(restoredBytes, bytes, 'repair-owned file custody must retain exact source bytes');
      if (input.expectedSha256) assert.equal(sha256(restoredBytes), input.expectedSha256);
      return attachment;
    },
    saveBuffer(input) {
      bufferMaterializations += 1;
      assert.deepEqual(input.buffer, bytes, 'repair-owned byte custody must retain exact source bytes');
      return attachment;
    }
  });
  const restoreMessages = patch(messageStore, {
    async upsert(message) {
      upserts.push(message);
      return message;
    }
  });

  try {
    const service = new LocalPersistenceRepairService();
    await assert.doesNotReject(
      () => service.apply(persisted),
      'a durable provider-accepted repair must not depend on the vanished caller-owned file path'
    );
    assert.equal(fileMaterializations + bufferMaterializations, 1, 'repair must materialize exactly one locally owned media copy');
    assert.equal(upserts.length, 1, 'repair must complete the canonical local message projection');
    assert.equal(upserts[0].externalMessageId, 'remote-kf-p0-20');
  } finally {
    restoreMessages();
    restoreMedia();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

test('KF-P0-20 preserve: buffer-backed provider-accepted media already survives durable serialization without a source path', async () => {
  const bytes = Buffer.from('kf-p0-20-buffer-preserve', 'utf8');
  const persisted = persistAcrossProcessBoundary(mediaObservation({
    bufferBase64: bytes.toString('base64'),
    expectedSha256: sha256(bytes)
  }));

  let saveFileCalls = 0;
  let saveBufferCalls = 0;
  let upsertCalls = 0;
  const restoreMedia = patch(mediaPipeline, {
    saveFile() {
      saveFileCalls += 1;
      throw new Error('buffer-backed repair must not use a file path');
    },
    saveBuffer(input) {
      saveBufferCalls += 1;
      assert.deepEqual(input.buffer, bytes);
      return { localFile: '/durable/buffer.bin', mediaUrl: '/media/buffer.bin' };
    }
  });
  const restoreMessages = patch(messageStore, {
    async upsert() {
      upsertCalls += 1;
      return { ok: true };
    }
  });

  try {
    const service = new LocalPersistenceRepairService();
    await service.apply(persisted);
    assert.equal(saveFileCalls, 0);
    assert.equal(saveBufferCalls, 1);
    assert.equal(upsertCalls, 1);
  } finally {
    restoreMessages();
    restoreMedia();
  }
});

test('KF-P0-20 preserve: non-media repair payloads retain deterministic repair identity and pass-through semantics', () => {
  const cases = [
    { kind: 'message-upsert', message: { conversationId: 'conversation-a', id: 'message-a' } },
    { kind: 'reaction-apply', reaction: { conversationId: 'conversation-b', emoji: '👍' } },
    { kind: 'message-revoke', revoke: { conversationId: 'conversation-c', messageId: 'message-c' } }
  ];

  for (const payload of cases) {
    const repair = localPersistenceRepairInput(attempt(), {
      localPersistencePending: true,
      localPersistenceRepair: payload
    });
    assert.equal(repair.id, 'local-repair-attempt-kf-p0-20');
    assert.equal(repair.queueId, 'queue-kf-p0-20');
    assert.equal(repair.platform, 'whatsapp');
    assert.equal(repair.accountId, 'account-kf-p0-20');
    assert.deepEqual(repair.payload, payload);
  }
});
