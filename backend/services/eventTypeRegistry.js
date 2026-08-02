'use strict';

const { canonicalSerialize } = require('./canonicalSerialization');

const REQUIRED_DESCRIPTOR_FIELDS = Object.freeze([
  'eventType',
  'schemaVersion',
  'aggregateType',
  'payloadSchema',
  'classificationSchema',
  'canonicalizationVersion',
  'projectionCompatibility',
  'retentionClass'
]);

const NONDETERMINISTIC_UPCASTER_PATTERNS = Object.freeze([
  { pattern: /\bDate\s*\.\s*now\s*\(/, primitive: 'Date.now' },
  { pattern: /\bnew\s+Date\s*\(/, primitive: 'new Date' },
  { pattern: /\bMath\s*\.\s*random\s*\(/, primitive: 'Math.random' },
  { pattern: /\bprocess\s*\.\s*env\b/, primitive: 'process.env' },
  { pattern: /\brequire\s*\(\s*['"](?:node:)?fs(?:\/[^'"]*)?['"]\s*\)/, primitive: 'filesystem' },
  { pattern: /\b(?:readFile|readFileSync|writeFile|writeFileSync|readdir|statSync)\s*\(/, primitive: 'filesystem' },
  { pattern: /\bfetch\s*\(/, primitive: 'fetch' },
  { pattern: /\b(?:http|https|net|tls)\s*\./, primitive: 'network' },
  { pattern: /\brandomUUID\s*\(/, primitive: 'randomUUID' },
  { pattern: /\brandomBytes\s*\(/, primitive: 'randomBytes' },
  { pattern: /\bperformance\s*\.\s*now\s*\(/, primitive: 'performance.now' }
]);

function registryError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlain(value, path = '$', seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') {
    throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values must be plain data', { fieldPath: path });
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) {
    throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values cannot contain runtime objects or inline binary data', { fieldPath: path });
  }
  if (seen.has(value)) throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values cannot contain cycles', { fieldPath: path });
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => clonePlain(item, `${path}[${index}]`, seen));
    if (!isPlainObject(value)) throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values must use plain objects', { fieldPath: path });
    const result = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).sort((left, right) => left.localeCompare(right))) {
      const descriptor = descriptors[key];
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values cannot contain accessors', { fieldPath: `${path}.${key}` });
      }
      result[key] = clonePlain(descriptor.value, `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function functionSource(transform) {
  if (typeof transform !== 'function') {
    throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Every upcaster requires a transform function');
  }
  return Function.prototype.toString.call(transform).replace(/\r\n/g, '\n').trim();
}

function assertDeterministicSource(source, eventType, fromVersion, toVersion) {
  for (const { pattern, primitive } of NONDETERMINISTIC_UPCASTER_PATTERNS) {
    if (pattern.test(source)) {
      throw registryError('EVENT_UPCASTER_NONDETERMINISTIC', `Upcaster ${fromVersion}->${toVersion} uses forbidden primitive ${primitive}`, {
        eventType,
        fromVersion,
        toVersion,
        primitive
      });
    }
  }
}

function normalizeUpcasters(value, schemaVersion, eventType) {
  const input = value == null ? [] : value;
  if (!Array.isArray(input)) {
    throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'upcasters must be an array', { eventType });
  }
  const normalized = input.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Each upcaster must be a plain object', { eventType, index });
    }
    const fromVersion = Number(entry.fromVersion);
    const toVersion = Number(entry.toVersion);
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || !Number.isInteger(toVersion) || toVersion !== fromVersion + 1) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcasters must advance exactly one positive schema version', {
        eventType,
        index,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion
      });
    }
    const transformSource = functionSource(entry.transform);
    assertDeterministicSource(transformSource, eventType, fromVersion, toVersion);
    return { fromVersion, toVersion, transform: entry.transform, transformSource };
  }).sort((left, right) => left.fromVersion - right.fromVersion);

  if (schemaVersion === 1 && normalized.length !== 0) {
    throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Schema version 1 cannot declare historical upcasters', { eventType });
  }
  if (schemaVersion > 1) {
    if (normalized.length === 0 || normalized[normalized.length - 1].toVersion !== schemaVersion) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcaster chain must terminate at the current schema version', { eventType, schemaVersion });
    }
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (index > 0 && current.fromVersion !== normalized[index - 1].toVersion) {
        throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcaster chain must be contiguous and unique', {
          eventType,
          previousToVersion: normalized[index - 1].toVersion,
          fromVersion: current.fromVersion
        });
      }
    }
  }

  const keys = new Set();
  for (const item of normalized) {
    const key = `${item.fromVersion}->${item.toVersion}`;
    if (keys.has(key)) throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Duplicate upcaster transition is forbidden', { eventType, transition: key });
    keys.add(key);
  }
  return normalized;
}

function descriptorFingerprint(descriptor) {
  return canonicalSerialize({
    eventType: descriptor.eventType,
    schemaVersion: descriptor.schemaVersion,
    aggregateType: descriptor.aggregateType,
    payloadSchema: descriptor.payloadSchema,
    classificationSchema: descriptor.classificationSchema,
    canonicalizationVersion: descriptor.canonicalizationVersion,
    projectionCompatibility: descriptor.projectionCompatibility,
    retentionClass: descriptor.retentionClass,
    upcasters: descriptor.upcasters.map(item => ({
      fromVersion: item.fromVersion,
      toVersion: item.toVersion,
      transformSource: item.transformSource
    }))
  });
}

function assertRequiredDescriptorFields(input) {
  for (const field of REQUIRED_DESCRIPTOR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field) || input[field] === undefined || input[field] === null || input[field] === '') {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INCOMPLETE', `Event descriptor is missing ${field}`, { field });
    }
  }
}

class EventTypeRegistry {
  constructor(options = {}) {
    const canonicalizationVersion = Number(options.canonicalizationVersion);
    if (!Number.isInteger(canonicalizationVersion) || canonicalizationVersion < 1) {
      throw registryError('EVENT_CANONICALIZATION_VERSION_INVALID', 'Registry canonicalizationVersion must be a positive integer');
    }
    this.canonicalizationVersion = canonicalizationVersion;
    this.events = new Map();
  }

  register(input = {}) {
    if (!isPlainObject(input)) throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'Event descriptor must be a plain object');
    assertRequiredDescriptorFields(input);

    const eventType = String(input.eventType).trim();
    const aggregateType = String(input.aggregateType).trim();
    const schemaVersion = Number(input.schemaVersion);
    const canonicalizationVersion = Number(input.canonicalizationVersion);
    const retentionClass = String(input.retentionClass).trim();
    if (!eventType || !aggregateType || !retentionClass || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'Event descriptor identifiers and schemaVersion are invalid', { eventType });
    }
    if (canonicalizationVersion !== this.canonicalizationVersion) {
      throw registryError('EVENT_CANONICALIZATION_VERSION_MISMATCH', 'Event descriptor canonicalization version does not match the registry', {
        eventType,
        expected: this.canonicalizationVersion,
        actual: canonicalizationVersion
      });
    }
    if (!isPlainObject(input.payloadSchema) || !isPlainObject(input.classificationSchema)) {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'payloadSchema and classificationSchema must be plain objects', { eventType });
    }
    if (!Array.isArray(input.projectionCompatibility)) {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'projectionCompatibility must be an array', { eventType });
    }

    const upcasters = normalizeUpcasters(input.upcasters, schemaVersion, eventType);
    const normalized = {
      eventType,
      schemaVersion,
      aggregateType,
      payloadSchema: deepFreeze(clonePlain(input.payloadSchema, '$.payloadSchema')),
      classificationSchema: deepFreeze(clonePlain(input.classificationSchema, '$.classificationSchema')),
      canonicalizationVersion,
      projectionCompatibility: Object.freeze(input.projectionCompatibility.map(value => String(value).trim())),
      retentionClass,
      upcasters
    };
    const fingerprint = descriptorFingerprint(normalized);
    const existing = this.events.get(eventType);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw registryError('EVENT_TYPE_DESCRIPTOR_CONFLICT', `Conflicting descriptor for ${eventType}`, { eventType });
      }
      return existing.publicDescriptor;
    }

    const publicDescriptor = Object.freeze({
      eventType,
      schemaVersion,
      aggregateType,
      payloadSchema: normalized.payloadSchema,
      classificationSchema: normalized.classificationSchema,
      canonicalizationVersion,
      projectionCompatibility: normalized.projectionCompatibility,
      retentionClass,
      upcasters: Object.freeze(upcasters.map(item => Object.freeze({
        fromVersion: item.fromVersion,
        toVersion: item.toVersion,
        transform: item.transform
      })))
    });
    this.events.set(eventType, {
      fingerprint,
      publicDescriptor,
      upcastersByFromVersion: new Map(upcasters.map(item => [item.fromVersion, item]))
    });
    return publicDescriptor;
  }

  get(eventTypeInput) {
    const eventType = String(eventTypeInput || '').trim();
    return this.events.get(eventType)?.publicDescriptor || null;
  }

  upcast(input = {}) {
    const eventType = String(input.eventType || '').trim();
    const registered = this.events.get(eventType);
    if (!registered) throw registryError('EVENT_TYPE_UNREGISTERED', `Event type ${eventType} is not registered`, { eventType });

    const sourceVersion = Number(input.schemaVersion);
    const currentVersion = registered.publicDescriptor.schemaVersion;
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > currentVersion) {
      throw registryError('EVENT_SCHEMA_VERSION_UNSUPPORTED', `Schema version ${input.schemaVersion} is unsupported for ${eventType}`, {
        eventType,
        schemaVersion: input.schemaVersion,
        currentVersion
      });
    }

    let payload = clonePlain(input.payload, '$.payload');
    const upcastPath = [];
    for (let version = sourceVersion; version < currentVersion; version += 1) {
      const upcaster = registered.upcastersByFromVersion.get(version);
      if (!upcaster || upcaster.toVersion !== version + 1) {
        throw registryError('EVENT_SCHEMA_VERSION_UNSUPPORTED', `No deterministic upcaster exists for ${eventType} schema ${version}`, {
          eventType,
          schemaVersion: version,
          currentVersion
        });
      }

      const firstInput = clonePlain(payload, '$.payload');
      const firstBefore = canonicalSerialize(firstInput);
      const firstOutput = upcaster.transform(firstInput);
      if (firstOutput && typeof firstOutput.then === 'function') {
        throw registryError('EVENT_UPCASTER_ASYNC_FORBIDDEN', 'Event upcasters must be synchronous pure functions', {
          eventType,
          fromVersion: version,
          toVersion: version + 1
        });
      }
      if (canonicalSerialize(firstInput) !== firstBefore) {
        throw registryError('EVENT_UPCASTER_MUTATED_INPUT', 'Event upcaster mutated its input payload', {
          eventType,
          fromVersion: version,
          toVersion: version + 1
        });
      }
      const normalizedFirstOutput = clonePlain(firstOutput, '$.upcastOutput');

      const secondInput = clonePlain(payload, '$.payload');
      const secondBefore = canonicalSerialize(secondInput);
      const secondOutput = upcaster.transform(secondInput);
      if (secondOutput && typeof secondOutput.then === 'function') {
        throw registryError('EVENT_UPCASTER_ASYNC_FORBIDDEN', 'Event upcasters must be synchronous pure functions', {
          eventType,
          fromVersion: version,
          toVersion: version + 1
        });
      }
      if (canonicalSerialize(secondInput) !== secondBefore) {
        throw registryError('EVENT_UPCASTER_MUTATED_INPUT', 'Event upcaster mutated its input payload', {
          eventType,
          fromVersion: version,
          toVersion: version + 1
        });
      }
      const normalizedSecondOutput = clonePlain(secondOutput, '$.upcastOutput');
      if (canonicalSerialize(normalizedFirstOutput) !== canonicalSerialize(normalizedSecondOutput)) {
        throw registryError('EVENT_UPCASTER_NONDETERMINISTIC', 'Event upcaster returned different outputs for the same input', {
          eventType,
          fromVersion: version,
          toVersion: version + 1
        });
      }

      payload = normalizedFirstOutput;
      upcastPath.push(`${version}->${version + 1}`);
    }

    return {
      eventType,
      schemaVersion: currentVersion,
      payload: clonePlain(payload, '$.payload'),
      upcastPath,
      canonicalizationVersion: registered.publicDescriptor.canonicalizationVersion
    };
  }
}

module.exports = {
  EventTypeRegistry,
  REQUIRED_DESCRIPTOR_FIELDS,
  registryError
};
