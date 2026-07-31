'use strict';

const fs = require('node:fs');

const DEFAULT_REMOVE_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 50
});

function removePathWithRetries(targetPath, fsImpl = fs) {
  if (!targetPath) throw new TypeError('targetPath is required');
  fsImpl.rmSync(targetPath, { ...DEFAULT_REMOVE_OPTIONS });
}

function cleanupSqliteTestStore(store, targetPath, fsImpl = fs) {
  if (!store || typeof store.close !== 'function') throw new TypeError('store.close() is required');
  store.close();
  removePathWithRetries(targetPath, fsImpl);
}

async function cleanupResourceAndRemove(close, targetPath, fsImpl = fs) {
  if (typeof close !== 'function') throw new TypeError('close callback is required');
  await close();
  removePathWithRetries(targetPath, fsImpl);
}

module.exports = {
  DEFAULT_REMOVE_OPTIONS,
  cleanupResourceAndRemove,
  cleanupSqliteTestStore,
  removePathWithRetries
};
