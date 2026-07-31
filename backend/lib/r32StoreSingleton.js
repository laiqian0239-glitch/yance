'use strict';

const { PATHS, ensureDirectories } = require('../config');
const { R32SqliteStore } = require('./r32SqliteStore');

let instance = null;

function getR32Store() {
  const broker = require('./sqliteConnectionBroker').getSqliteConnectionBroker({ optional: true });
  if (broker) return broker.getStore();
  if (!instance) {
    ensureDirectories();
    instance = new R32SqliteStore({ dbPath: PATHS.sqlite });
  }
  return instance;
}

function closeR32Store() {
  const broker = require('./sqliteConnectionBroker').getSqliteConnectionBroker({ optional: true });
  if (broker) { broker.checkpointAndClose(); return; }
  if (!instance) return;
  try { instance.close(); } finally { instance = null; }
}


module.exports = { getR32Store, closeR32Store };
