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
    // OD-004 规范运行时 API：编译活跃 persona 上下文（AI task 入口）
    compileContext: (profileId = 'owner', compileOptions = {}) =>
      compiler.compileContextForProfile(service, profileId, compileOptions),
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
