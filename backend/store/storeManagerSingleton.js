'use strict';

const { StoreManager } = require('./StoreManager');

let instance = null;

function configureStoreManager(options = {}) {
  if (instance && options.replace !== true) return instance;
  instance = new StoreManager(options);
  return instance;
}

function getStoreManager() {
  if (!instance) {
    throw Object.assign(new Error('StoreManager has not been configured'), { code: 'STORE_MANAGER_NOT_CONFIGURED' });
  }
  return instance;
}

function resetStoreManagerForTests() {
  instance = null;
}

module.exports = {
  configureStoreManager,
  getStoreManager,
  resetStoreManagerForTests
};
