'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { PersonaBrainRepository, PersonaBrainService } = require('../../backend/personaBrain');

function createHarness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-persona-brain-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'persona-brain.db') });
  const repository = new PersonaBrainRepository(store);
  const service = new PersonaBrainService(repository, options);
  return {
    root,
    store,
    repository,
    service,
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

module.exports = { createHarness };
