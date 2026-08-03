'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('R32SqliteStore');

const engine = require('./r32SqliteStoreEngine');
const {
  applyArchitectureClosureV2WpB,
  TARGET_SCHEMA_VERSION: ACV2_WP_B_SCHEMA_VERSION
} = require('../migrations/architectureClosureV2WpB');
const { ensureCanonicalProjectionReceiptSchema } = require('../migrations/projectionReceiptSchemaAuthority');
const {
  requireSchema23StartupRegistration
} = require('../../shared/release/wpBM1RedEvidenceAuthority');

const SCHEMA_VERSION = Math.max(engine.SCHEMA_VERSION, ACV2_WP_B_SCHEMA_VERSION);
const ENGINE_PROTOTYPE = engine.R32SqliteStore.prototype;

function nowIso() {
  return new Date().toISOString();
}

function ensureSchema23(store) {
  ENGINE_PROTOTYPE.ensureSchema.call(store);
  requireSchema23StartupRegistration();
  applyArchitectureClosureV2WpB(store.db, { at: nowIso() });
  ensureCanonicalProjectionReceiptSchema(store.db);
}

function R32SqliteStore(options = {}) {
  if (!(this instanceof R32SqliteStore)) return new R32SqliteStore(options);
  return engine.R32SqliteStore.call(this, options);
}

R32SqliteStore.prototype = Object.create(ENGINE_PROTOTYPE);
Object.defineProperty(R32SqliteStore.prototype, 'constructor', {
  value: R32SqliteStore,
  enumerable: false,
  writable: true,
  configurable: true
});

R32SqliteStore.prototype.supportedSchemaVersion = function supportedSchemaVersion() {
  return SCHEMA_VERSION;
};
R32SqliteStore.prototype.ensureSchema = function ensureSchema() {
  return ensureSchema23(this);
};

module.exports = Object.freeze({
  ...engine,
  R32SqliteStore,
  SCHEMA_VERSION
});
