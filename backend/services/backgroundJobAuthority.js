'use strict';

const core = require('./backgroundJobAuthorityCore');
const {
  recoverNonterminalExecutions
} = require('./durableExecutionRecoveryAuthority');

function recoverDurableExecutions(options = {}) {
  return recoverNonterminalExecutions(options);
}

module.exports = Object.freeze({
  STATES: core.STATES,
  recoverDurableExecutions,
  recoverNonterminalExecutions: recoverDurableExecutions
});
