'use strict';

require('./jobQueueCore');
const {
  recoverNonterminalExecutions
} = require('./durableExecutionRecoveryAuthority');

function recoverDurableExecutions(options = {}) {
  return recoverNonterminalExecutions(options);
}

module.exports = Object.freeze({
  recoverDurableExecutions,
  recoverNonterminalExecutions: recoverDurableExecutions
});
