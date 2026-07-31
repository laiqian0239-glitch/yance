'use strict';

const { AsyncLocalStorage } = require('async_hooks');

function sqliteTransactionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

class SqliteTransactionCoordinator {
  constructor(db) {
    if (!db || typeof db.exec !== 'function') throw new TypeError('SqliteTransactionCoordinator requires a sqlite database');
    this.db = db;
    this.storage = new AsyncLocalStorage();
    this.depth = 0;
    this.sequence = 0;
    this.asyncTail = Promise.resolve();
    this.pendingAsyncRoots = 0;
  }

  _savepoint() {
    this.sequence += 1;
    return `yance_nested_${process.pid}_${this.sequence}`;
  }

  _activeContext() {
    const context = this.storage.getStore();
    return context?.coordinator === this && context.active === true ? context : null;
  }

  _busyError(operation) {
    return sqliteTransactionError(
      'SQLITE_TRANSACTION_BUSY_CONTEXT',
      'SQLite transaction is owned by another asynchronous context',
      { operation, depth: this.depth }
    );
  }

  _beginFrame({ nested, operation }) {
    if (!nested && this.depth > 0) throw this._busyError(operation);
    if (nested && this.depth <= 0) {
      throw sqliteTransactionError(
        'SQLITE_TRANSACTION_CONTEXT_STALE',
        'Nested SQLite transaction context is no longer active',
        { operation, depth: this.depth }
      );
    }

    const savepoint = nested ? this._savepoint() : '';
    if (nested) this.db.exec(`SAVEPOINT ${savepoint}`);
    else this.db.exec('BEGIN IMMEDIATE');
    this.depth += 1;
    return { nested, savepoint };
  }

  _commitFrame(frame) {
    if (frame.nested) this.db.exec(`RELEASE SAVEPOINT ${frame.savepoint}`);
    else this.db.exec('COMMIT');
  }

  _rollbackFrame(frame) {
    try {
      if (frame.nested) {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${frame.savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${frame.savepoint}`);
      } else {
        this.db.exec('ROLLBACK');
      }
    } catch (_) {}
  }

  _finishFrame(context) {
    context.active = false;
    this.depth = Math.max(0, this.depth - 1);
  }

  runSync(work) {
    if (typeof work !== 'function') throw new TypeError('SQLite transaction work must be a function');
    const parent = this._activeContext();
    const frame = this._beginFrame({ nested: Boolean(parent), operation: 'runSync' });
    const context = { coordinator: this, frame, async: false, active: true, parent };
    try {
      const result = this.storage.run(context, work);
      if (result && typeof result.then === 'function') {
        throw sqliteTransactionError('SQLITE_SYNC_TRANSACTION_RETURNED_PROMISE', 'Synchronous SQLite transaction returned a Promise');
      }
      this._commitFrame(frame);
      return result;
    } catch (error) {
      this._rollbackFrame(frame);
      throw error;
    } finally {
      this._finishFrame(context);
    }
  }

  runAsync(work) {
    if (typeof work !== 'function') return Promise.reject(new TypeError('SQLite transaction work must be a function'));
    const current = this._activeContext();
    if (current?.async === false) {
      throw sqliteTransactionError(
        'SQLITE_ASYNC_NESTED_IN_SYNC_TRANSACTION',
        'Asynchronous SQLite work cannot be started inside a synchronous transaction'
      );
    }
    if (current) return this._queueNestedAsync(work, current);

    this.pendingAsyncRoots += 1;
    const execute = async () => {
      let frame = null;
      let context = null;
      try {
        frame = this._beginFrame({ nested: false, operation: 'runAsync' });
        context = { coordinator: this, frame, async: true, active: true, parent: null, nestedTail: Promise.resolve(), firstNestedError: null };
        const result = await this.storage.run(context, work);
        await context.nestedTail;
        if (context.firstNestedError) throw context.firstNestedError;
        this._commitFrame(frame);
        return result;
      } catch (error) {
        if (frame) this._rollbackFrame(frame);
        throw error;
      } finally {
        if (context) this._finishFrame(context);
        this.pendingAsyncRoots = Math.max(0, this.pendingAsyncRoots - 1);
      }
    };

    const queued = this.asyncTail.then(execute, execute);
    this.asyncTail = queued.catch(() => undefined);
    return queued;
  }

  _queueNestedAsync(work, parent) {
    const execute = () => this._runNestedAsync(work, parent);
    const queued = parent.nestedTail.then(execute, execute);
    // Keep a fulfilled drain tail so later nested work remains serialized, but
    // retain the first failure as authoritative state for the root transaction.
    // This prevents fire-and-forget nested work from committing a partial root.
    parent.nestedTail = queued.then(
      () => undefined,
      error => {
        if (!parent.firstNestedError) parent.firstNestedError = error;
        return undefined;
      }
    );
    // The returned Promise still rejects for callers that do await it. Attach a
    // passive handler only to prevent process-level unhandled rejection noise.
    queued.catch(() => undefined);
    return queued;
  }

  async _runNestedAsync(work, parent) {
    const frame = this._beginFrame({ nested: true, operation: 'runAsync:nested' });
    const context = { coordinator: this, frame, async: true, active: true, parent, nestedTail: Promise.resolve(), firstNestedError: null };
    try {
      const result = await this.storage.run(context, work);
      await context.nestedTail;
      if (context.firstNestedError) throw context.firstNestedError;
      this._commitFrame(frame);
      return result;
    } catch (error) {
      this._rollbackFrame(frame);
      throw error;
    } finally {
      this._finishFrame(context);
    }
  }

  snapshot() {
    return {
      depth: this.depth,
      queued: this.pendingAsyncRoots > 0,
      pendingAsyncRoots: this.pendingAsyncRoots,
      sequence: this.sequence
    };
  }
}

module.exports = { SqliteTransactionCoordinator, sqliteTransactionError };
