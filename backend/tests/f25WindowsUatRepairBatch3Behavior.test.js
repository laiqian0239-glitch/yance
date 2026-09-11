'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-f25-batch3-behavior-'));
process.env.YANCE_DATA_DIR = dataRoot;

const sendQueueModule = require('../services/sendQueueService');
const queueRepository = require('../repositories/sendQueueRepository');
const { closeStore } = require('../repositories/storeProvider');

const { SendQueueService } = sendQueueModule;

test.after(() => {
  closeStore();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('F25-D35 unresolved platform acceptance blocks new outbound writes with a stable 423 receipt', () => {
  const service = new SendQueueService();
  const originalList = queueRepository.list;
  queueRepository.list = () => [
    { id: 'unknown-1', state: 'send_outcome_unknown' },
    { id: 'unknown-2', state: 'send_outcome_unknown' }
  ];

  try {
    assert.throws(
      () => service.assertEnqueueAllowed('text'),
      error => {
        assert.equal(error.code, 'SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED');
        assert.equal(error.status, 423);
        assert.equal(error.reasonCode, 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN');
        assert.equal(error.outcomeUnknown, 2);
        assert.match(error.message, /not accepting new commands/u);
        return true;
      }
    );
  } finally { queueRepository.list = originalList; }
});

test('F25-D35 a queue-state read failure fails closed instead of allowing a new outbound write', () => {
  const service = new SendQueueService();
  const originalList = queueRepository.list;
  queueRepository.list = () => {
    const error = new Error('SQLite busy');
    error.code = 'SQLITE_BUSY';
    throw error;
  };

  try {
    const failedStatus = service.status();
    assert.equal(failedStatus.statusError.code, 'SQLITE_BUSY');
    assert.equal(failedStatus.writeBlocked, true);
    assert.throws(
      () => service.assertEnqueueAllowed('media'),
      error => {
        assert.equal(error.code, 'SEND_QUEUE_STATUS_UNAVAILABLE_WRITE_BLOCKED');
        assert.equal(error.status, 423);
        return true;
      }
    );
  } finally { queueRepository.list = originalList; }
});

test('F25-D35 a healthy queue leaves enqueue operations available', () => {
  const service = new SendQueueService();
  const originalList = queueRepository.list;
  queueRepository.list = () => [];
  try {
    assert.equal(service.assertEnqueueAllowed('text'), true);
    assert.equal(service.pausedReason, '');
  } finally { queueRepository.list = originalList; }
});
