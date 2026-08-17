'use strict';

const core = require('./asyncOperationLifecycleAuthorityCore');
const {
  recoverNonterminalExecutions
} = require('./durableExecutionRecoveryAuthority');

function recoverDurableExecutions(options = {}) {
  return recoverNonterminalExecutions(options);
}

module.exports = Object.freeze({
  STATES: core.STATES,
  TERMINAL: core.TERMINAL,
  recoverDurableExecutions,
  recoverNonterminalExecutions: recoverDurableExecutions
});
