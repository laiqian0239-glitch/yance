'use strict';

function createLearningEvidenceBridge(options = {}) {
  const dataPolicy = options.dataPolicy;
  const langfuse = options.langfuse;
  if (!dataPolicy || typeof dataPolicy.minimize !== 'function') throw new TypeError('Learning evidence bridge requires learningDataPolicy.');
  if (!langfuse || typeof langfuse.recordExecution !== 'function') throw new TypeError('Learning evidence bridge requires Langfuse adapter.');

  async function modelBrainExecutionEvidence(evidence = {}) {
    const text = String(evidence.output || evidence.text || '');
    const minimized = await dataPolicy.minimize({
      text,
      language: evidence.language,
      doNotLearn: evidence.doNotLearn,
      do_not_learn: evidence.do_not_learn
    });
    if (!minimized.allowed) {
      return Object.freeze({ accepted: false, reasonCode: minimized.reasonCode || 'DATA_INSUFFICIENT' });
    }
    if (!text.trim()) return Object.freeze({ accepted: false, reasonCode: 'DATA_INSUFFICIENT' });
    const record = await langfuse.recordExecution({ ...evidence, output: minimized.text });
    return Object.freeze({ accepted: true, minimized: true, Langfuse: record });
  }

  return Object.freeze({ modelBrainExecutionEvidence });
}

module.exports = { createLearningEvidenceBridge };
