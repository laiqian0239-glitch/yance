'use strict';
const { defaultAppearanceState } = require('./themeAppearancePolicy');

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { DEFAULT_TYPING_POLICY } = require('./typing/typingPolicy');

class StoreManagerError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'StoreManagerError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(cloneValue(value));
}

function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function createInitialState(seed = {}) {
  const now = new Date().toISOString();
  return {
    meta: {
      hydrated: false,
      stateVersion: 0,
      domainVersions: {},
      lastCommandId: '',
      lastTransactionId: '',
      hydratedAt: '',
      updatedAt: now,
      ...(seed.meta || {})
    },
    auth: { ready: false, accountsById: {}, ...(seed.auth || {}) },
    ui: {
      ready: false,
      readingMode: 'comfortable',
      density: 'comfortable',
      contrastMode: 'high',
      ...defaultAppearanceState(),
      ...(seed.ui || {})
    },
    customers: { ready: false, byId: {}, activeIds: [], archivedIds: [], currentId: '', ...(seed.customers || {}) },
    conversations: { ready: false, byId: {}, byContactId: {}, recentMessagesById: {}, ...(seed.conversations || {}) },
    typingState: {
      ready: true,
      byContactId: {},
      policy: DEFAULT_TYPING_POLICY,
      ...(seed.typingState || {})
    },
    relationships: { ready: false, byContactId: {}, ...(seed.relationships || {}) },
    memories: { ready: false, byContactId: {}, ...(seed.memories || {}) },
    interactionPolicies: { ready: false, byContactId: {}, ...(seed.interactionPolicies || {}) },
    models: { ready: false, byId: {}, routes: {}, ...(seed.models || {}) },
    routing: { ready: false, byTask: {}, circuitBreakers: {}, ...(seed.routing || {}) },
    aiBrain: { ready: false, tasksById: {}, candidatesById: {}, ...(seed.aiBrain || {}) },
    outbox: { ready: false, byId: {}, ...(seed.outbox || {}) },
    system: { ready: false, health: {}, ...(seed.system || {}) }
  };
}

function normalizeCommand(input, idFactory, now) {
  if (!isPlainObject(input)) throw new StoreManagerError('INVALID_COMMAND', 'Store command must be an object');
  const type = clean(input.type);
  if (!type) throw new StoreManagerError('INVALID_COMMAND_TYPE', 'Store command type is required');
  return deepFreeze({
    id: clean(input.id) || idFactory(),
    type,
    payload: cloneValue(input.payload || {}),
    source: clean(input.source) || 'unknown',
    correlationId: clean(input.correlationId) || clean(input.id) || idFactory(),
    expectedStateVersion: input.expectedStateVersion == null ? null : Number(input.expectedStateVersion),
    issuedAt: clean(input.issuedAt) || now(),
    metadata: cloneValue(input.metadata || {})
  });
}

function normalizeEvents(events, fallbackType) {
  const rows = Array.isArray(events) ? events : events ? [events] : [];
  if (!rows.length && fallbackType) rows.push({ type: fallbackType, payload: {} });
  return rows.map(event => ({
    type: clean(event.type),
    domain: clean(event.domain),
    entityId: clean(event.entityId),
    payload: cloneValue(event.payload || {}),
    changedPaths: Array.isArray(event.changedPaths) ? [...new Set(event.changedPaths.map(clean).filter(Boolean))] : [],
    priority: ['critical', 'high', 'normal', 'low'].includes(clean(event.priority).toLowerCase()) ? clean(event.priority).toLowerCase() : 'normal'
  })).filter(event => event.type);
}

class StoreManager {
  constructor(options = {}) {
    this._persistence = options.persistence || null;
    this._logger = options.logger || console;
    this._clock = options.clock || (() => new Date().toISOString());
    this._idFactory = options.idFactory || randomUUID;
    this._validateState = typeof options.validateState === 'function' ? options.validateState : null;
    this._commands = new Map();
    this._subscribers = new Map();
    this._events = new EventEmitter();
    this._writeTail = Promise.resolve();
    this._state = immutable(createInitialState(options.initialState || {}));
  }

  get stateVersion() {
    return Number(this._state.meta.stateVersion || 0);
  }

  get hydrated() {
    return this._state.meta.hydrated === true;
  }

  registerCommand(type, handler, options = {}) {
    const commandType = clean(type);
    if (!commandType || typeof handler !== 'function') {
      throw new StoreManagerError('INVALID_COMMAND_HANDLER', 'Command type and handler are required');
    }
    if (this._commands.has(commandType) && options.replace !== true) {
      throw new StoreManagerError('COMMAND_ALREADY_REGISTERED', `Command already registered: ${commandType}`);
    }
    this._commands.set(commandType, {
      handler,
      allowBeforeHydration: options.allowBeforeHydration === true
    });
    return () => this._commands.delete(commandType);
  }

  async hydrate(options = {}) {
    return this._enqueueWrite(async () => {
      if (this.hydrated && options.force !== true) return this.snapshot();
      const loaded = this._persistence?.loadSnapshot
        ? await this._persistence.loadSnapshot()
        : {};
      const base = createInitialState(loaded || {});
      base.meta = {
        ...base.meta,
        hydrated: true,
        stateVersion: Math.max(1, Number(base.meta.stateVersion || 0)),
        hydratedAt: this._clock(),
        updatedAt: this._clock()
      };
      this._assertState(base);
      const previous = this._state;
      this._state = immutable(base);
      const event = this._createEvent({
        type: 'store.hydrated',
        domain: 'system',
        payload: { domains: Object.keys(base).filter(key => key !== 'meta') },
        changedPaths: ['meta.hydrated']
      }, {
        id: this._idFactory(),
        correlationId: this._idFactory(),
        source: 'store-manager',
        type: 'STORE_HYDRATE'
      }, previous.meta.stateVersion, this.stateVersion);
      this._publish(event, previous);
      return this.snapshot();
    });
  }

  dispatch(commandInput, options = {}) {
    const command = normalizeCommand(commandInput, this._idFactory, this._clock);
    return this._enqueueWrite(() => this._dispatch(command, options.executionContext || null));
  }

  select(selector, ...args) {
    if (typeof selector !== 'function') {
      throw new StoreManagerError('INVALID_SELECTOR', 'Selector must be a function');
    }
    return deepFreeze(selector(this._state, ...args));
  }

  snapshot(options = {}) {
    const domains = Array.isArray(options.domains) ? new Set(options.domains) : null;
    const raw = domains
      ? Object.fromEntries(Object.entries(this._state).filter(([key]) => key === 'meta' || domains.has(key)))
      : this._state;
    const redacted = typeof options.redact === 'function' ? options.redact(raw) : raw;
    return immutable(redacted);
  }

  subscribe(selector, listener, options = {}) {
    if (typeof selector !== 'function' || typeof listener !== 'function') {
      throw new StoreManagerError('INVALID_SUBSCRIPTION', 'Selector and listener are required');
    }
    const id = this._idFactory();
    const equality = typeof options.equality === 'function' ? options.equality : shallowEqual;
    const current = this.select(selector);
    this._subscribers.set(id, { selector, listener, equality, current });
    if (options.fireImmediately !== false) {
      queueMicrotask(() => {
        if (!this._subscribers.has(id)) return;
        this._safeNotify(listener, current, undefined, {
          type: 'store.subscription.initial',
          stateVersion: this.stateVersion
        });
      });
    }
    return () => this._subscribers.delete(id);
  }

  onEvent(listener) {
    this._events.on('event', listener);
    return () => this._events.off('event', listener);
  }

  waitForIdle() {
    return this._writeTail;
  }

  _enqueueWrite(operation) {
    const result = this._writeTail.then(operation, operation);
    this._writeTail = result.catch(() => undefined);
    return result;
  }

  async _dispatch(command, executionContext = null) {
    executionContext?.assertCurrent?.();
    const registration = this._commands.get(command.type);
    if (!registration) throw new StoreManagerError('UNKNOWN_COMMAND', `Unknown store command: ${command.type}`);
    if (!this.hydrated && !registration.allowBeforeHydration) {
      throw new StoreManagerError('STORE_NOT_READY', 'StoreManager has not completed hydration');
    }
    const previous = this._state;
    if (command.expectedStateVersion != null && command.expectedStateVersion !== this.stateVersion) {
      throw new StoreManagerError('STORE_VERSION_CONFLICT', 'Store state changed before command commit', {
        expected: command.expectedStateVersion,
        actual: this.stateVersion,
        commandId: command.id
      });
    }

    const context = Object.freeze({
      command,
      state: previous,
      now: this._clock,
      createId: this._idFactory,
      select: (selector, ...args) => deepFreeze(selector(previous, ...args)),
      cloneState: () => cloneValue(previous),
      fail: (code, message, details) => { throw new StoreManagerError(code, message, details); }
    });

    const plan = await registration.handler(context);
    executionContext?.assertCurrent?.();
    if (!plan || plan.noop === true) {
      return {
        ok: true,
        noop: true,
        stateVersion: this.stateVersion,
        result: plan?.result
      };
    }

    let candidate;
    if (typeof plan.mutate === 'function') {
      candidate = cloneValue(previous);
      await plan.mutate(candidate);
    } else if (plan.nextState) {
      candidate = cloneValue(plan.nextState);
    } else {
      throw new StoreManagerError('INVALID_COMMAND_PLAN', `Command ${command.type} returned no state transition`);
    }

    const changedDomains = [...new Set((plan.changedDomains || []).map(clean).filter(Boolean))];
    const nextVersion = this.stateVersion + 1;
    const transactionId = clean(plan.transactionId) || command.id;
    candidate.meta = {
      ...(candidate.meta || {}),
      hydrated: true,
      stateVersion: nextVersion,
      domainVersions: { ...(candidate.meta?.domainVersions || {}) },
      lastCommandId: command.id,
      lastTransactionId: transactionId,
      updatedAt: this._clock()
    };
    for (const domain of changedDomains) {
      candidate.meta.domainVersions[domain] = Number(candidate.meta.domainVersions[domain] || 0) + 1;
    }
    this._assertState(candidate);
    const frozenCandidate = immutable(candidate);
    const events = normalizeEvents(plan.events, `${command.type.toLowerCase()}.committed`)
      .map(event => this._createEvent(event, command, this.stateVersion, nextVersion));

    const ephemeral = plan.ephemeral === true;
    const persist = async transaction => {
      if (typeof plan.persist === 'function') {
        executionContext?.assertCurrent?.();
        await plan.persist(transaction, {
          command,
          previousState: previous,
          nextState: frozenCandidate,
          stateVersion: nextVersion,
          transactionId,
          events
        });
      }
      executionContext?.assertCurrent?.();
      if (typeof transaction?.appendStoreEvents === 'function') {
        await transaction.appendStoreEvents(events);
      }
      if (typeof transaction?.persistStoreMeta === 'function') {
        await transaction.persistStoreMeta({
          stateVersion: nextVersion,
          domainVersions: frozenCandidate.meta.domainVersions,
          transactionId
        });
      }
      executionContext?.assertCurrent?.();
    };

    // Typing/presence is authoritative in memory but intentionally ephemeral.
    // It must not create SQLite write amplification or survive a restart.
    if (!ephemeral) {
      if (this._persistence?.transaction) await this._persistence.transaction(persist, { transactionId, command });
      else await persist(null);
    }

    executionContext?.assertCurrent?.();
    this._state = frozenCandidate;
    for (const event of events) this._publish(event, previous);

    return {
      ok: true,
      commandId: command.id,
      transactionId,
      stateVersion: nextVersion,
      events,
      ephemeral,
      result: plan.result
    };
  }

  _createEvent(event, command, previousVersion, stateVersion) {
    return deepFreeze({
      eventId: this._idFactory(),
      eventType: event.type,
      domain: event.domain || '',
      entityId: event.entityId || '',
      previousVersion: Number(previousVersion || 0),
      stateVersion: Number(stateVersion || 0),
      occurredAt: this._clock(),
      source: command.source || 'unknown',
      commandType: command.type || '',
      commandId: command.id || '',
      correlationId: command.correlationId || command.id || '',
      payload: event.payload || {},
      changedPaths: event.changedPaths || [],
      priority: event.priority || 'normal'
    });
  }

  _publish(event, previousState) {
    this._events.emit('event', event);
    this._events.emit(event.eventType, event);
    for (const [id, subscription] of this._subscribers.entries()) {
      let nextValue;
      try {
        nextValue = this.select(subscription.selector);
      } catch (error) {
        this._logger?.warn?.('store', 'selector-failed', { subscriptionId: id, error: error.message });
        continue;
      }
      if (subscription.equality(subscription.current, nextValue)) continue;
      const oldValue = subscription.current;
      subscription.current = nextValue;
      this._safeNotify(subscription.listener, nextValue, oldValue, event, previousState);
    }
  }

  _safeNotify(listener, nextValue, previousValue, event) {
    try {
      listener(nextValue, previousValue, event);
    } catch (error) {
      this._logger?.warn?.('store', 'subscriber-failed', { eventType: event?.eventType || event?.type || '', error: error.message });
    }
  }

  _assertState(state) {
    if (!isPlainObject(state) || !isPlainObject(state.meta)) {
      throw new StoreManagerError('INVALID_STORE_STATE', 'Store state must contain a meta object');
    }
    if (this._validateState) this._validateState(state);
  }
}

module.exports = {
  StoreManager,
  StoreManagerError,
  createInitialState,
  deepFreeze,
  immutable,
  shallowEqual
};
