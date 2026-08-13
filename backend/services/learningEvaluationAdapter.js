'use strict';

function createLearningEvaluationAdapter(options = {}) {
  const regression = options.regressionEvaluator || null; // Promptfoo/precomputed regression authority.
  const shadow = options.shadowEvaluator || null;

  async function evaluate(candidate, evidence = []) {
    if (!candidate || !Array.isArray(evidence) || evidence.length < 1) {
      return Object.freeze({ status: 'DATA_INSUFFICIENT', Regression: null, Shadow: null });
    }
    if (!regression || typeof regression.evaluate !== 'function') {
      return Object.freeze({ status: 'REGRESSION_UNAVAILABLE', Regression: null, Shadow: null });
    }
    const Regression = await regression.evaluate({ candidate, evidence });
    if (!Regression || Regression.passed !== true) {
      return Object.freeze({ status: 'REGRESSION_REJECTED', Regression, Shadow: null });
    }
    if (!shadow || typeof shadow.evaluate !== 'function') {
      return Object.freeze({ status: 'SHADOW_PENDING', Regression, Shadow: null });
    }
    const Shadow = await shadow.evaluate({ candidate, evidence, Regression });
    return Object.freeze({ status: Shadow?.passed === true ? 'READY_FOR_REVIEW' : 'SHADOW_REJECTED', Regression, Shadow });
  }

  return Object.freeze({ evaluate, authority: 'Promptfoo + Langfuse evidence; Model Brain execution only' });
}

module.exports = { createLearningEvaluationAdapter };
