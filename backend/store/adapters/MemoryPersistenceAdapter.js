'use strict';

class MemoryPersistenceAdapter {
  constructor(snapshot = {}) {
    this.snapshot = snapshot;
    this.events = [];
  }

  async loadSnapshot() {
    return this.snapshot;
  }

  async transaction(work, metadata = {}) {
    const events = this.events;
    const transaction = {
      metadata,
      appendStoreEvents(rows) {
        events.push(...rows);
      }
    };
    return work(transaction);
  }
}

module.exports = { MemoryPersistenceAdapter };
