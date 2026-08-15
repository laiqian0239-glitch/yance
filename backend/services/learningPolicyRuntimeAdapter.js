'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ALLOWED_ACTIONS, normalizeFeatureBundle } = require('./learningPolicyDecisionContract');

const AUTHORITY = 'LearningPolicyRuntimeAdapter';
const BASELINE_POLICY_VERSION = 'vw-p1-baseline-v1';
const ACTIVE_FLAG_KEY = 'yance-learning-policy-active';
const POLICY_VERSION = 'vw-p1-v1';
const SHA256_RE = /^[0-9a-f]{64}$/u;

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
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function canonicalRoots(env = process.env) {
  const dataRoot = clean(env.YANCE_DATA_DIR);
  if (!dataRoot || !path.isAbsolute(dataRoot)) return null;
  const root = path.join(path.resolve(dataRoot), 'learning', 'learned-policy');
  return Object.freeze({
    root,
    flagFile: path.join(root, 'flagd', 'flags.json'),
    artifactRoot: path.join(root, 'artifacts')
  });
}
function artifactPathFor(roots, digest) {
  if (!roots || !SHA256_RE.test(clean(digest))) return null;
  return path.join(roots.artifactRoot, `${digest}.vw`);
}
function validatePolicyCandidate(candidate, roots) {
  const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null;
  const version = clean(value?.version || value?.policyArtifactVersion);
  const id = clean(value?.id || value?.policyArtifactId);
  if (!value || !SHA256_RE.test(version) || id !== `policy:${version}`) {
    throw runtimeError('LEARNING_POLICY_ACTIVE_IDENTITY_INVALID', 'Active Learning policy must use policy:<sha256> / <sha256> identity.');
  }
  const artifactPath = artifactPathFor(roots, version);
  if (!artifactPath || !fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw runtimeError('LEARNING_POLICY_ARTIFACT_MISSING', 'Content-addressed promoted VW artifact is missing.');
  }
  const actual = sha256File(artifactPath);
  if (actual !== version) {
    throw runtimeError('LEARNING_POLICY_ARTIFACT_IDENTITY_MISMATCH', 'Promoted VW artifact bytes do not match the promoted content address.', { expected: version, actual });
  }
  return Object.freeze({
    policyArtifactId: version,
    policyVersion: clean(value.policyVersion) || POLICY_VERSION,
    artifactPath
  });
}

let flagdClientPromise = null;
let flagdClientPath = '';
async function flagdClientFor(flagFile) {
  if (flagdClientPromise && flagdClientPath === flagFile) return flagdClientPromise;
  flagdClientPath = flagFile;
  flagdClientPromise = (async () => {
    const { OpenFeature } = require('@openfeature/server-sdk');
    const { FlagdProvider } = require('@openfeature/flagd-provider');
    const domain = 'yance-learning-policy';
    await OpenFeature.setProviderAndWait(domain, new FlagdProvider({
      resolverType: 'in-process',
      offlineFlagSourcePath: flagFile
    }));
    return OpenFeature.getClient(domain);
  })();
  try {
    return await flagdClientPromise;
  } catch (error) {
    flagdClientPromise = null;
    flagdClientPath = '';
    throw error;
  }
}

async function resolveProductionActivePolicy() {
  const roots = canonicalRoots();
  if (!roots || !fs.existsSync(roots.flagFile)) return null;
  const client = await flagdClientFor(roots.flagFile);
  const rollout = await client.getObjectValue(ACTIVE_FLAG_KEY, null);
  if (!rollout || rollout.kind !== 'LEARNING_ROLLOUT') return null;
  const candidates = [rollout.candidate, ...(Array.isArray(rollout.history) ? rollout.history : [])];
  let firstError = null;
  for (const candidate of candidates) {
    try {
      return validatePolicyCandidate(candidate, roots);
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
  return null;
}

function sealedLearningRuntimePaths() {
  const resourcesRoot = clean(process.resourcesPath);
  if (!resourcesRoot || !path.isAbsolute(resourcesRoot)) return null;
  const runtimeRoot = path.join(resourcesRoot, 'learning-runtime');
  const python = path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe');
  const entrypoint = path.join(runtimeRoot, 'learning_entrypoint.py');
  if (!fs.existsSync(python) || !fs.existsSync(entrypoint)) return null;
  return Object.freeze({ python, entrypoint });
}
function invokeProductionVowpalWabbit(input = {}) {
  const runtime = sealedLearningRuntimePaths();
  if (!runtime) throw runtimeError('SEALED_VW_RUNTIME_UNAVAILABLE', 'Packaged sealed Learning/VW runtime is unavailable.');
  const artifactPath = clean(input.artifactPath);
  if (!artifactPath || !path.isAbsolute(artifactPath)) throw runtimeError('LEARNING_POLICY_ARTIFACT_PATH_INVALID', 'Policy artifact path must be canonical and absolute.');
  const request = {
    operation: 'policy_predict',
    featureBundle: input.featureBundle,
    allowedActions: input.allowedActions,
    artifactPath,
    policyArtifactId: input.policyArtifactId,
    policyVersion: input.policyVersion || POLICY_VERSION
  };
  const result = spawnSync(runtime.python, ['-B', '-I', runtime.entrypoint], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost' }
  });
  if (result.error) throw result.error;
  let parsed = null;
  try { parsed = JSON.parse(clean(result.stdout) || '{}'); } catch (_) {}
  if (result.status !== 0 || parsed?.status === 'ERROR') {
    throw runtimeError('SEALED_VW_POLICY_PREDICTION_FAILED', clean(parsed?.error || result.stderr || `sealed VW runtime exit ${result.status}`));
  }
  return parsed;
}

function createLearningPolicyRuntimeAdapter(options = {}) {
  const hasInjectedRuntime = typeof options.invokeVowpalWabbit === 'function';
  const hasInjectedResolver = typeof options.resolveActivePolicy === 'function';
  const invokeVowpalWabbit = hasInjectedRuntime ? options.invokeVowpalWabbit : invokeProductionVowpalWabbit;
  const resolveActivePolicy = hasInjectedResolver ? options.resolveActivePolicy : resolveProductionActivePolicy;
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
    let activePolicy = null;
    try {
      activePolicy = await resolveActivePolicy({ featureBundle, allowedActions });
    } catch (error) {
      const reasonCode = clean(error?.reasonCode || error?.code) || 'LEARNING_POLICY_ACTIVE_RESOLUTION_FAILED';
      onDegradation?.({ reasonCode, message: clean(error?.message) });
      if (input.failClosed === true) throw error;
      return baseline({ ...input, allowedActions }, reasonCode);
    }
    // Test/UAT may inject the sealed operation directly; production never accepts
    // request-supplied active policy, artifact path, hash, or executable authority.
    if (!activePolicy && !hasInjectedRuntime) return baseline({ ...input, allowedActions }, 'NO_PROMOTED_POLICY');

    try {
      const result = await invokeVowpalWabbit({
        operation: 'policy_predict',
        featureBundle,
        allowedActions,
        policyArtifactId: clean(activePolicy?.policyArtifactId),
        policyVersion: clean(activePolicy?.policyVersion) || POLICY_VERSION,
        artifactPath: clean(activePolicy?.artifactPath)
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
        policyVersion: clean(result?.policyVersion || activePolicy?.policyVersion) || POLICY_VERSION,
        policyArtifactId: clean(result?.policyArtifactId || result?.policyArtifactVersion || activePolicy?.policyArtifactId) || 'baseline',
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

module.exports = {
  AUTHORITY,
  BASELINE_POLICY_VERSION,
  ACTIVE_FLAG_KEY,
  createLearningPolicyRuntimeAdapter,
  resolveProductionActivePolicy,
  invokeProductionVowpalWabbit
};
