'use strict';

const OPERATION_KINDS = Object.freeze({
  AI_PROVIDER_EXECUTION: 'AI_PROVIDER_EXECUTION',
  OUTBOUND_MESSAGE_SEND: 'OUTBOUND_MESSAGE_SEND',
  DELIVERY_RECEIPT_RECONCILIATION: 'DELIVERY_RECEIPT_RECONCILIATION',
  MEDIA_TRANSFER: 'MEDIA_TRANSFER',
  HISTORY_SYNCHRONIZATION: 'HISTORY_SYNCHRONIZATION',
  SESSION_RESTORE: 'SESSION_RESTORE'
});

const OPERATION_KIND_ORDER = Object.freeze(Object.values(OPERATION_KINDS));
const OPERATION_KIND_SET = new Set(OPERATION_KIND_ORDER);
const FORBIDDEN_PERSISTED_FIELDS = Object.freeze([
  'apiKey',
  'oauthToken',
  'accessToken',
  'refreshToken',
  'cookie',
  'sessionMaterial',
  'messageBody',
  'promptBody',
  'binaryPayload'
]);
const FORBIDDEN_PERSISTED_FIELD_SET = new Set(
  FORBIDDEN_PERSISTED_FIELDS.map(field => field.toLowerCase())
);

function operationRegistryError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredOperationKind(value) {
  const operationKind = String(value == null ? '' : value).trim();
  if (!OPERATION_KIND_SET.has(operationKind)) {
    throw operationRegistryError(
      'WP_B_OPERATION_KIND_INVALID',
      'Durable operation kind is not registered',
      { operationKind }
    );
  }
  return operationKind;
}

function assertRecursivelyFrozen(value, fieldPath, visited) {
  if (value == null || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);
  if (!Object.isFrozen(value)) {
    throw operationRegistryError(
      'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN',
      'Reference-only envelope must be recursively frozen',
      { fieldPath }
    );
  }
  for (const [field, child] of Object.entries(value)) {
    if (FORBIDDEN_PERSISTED_FIELD_SET.has(field.toLowerCase())) {
      throw operationRegistryError(
        'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD',
        'Reference-only envelope contains forbidden secret or business content',
        { field, fieldPath: fieldPath ? `${fieldPath}.${field}` : field }
      );
    }
    assertRecursivelyFrozen(child, fieldPath ? `${fieldPath}.${field}` : field, visited);
  }
}

function assertReferenceOnlyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw operationRegistryError(
      'WP_B_REFERENCE_ONLY_ENVELOPE_INVALID',
      'Reference-only envelope must be one object'
    );
  }
  assertRecursivelyFrozen(envelope, '', new WeakSet());
  return envelope;
}

function validateAdapter(operationKind, adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)
      || !Object.isFrozen(adapter)
      || adapter.operationKind !== operationKind
      || typeof adapter.perform !== 'function'
      || typeof adapter.reconcile !== 'function') {
    throw operationRegistryError(
      'WP_B_OPERATION_ADAPTER_INVALID',
      'Durable operation Adapter must be frozen and expose exact perform/reconcile capabilities',
      { operationKind }
    );
  }
  return adapter;
}

function createDurableOperationRegistry() {
  const adapters = Object.create(null);
  let sealed = false;
  const registry = Object.create(null);

  Object.defineProperties(registry, {
    register: {
      enumerable: false,
      value(operationKindInput, adapterInput) {
        if (sealed) {
          throw operationRegistryError(
            'WP_B_OPERATION_REGISTRY_SEALED',
            'Durable operation registry is sealed'
          );
        }
        const operationKind = requiredOperationKind(operationKindInput);
        const adapter = validateAdapter(operationKind, adapterInput);
        if (Object.hasOwn(adapters, operationKind)) {
          throw operationRegistryError(
            'WP_B_OPERATION_ADAPTER_DUPLICATE',
            'Durable operation Adapter is already registered',
            { operationKind }
          );
        }
        Object.defineProperty(adapters, operationKind, {
          configurable: false,
          enumerable: true,
          writable: false,
          value: adapter
        });
        return adapter;
      }
    },
    require: {
      enumerable: false,
      value(operationKindInput) {
        const operationKind = requiredOperationKind(operationKindInput);
        if (!Object.hasOwn(adapters, operationKind)) {
          throw operationRegistryError(
            'WP_B_OPERATION_ADAPTER_NOT_REGISTERED',
            'Durable operation Adapter is not registered',
            { operationKind }
          );
        }
        return adapters[operationKind];
      }
    },
    list: {
      enumerable: false,
      value() {
        return Object.freeze(
          OPERATION_KIND_ORDER.filter(operationKind => Object.hasOwn(adapters, operationKind))
        );
      }
    },
    seal: {
      enumerable: false,
      value() {
        sealed = true;
        Object.freeze(adapters);
        return registry;
      }
    },
    sealed: {
      enumerable: false,
      get() { return sealed; }
    }
  });

  return registry;
}

module.exports = Object.freeze({
  FORBIDDEN_PERSISTED_FIELDS,
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope,
  createDurableOperationRegistry,
  operationRegistryError
});
