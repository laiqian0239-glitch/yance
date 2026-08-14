'use strict';

const { ALLOWED_ACTIONS, normalizeFeatureBundle } = require('./learningPolicyDecisionContract');

const AUTHORITY = 'LearningPolicyRuntimeAdapter';
const BASELINE_POLICY_VERSION = 'vw-p1-baseline-v1';

function clean(value) { return String(value == null ? '' : value).trim(); }
function runtimeError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message || reasonCode), { reasonCode, code: reasonCode, ...details });
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
function exactAllowedActions(values) {
  const actions = Array.isArray(values) ? values.map(clean).filter(Boolean) : [];
  if (!actions.length || actions.some(action => !ALLOWED_ACTIONS.includes(action)) || new Set(actions).size !== actions.length) {
    throw runtimeError('LEARNING_POLICY_ACTION_SET_INVALID', 'Learned Policy requires a non-empty exact subset of the frozen P1 action set.');
  }
  return actions;
}

function createLearningPolicyRuntimeAdapter(options = {}) {
  const invokeVowpalWabbit = typeof options.invokeVowpalWabbit === 'function' ? options.invokeVowpalWabbit : null;
  const resolveActivePolicy = typeof options.resolveActivePolicy === 'function' ? options.resolveActivePolicy : null;
  const onDegradation = typeof options.onDegradation === 'function' ? options.onDegradation : null;

  function baseline(input, reasonCode = 'NO_PROMOTED_POLICY') {
    const actions = exactAllowedActions(input.allowedActions);
    const requested = clean(input.baselineAction);
    const candidateStrategyBranch = actions.includes(requested) ? requested : actions[0];
    return deepFreeze({
      authority: AUTHORITY,
      candidateStrategyBranch,
      policyVersion: BASELINE_POLICY_VERSION,
      policyArtifactId: 'baseline',
      actionProbability: 1,
      exploration: false,
      degradation: reasonCode === 'NO_PROMOTED_POLICY' ? null : { reasonCode },
      executedPolicy: 'baseline'
    });
  }

  async function selectLearnedPolicyAction(input = {}) {
    const featureBundle = normalizeFeatureBundle(input.featureBundle || {});
    const allowedActions = exactAllowedActions(input.allowedActions || ALLOWED_ACTIONS);
    let activePolicy = input.activePolicy && typeof input.activePolicy === 'object' ? input.activePolicy : null;
    if (!activePolicy && resolveActivePolicy) activePolicy = await resolveActivePolicy({ featureBundle, allowedActions });

    // Production constructs this adapter without an arbitrary request-supplied
    // runtime. Tests/UAT may inject the already-sealed VW operation directly.
    // No runtime injection means an explicit deterministic baseline.
    if (!invokeVowpalWabbit && !activePolicy) return baseline({ ...input, allowedActions }, 'NO_PROMOTED_POLICY');
    if (!invokeVowpalWabbit) {
      onDegradation?.({ reasonCode: 'SEALED_VW_RUNTIME_UNAVAILABLE', policyArtifactId: clean(activePolicy?.policyArtifactId) });
      return baseline({ ...input, allowedActions }, 'SEALED_VW_RUNTIME_UNAVAILABLE');
    }

    try {
      const result = await invokeVowpalWabbit({
        operation: 'policy_predict',
        featureBundle,
        allowedActions,
        policyArtifactId: clean(activePolicy?.policyArtifactId || input.policyArtifactId),
        policyVersion: clean(activePolicy?.policyVersion || input.policyVersion) || 'vw-p1-v1'
      });
      const action = clean(result?.action || result?.candidateStrategyBranch);
      if (!allowedActions.includes(action)) {
        throw runtimeError('LEARNING_POLICY_RUNTIME_ACTION_INVALID', 'Sealed VW runtime returned an action outside the supplied exact action set.', { action });
      }
      const probability = Number(result?.probability ?? result?.actionProbability ?? 1);
      if (probability !== 1 || result?.exploration === true) {
        throw runtimeError('LEARNING_POLICY_RUNTIME_P1_NONDETERMINISTIC', 'P1 Learned Policy must remain deterministic with probability 1 and exploration disabled.');
      }
      return deepFreeze({
        authority: AUTHORITY,
        candidateStrategyBranch: action,
        policyVersion: clean(result?.policyVersion || activePolicy?.policyVersion || input.policyVersion) || 'vw-p1-v1',
        policyArtifactId: clean(result?.policyArtifactId || result?.policyArtifactVersion || activePolicy?.policyArtifactId || input.policyArtifactId) || 'baseline',
        actionProbability: 1,
        exploration: false,
        degradation: null,
        executedPolicy: 'vowpalwabbit'
      });
    } catch (error) {
      const reasonCode = clean(error?.reasonCode || error?.code) || 'SEALED_VW_POLICY_PREDICTION_FAILED';
      onDegradation?.({ reasonCode, policyArtifactId: clean(activePolicy?.policyArtifactId), message: clean(error?.message) });
      if (input.failClosed === true) throw error;
      return baseline({ ...input, allowedActions }, reasonCode);
    }
  }

  return Object.freeze({ authority: AUTHORITY, selectLearnedPolicyAction, baseline });
}

module.exports = { AUTHORITY, BASELINE_POLICY_VERSION, createLearningPolicyRuntimeAdapter };
