'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');

const DEFAULTS = Object.freeze({
  newMediaEngine: true,
  newAiGateway: true,
  realModelQualification: true,
  desktopNotifications: true,
  trayMenu: true,
  whatsappBaileysV2: true,
  voiceTranscription: false,
  cloudModels: false
});

const store = new SqliteDocumentStore('feature-flags', {
  schemaVersion: 1,
  global: { ...DEFAULTS },
  accounts: {},
  updatedAt: ''
});

function resolve(name, accountId = '') {
  const state = store.read();
  if (accountId && state.accounts?.[accountId] && name in state.accounts[accountId]) return Boolean(state.accounts[accountId][name]);
  return Boolean(state.global?.[name]);
}

async function setFlag(name, value, accountId = '') {
  if (!(name in DEFAULTS)) throw new Error(`UNKNOWN_FEATURE_FLAG:${name}`);
  return store.update(state => {
    if (accountId) {
      state.accounts[accountId] = { ...(state.accounts[accountId] || {}), [name]: Boolean(value) };
    } else {
      state.global[name] = Boolean(value);
    }
    state.updatedAt = new Date().toISOString();
    return state;
  });
}

module.exports = { DEFAULTS, read: () => store.read(), resolve, setFlag };
