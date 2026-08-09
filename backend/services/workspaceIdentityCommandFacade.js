'use strict';

const { ContactIdentityConfirmationRepository } = require('../store/contactIdentityConfirmationRepository');
const { createContactIdentityConfirmationService } = require('./contactIdentityConfirmationService');
const { ContactMergeRepository } = require('../store/contactMergeRepository');
const { createContactMergeService } = require('./contactMergeService');
const { RelationshipKeyNodeRepository } = require('../store/relationshipKeyNodeRepository');
const { createRelationshipKeyNodeService } = require('./relationshipKeyNodeService');

let binding = null;

function facadeError(code, message) {
  return Object.assign(new Error(message), { code, status: 503 });
}

function configureWorkspaceIdentityCommandFacade(options = {}) {
  const db = options.db;
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw facadeError('WORKSPACE_IDENTITY_DB_CAPABILITY_REQUIRED', 'Workspace identity commands require the broker-owned database capability');
  }
  if (binding) {
    if (binding.db === db) return binding.facade;
    const testReset = process.env.YANCE_TEST_ONLY_RUNTIME_RESET === '1' || process.env.NODE_ENV === 'test';
    if (!testReset) {
      throw facadeError('WORKSPACE_IDENTITY_AUTHORITY_ALREADY_CONFIGURED', 'Workspace identity command authority is already bound to another database');
    }
  }
  const identityService = createContactIdentityConfirmationService({
    store: new ContactIdentityConfirmationRepository({ db }),
    now: () => Date.now()
  });
  const mergeService = createContactMergeService({
    store: new ContactMergeRepository({ db }),
    now: () => Date.now()
  });
  const keyNodeService = createRelationshipKeyNodeService({
    store: new RelationshipKeyNodeRepository({ db }),
    now: () => Date.now()
  });
  const facade = Object.freeze({
    identityService,
    mergeService,
    keyNodeService,
    relationshipFactProjectionService: keyNodeService
  });
  binding = Object.freeze({ db, facade });
  return facade;
}

function getWorkspaceIdentityCommandFacade() {
  if (!binding) {
    throw facadeError('WORKSPACE_IDENTITY_AUTHORITY_NOT_READY', 'Workspace identity command authority is not configured');
  }
  return binding.facade;
}

module.exports = {
  configureWorkspaceIdentityCommandFacade,
  getWorkspaceIdentityCommandFacade
};
