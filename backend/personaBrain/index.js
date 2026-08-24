'use strict';

const { getStore } = require('../repositories/storeProvider');
const { PersonaBrainRepository } = require('./repository');
const { PersonaBrainService } = require('./service');
const { createPersonaCandidateCoordinator } = require('./candidateCoordinator');
const { createPersonaValidator, validateAuthoritativeContent } = require('./validator');
const schema = require('./schema');
const document = require('./document');
const migrations = require('./migrations');
const compiler = require('./compiler');
const truthFirewall = require('./truthFirewall');
const defaultProfile = require('./defaultProfile');

function createPersonaBrain(options = {}) {
  const store = options.store || getStore();
  const repository = options.repository || new PersonaBrainRepository(store);
  const candidateCoordinator = options.candidateCoordinator || createPersonaCandidateCoordinator({ store });
  const validator = options.validator || createPersonaValidator({ validatorFn: validateAuthoritativeContent });
  const service = options.service || new PersonaBrainService(repository, { candidateCoordinator, validator });
  return {
    store,
    repository,
    service,
    candidateCoordinator,
    validator,
    // OD-004 规范运行时 API：兼容入口也必须委派到 effective scoped authority。
    compileContext: (profileId = 'owner', compileOptions = {}) =>
      service.compileEffectiveContext({ profileId }, compileOptions),
    compileEffectiveContext: (scope = {}, compileOptions = {}) =>
      service.compileEffectiveContext(scope, compileOptions),
    compilePersonaContext: compiler.compilePersonaContext
  };
}

module.exports = {
  createPersonaBrain,
  PersonaBrainRepository,
  PersonaBrainService,
  compilePersonaContext: compiler.compilePersonaContext,
  compileContextForProfile: compiler.compileContextForProfile,
  ...schema,
  ...document,
  ...migrations,
  ...truthFirewall,
  ...defaultProfile
};
