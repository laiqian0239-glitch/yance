'use strict';

const core = require('./jobQueueCore');
const {
  recoverNonterminalExecutions
} = require('./durableExecutionRecoveryAuthority');

function recoverDurableExecutions(options = {}) {
  return recoverNonterminalExecutions(options);
}

module.exports = Object.freeze({
  ...core,
  recoverDurableExecutions,
  recoverNonterminalExecutions: recoverDurableExecutions
});
