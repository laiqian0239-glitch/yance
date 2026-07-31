'use strict';

const PERSONA_BRAIN_API_PREFIX = '/api/v2/persona';

const PERSONA_BRAIN_ROUTES = Object.freeze({
  current: '/:profileId/current',
  versions: '/:profileId/versions',
  version: '/:profileId/versions/:version',
  changes: '/:profileId/changes',
  initialize: '/:profileId/initialize',
  initializeDefault: '/:profileId/initialize-default',
  validate: '/:profileId/validate',
  export: '/:profileId/export',
  import: '/:profileId/import',
  pendingChanges: '/:profileId/pending-changes',
  pendingChangeDecision: '/:profileId/pending-changes/:changeId/decision',
  authoritative: '/:profileId/authoritative',
  learned: '/:profileId/learned',
  rollback: '/:profileId/rollback',
  migrateLegacy: '/:profileId/migrations/legacy'
});

const PERSONA_BRAIN_EVENTS = Object.freeze({
  initialized: 'persona.profile.initialized',
  versionCreated: 'persona.version.created',
  versionRolledBack: 'persona.version.rolled-back',
  pendingChangeProposed: 'persona.pending-change.proposed',
  pendingChangeDecided: 'persona.pending-change.decided',
  migrationCompleted: 'persona.migration.completed',
  migrationFailed: 'persona.migration.failed',
  contextInvalidated: 'persona.context.invalidated',
  scopeUpdated: 'persona.scope.updated',
  scopeCleared: 'persona.scope.cleared'
});

const PERSONA_BRAIN_EVENT_PAYLOAD_POLICY = Object.freeze({
  allowedFields: Object.freeze([
    'profileId',
    'version',
    'parentVersion',
    'operation',
    'contentSha256',
    'changedPaths',
    'rollbackOfVersion',
    'changeId',
    'baseVersion',
    'state',
    'appliedVersion',
    'migrationId',
    'sourceKind',
    'sourceFingerprint',
    'schemaVersion',
    'reasonCode',
    'scopeType',
    'scopeId',
    'bindingVersion',
    'effectiveLabel'
  ]),
  forbiddenFields: Object.freeze([
    'content',
    'document',
    'patch',
    'legacyDocument',
    'authoritative',
    'learned',
    'credentials',
    'messageText'
  ])
});

module.exports = {
  PERSONA_BRAIN_API_PREFIX,
  PERSONA_BRAIN_ROUTES,
  PERSONA_BRAIN_EVENTS,
  PERSONA_BRAIN_EVENT_PAYLOAD_POLICY
};
