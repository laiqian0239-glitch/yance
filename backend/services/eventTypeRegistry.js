'use strict';

const vm = require('node:vm');
const { canonicalSerialize } = require('./canonicalSerialization');
const { CLASSIFICATIONS } = require('./dataClassificationRegistry');

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
const ALLOWED_DESCRIPTOR_FIELDS = new Set([...REQUIRED_DESCRIPTOR_FIELDS, 'upcasters']);
const ALLOWED_UPCASTER_FIELDS = new Set(['fromVersion', 'toVersion', 'transform']);
const CLASSIFICATION_VALUES = new Set(Object.values(CLASSIFICATIONS));
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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
  { pattern: /\bperformance\s*\.\s*now\s*\(/, primitive: 'performance.now' },
  { pattern: /\bIntl\s*\./, primitive: 'Intl' },
  { pattern: /\bTemporal\s*\./, primitive: 'Temporal' }
]);

function registryError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function codeUnitCompare(leftInput, rightInput) {
  const left = String(leftInput);
  const right = String(rightInput);
  return left < right ? -1 : left > right ? 1 : 0;
}

function childPath(parent, key) {
  return parent === '$' ? `$.${key}` : `${parent}.${key}`;
}

function assertAllowedObjectKey(key, path) {
  if (FORBIDDEN_OBJECT_KEYS.has(key)) {
    throw registryError('EVENT_DESCRIPTOR_FORBIDDEN_KEY', 'Event registry data cannot contain prototype mutation keys', {
      fieldPath: childPath(path, key),
      key
    });
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbols(value, fieldPath) {
  if (value && typeof value === 'object' && Object.getOwnPropertySymbols(value).length) {
    throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values cannot contain symbol-keyed state', { fieldPath });
  }
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
    assertNoSymbols(value, path);
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value);
      const unexpected = ownNames.find(name => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(name));
      if (unexpected) {
        if (FORBIDDEN_OBJECT_KEYS.has(unexpected)) assertAllowedObjectKey(unexpected, path);
        throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry arrays cannot contain custom properties', { fieldPath: `${path}.${unexpected}` });
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
          throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry arrays must be dense data arrays', { fieldPath: `${path}[${index}]` });
        }
        result.push(clonePlain(descriptor.value, `${path}[${index}]`, seen));
      }
      return result;
    }
    if (!isPlainObject(value)) throw registryError('EVENT_DESCRIPTOR_VALUE_UNSAFE', 'Event registry values must use plain objects', { fieldPath: path });
    const result = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.getOwnPropertyNames(value).sort(codeUnitCompare)) {
      assertAllowedObjectKey(key, path);
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

function functionExpression(source) {
  if (/^async\s+function\b/.test(source) || /^function\b/.test(source) || /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(source)) {
    return source;
  }
  if (/^async\s+[A-Za-z_$][\w$]*\s*\(/.test(source)) return source.replace(/^async\s+/, 'async function ');
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(source)) return `function ${source}`;
  throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Unsupported upcaster function syntax');
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

function compileUpcasterExpression(source, details) {
  const expression = functionExpression(source);
  try {
    new vm.Script(`(${expression})`, {
      filename: `yance-upcaster-${details.eventType}-${details.fromVersion}-${details.toVersion}.js`
    });
  } catch (error) {
    throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcaster source cannot be compiled as an isolated function', {
      ...details,
      causeMessage: error?.message || String(error)
    });
  }
  return expression;
}

function serializeVmBoundaryInput(input, details) {
  try {
    const encoded = JSON.stringify(input);
    if (typeof encoded !== 'string') throw new TypeError('input JSON encoding did not produce a string');
    return encoded;
  } catch (error) {
    throw registryError('EVENT_UPCASTER_INPUT_UNSAFE', 'Upcaster input cannot cross the primitive JSON boundary', {
      ...details,
      causeName: error?.name || '',
      causeMessage: error?.message || String(error)
    });
  }
}

function parseVmBoundaryOutput(encoded, code, message, details) {
  if (typeof encoded !== 'string') throw registryError(code, message, details);
  try {
    return JSON.parse(encoded);
  } catch (error) {
    throw registryError(code, message, {
      ...details,
      causeName: error?.name || '',
      causeMessage: error?.message || String(error)
    });
  }
}

function executeSandboxedUpcaster(expression, input, details) {
  // Only primitives cross into the VM. Passing a host-origin object gives its
  // constructor chain access to the host Function constructor, which defeats
  // codeGeneration restrictions. The VM creates its own input with its own
  // JSON intrinsic, and only JSON strings cross back to the host.
  const sandbox = Object.create(null);
  sandbox.__inputJson = serializeVmBoundaryInput(input, details);
  sandbox.__inputAfterJson = '';
  sandbox.__outputJson = '';
  sandbox.__async = false;

  const context = vm.createContext(sandbox, {
    name: `yance-upcaster-${details.eventType}-${details.fromVersion}-${details.toVersion}`,
    codeGeneration: { strings: false, wasm: false }
  });
  try {
    new vm.Script(`
      Object.defineProperty(Math, 'random', { value: undefined, configurable: false, writable: false });
      Object.freeze(Math);
    `).runInContext(context, { timeout: 20 });
    new vm.Script(`
      'use strict';
      const __input = JSON.parse(globalThis.__inputJson);
      delete globalThis.__inputJson;
      const __output = (${expression})(__input);
      globalThis.__async = Boolean(__output && typeof __output.then === 'function');
      if (!globalThis.__async) {
        const __inputAfterJson = JSON.stringify(__input);
        const __outputJson = JSON.stringify(__output);
        if (typeof __inputAfterJson !== 'string' || typeof __outputJson !== 'string') {
          throw new TypeError('upcaster input/output is not JSON data');
        }
        globalThis.__inputAfterJson = __inputAfterJson;
        globalThis.__outputJson = __outputJson;
      }
    `, {
      filename: `yance-upcaster-${details.eventType}-${details.fromVersion}-${details.toVersion}.js`
    }).runInContext(context, { timeout: 50 });
  } catch (error) {
    throw registryError('EVENT_UPCASTER_SANDBOX_VIOLATION', 'Upcaster attempted to use an unavailable host capability or exceeded its deterministic execution budget', {
      ...details,
      causeName: error?.name || '',
      causeMessage: error?.message || String(error)
    });
  }
  if (sandbox.__async === true) return { async: true, inputAfter: null, output: null };
  return {
    async: false,
    inputAfter: parseVmBoundaryOutput(
      sandbox.__inputAfterJson,
      'EVENT_UPCASTER_INPUT_UNSAFE',
      'Upcaster input could not be returned through the primitive JSON boundary',
      details
    ),
    output: parseVmBoundaryOutput(
      sandbox.__outputJson,
      'EVENT_UPCASTER_OUTPUT_UNSAFE',
      'Upcaster output could not be returned through the primitive JSON boundary',
      details
    )
  };
}

function normalizeUpcasters(value, schemaVersion, eventType) {
  const input = value == null ? [] : value;
  if (!Array.isArray(input)) {
    throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'upcasters must be an array', { eventType });
  }
  const normalized = input.map((entry, index) => {
    if (!isPlainObject(entry) || Object.getOwnPropertySymbols(entry).length) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Each upcaster must be a plain object without symbol keys', { eventType, index });
    }
    const unknownField = Object.getOwnPropertyNames(entry).find(field => !ALLOWED_UPCASTER_FIELDS.has(field));
    if (unknownField) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcaster contains an unregistered field', { eventType, index, field: unknownField });
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Object.values(descriptors).some(descriptor => typeof descriptor.get === 'function' || typeof descriptor.set === 'function')) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcaster descriptors cannot contain accessors', { eventType, index });
    }
    const fromVersion = Number(descriptors.fromVersion?.value);
    const toVersion = Number(descriptors.toVersion?.value);
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || !Number.isInteger(toVersion) || toVersion !== fromVersion + 1) {
      throw registryError('EVENT_UPCASTER_CHAIN_INVALID', 'Upcasters must advance exactly one positive schema version', {
        eventType,
        index,
        fromVersion: descriptors.fromVersion?.value,
        toVersion: descriptors.toVersion?.value
      });
    }
    const transform = descriptors.transform?.value;
    const transformSource = functionSource(transform);
    assertDeterministicSource(transformSource, eventType, fromVersion, toVersion);
    const expression = compileUpcasterExpression(transformSource, { eventType, fromVersion, toVersion });
    return { fromVersion, toVersion, transformSource, expression };
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
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const field of REQUIRED_DESCRIPTOR_FIELDS) {
    const value = descriptors[field]?.value;
    if (!Object.prototype.hasOwnProperty.call(descriptors, field) || value === undefined || value === null || value === '') {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INCOMPLETE', `Event descriptor is missing ${field}`, { field });
    }
  }
}

function assertDescriptorShape(input) {
  if (Object.getOwnPropertySymbols(input).length) {
    throw registryError('EVENT_TYPE_DESCRIPTOR_FIELD_UNREGISTERED', 'Event descriptor cannot contain symbol-keyed state', { field: '[symbol]' });
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const accessor = Object.getOwnPropertyNames(input).find(field => typeof descriptors[field]?.get === 'function' || typeof descriptors[field]?.set === 'function');
  if (accessor) throw registryError('EVENT_TYPE_DESCRIPTOR_FIELD_UNREGISTERED', 'Event descriptor cannot contain accessors', { field: accessor });
  const forbidden = Object.getOwnPropertyNames(input).find(field => FORBIDDEN_OBJECT_KEYS.has(field));
  if (forbidden) {
    throw registryError('EVENT_DESCRIPTOR_FORBIDDEN_KEY', 'Event descriptor cannot contain prototype mutation keys', {
      field: forbidden,
      fieldPath: childPath('$', forbidden)
    });
  }
  const unknown = Object.getOwnPropertyNames(input).find(field => !ALLOWED_DESCRIPTOR_FIELDS.has(field));
  if (unknown) throw registryError('EVENT_TYPE_DESCRIPTOR_FIELD_UNREGISTERED', `Event descriptor field ${unknown} is not registered`, { field: unknown });
}

function assertClassificationCoverage(payloadSchema, classificationSchema) {
  const required = Array.isArray(payloadSchema.required) ? payloadSchema.required : [];
  for (const field of required) {
    if (typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(classificationSchema, field)) {
      throw registryError('EVENT_CLASSIFICATION_SCHEMA_INCOMPLETE', `Required payload field ${String(field)} has no classification`, { field });
    }
  }
  for (const field of Object.getOwnPropertyNames(classificationSchema)) {
    if (!CLASSIFICATION_VALUES.has(classificationSchema[field])) {
      throw registryError('EVENT_CLASSIFICATION_SCHEMA_INVALID', `Payload field ${field} has an invalid classification`, {
        field,
        classification: classificationSchema[field]
      });
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
    assertDescriptorShape(input);
    assertRequiredDescriptorFields(input);

    const descriptors = Object.getOwnPropertyDescriptors(input);
    const eventType = String(descriptors.eventType.value).trim();
    const aggregateType = String(descriptors.aggregateType.value).trim();
    const schemaVersion = Number(descriptors.schemaVersion.value);
    const canonicalizationVersion = Number(descriptors.canonicalizationVersion.value);
    const retentionClass = String(descriptors.retentionClass.value).trim();
    const payloadSchemaInput = descriptors.payloadSchema.value;
    const classificationSchemaInput = descriptors.classificationSchema.value;
    const projectionCompatibilityInput = descriptors.projectionCompatibility.value;
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
    if (!isPlainObject(payloadSchemaInput) || !isPlainObject(classificationSchemaInput)) {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'payloadSchema and classificationSchema must be plain objects', { eventType });
    }
    if (!Array.isArray(projectionCompatibilityInput)) {
      throw registryError('EVENT_TYPE_DESCRIPTOR_INVALID', 'projectionCompatibility must be an array', { eventType });
    }

    const payloadSchema = deepFreeze(clonePlain(payloadSchemaInput, '$.payloadSchema'));
    const classificationSchema = deepFreeze(clonePlain(classificationSchemaInput, '$.classificationSchema'));
    assertClassificationCoverage(payloadSchema, classificationSchema);
    const upcasters = normalizeUpcasters(descriptors.upcasters?.value, schemaVersion, eventType);
    const normalized = {
      eventType,
      schemaVersion,
      aggregateType,
      payloadSchema,
      classificationSchema,
      canonicalizationVersion,
      projectionCompatibility: Object.freeze(projectionCompatibilityInput.map(value => String(value).trim())),
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
        transformSource: item.transformSource
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
      const details = { eventType, fromVersion: version, toVersion: version + 1 };
      const firstInput = clonePlain(payload, '$.payload');
      const firstBefore = canonicalSerialize(firstInput);
      const firstExecution = executeSandboxedUpcaster(upcaster.expression, firstInput, details);
      if (firstExecution.async) {
        throw registryError('EVENT_UPCASTER_ASYNC_FORBIDDEN', 'Event upcasters must be synchronous pure functions', details);
      }
      if (canonicalSerialize(firstExecution.inputAfter) !== firstBefore) {
        throw registryError('EVENT_UPCASTER_MUTATED_INPUT', 'Event upcaster mutated its input payload', details);
      }
      const normalizedFirstOutput = clonePlain(firstExecution.output, '$.upcastOutput');

      const secondInput = clonePlain(payload, '$.payload');
      const secondBefore = canonicalSerialize(secondInput);
      const secondExecution = executeSandboxedUpcaster(upcaster.expression, secondInput, details);
      if (secondExecution.async) {
        throw registryError('EVENT_UPCASTER_ASYNC_FORBIDDEN', 'Event upcasters must be synchronous pure functions', details);
      }
      if (canonicalSerialize(secondExecution.inputAfter) !== secondBefore) {
        throw registryError('EVENT_UPCASTER_MUTATED_INPUT', 'Event upcaster mutated its input payload', details);
      }
      const normalizedSecondOutput = clonePlain(secondExecution.output, '$.upcastOutput');
      if (canonicalSerialize(normalizedFirstOutput) !== canonicalSerialize(normalizedSecondOutput)) {
        throw registryError('EVENT_UPCASTER_NONDETERMINISTIC', 'Event upcaster returned different outputs for the same input', details);
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
