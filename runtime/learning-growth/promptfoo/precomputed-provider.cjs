'use strict';

class YancePrecomputedProvider {
  id() { return 'yance-precomputed-model-brain'; }
  async callApi(prompt, context = {}) {
    const vars = context?.vars || {};
    const output = vars.modelBrainOutput ?? vars.output;
    if (typeof output !== 'string') {
      return { error: 'MODEL_BRAIN_PRECOMPUTED_OUTPUT_REQUIRED' };
    }
    return {
      output,
      tokenUsage: vars.tokenUsage && typeof vars.tokenUsage === 'object' ? vars.tokenUsage : undefined,
      metadata: {
        authority: 'Model Brain V4',
        providerCallsForbidden: true,
        promptReference: typeof prompt === 'string' ? prompt.slice(0, 160) : ''
      }
    };
  }
}

module.exports = YancePrecomputedProvider;
