'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const RUNTIME_RELATIVE_PATH = 'runtime/deep-training/agent-lightning/agent_lightning_entrypoint.py';
const MAX_PROTOCOL_LINE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

function adapterError(reasonCode, message) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function windowsPathToWsl(filePath) {
  const normalized = path.resolve(filePath);
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(normalized);
  if (!match) {
    throw adapterError('AGENT_LIGHTNING_WSL_PATH_REQUIRED', 'Agent Lightning Windows execution requires a drive-backed WSL path.');
  }
  const drive = match[1].toLowerCase();
  return `/mnt/${drive}/${match[2].replaceAll('\\', '/')}`;
}

function minimalLinuxEnvironment() {
  return Object.freeze({
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8'
  });
}

function minimalWindowsSupervisorEnvironment() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function createSealedAgentLightningRuntimeInvoker(options = {}) {
  const runtimePath = path.resolve(
    options.repositoryRoot || path.resolve(__dirname, '../..'),
    options.runtimeRelativePath || RUNTIME_RELATIVE_PATH
  );
  const runtimePython = clean(options.runtimePython) || 'python3';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1_000, options.timeoutMs) : 15 * 60 * 1000;
  const spawnProcess = typeof options.spawnProcess === 'function' ? options.spawnProcess : spawn;

  return function invokeAgentLightningRuntime(input = {}) {
    if (typeof input.complete !== 'function') {
      return Promise.reject(adapterError('AGENT_LIGHTNING_MODEL_BRAIN_REQUIRED', 'Model Brain completion bridge is required.'));
    }

    let command;
    let args;
    let env;
    if (process.platform === 'win32') {
      command = 'wsl.exe';
      args = [
        '--exec',
        'env', '-i',
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'LANG=C.UTF-8', 'LC_ALL=C.UTF-8',
        runtimePython,
        windowsPathToWsl(runtimePath),
        '--stdio'
      ];
      env = minimalWindowsSupervisorEnvironment();
    } else {
      command = runtimePython;
      args = [runtimePath, '--stdio'];
      env = minimalLinuxEnvironment();
    }

    const child = spawnProcess(command, args, {
      cwd: path.dirname(runtimePath),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let sawResult = false;
      let stderr = '';
      let completionCount = 0;
      let timer = null;
      let lines = null;
      const pendingWrites = new Set();

      function finish(error, result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (lines) lines.close();
        if (!child.killed) child.kill();
        if (error) reject(error);
        else resolve(result);
      }

      function writeMessage(message) {
        if (settled || child.stdin.destroyed) return;
        const line = `${JSON.stringify(message)}\n`;
        if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
          finish(adapterError('AGENT_LIGHTNING_PROTOCOL_LIMIT', 'Agent Lightning protocol message exceeded the bounded line limit.'));
          return;
        }
        child.stdin.write(line);
      }

      child.once('error', error => {
        finish(adapterError('AGENT_LIGHTNING_RUNTIME_UNAVAILABLE', `Sealed Agent Lightning runtime could not start: ${error.message}`));
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        if (stderr.length < MAX_STDERR_BYTES) stderr = `${stderr}${chunk}`.slice(0, MAX_STDERR_BYTES);
      });

      lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', line => {
        if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
          finish(adapterError('AGENT_LIGHTNING_PROTOCOL_LIMIT', 'Agent Lightning runtime emitted an oversized protocol line.'));
          return;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(adapterError('AGENT_LIGHTNING_PROTOCOL_INVALID', 'Agent Lightning runtime emitted invalid protocol JSON.'));
          return;
        }

        if (message?.type === 'completion_request') {
          const requestId = clean(message.requestId);
          if (!requestId || !Array.isArray(message.messages) || !message.options || typeof message.options !== 'object') {
            finish(adapterError('AGENT_LIGHTNING_COMPLETION_REQUEST_INVALID', 'Agent Lightning completion request was outside the bounded Model Brain contract.'));
            return;
          }
          const work = Promise.resolve()
            .then(() => input.complete({ messages: message.messages, options: message.options }))
            .then(completion => {
              if (!completion || typeof completion.text !== 'string') {
                throw adapterError('AGENT_LIGHTNING_MODEL_BRAIN_COMPLETION_REQUIRED', 'Model Brain completion text is required.');
              }
              completionCount += 1;
              writeMessage({ type: 'completion_response', requestId, text: completion.text });
            })
            .catch(error => {
              writeMessage({
                type: 'completion_error',
                requestId,
                code: clean(error?.reasonCode) || 'AGENT_LIGHTNING_MODEL_BRAIN_COMPLETION_FAILED',
                message: 'Model Brain completion failed.'
              });
            })
            .finally(() => pendingWrites.delete(work));
          pendingWrites.add(work);
          return;
        }

        if (message?.type === 'result') {
          sawResult = true;
          const result = message.result;
          if (result?.evidence && typeof result.evidence === 'object') {
            result.evidence = Object.freeze({ ...result.evidence, modelBrainCompletionCount: completionCount });
          }
          finish(null, result);
          return;
        }

        if (message?.type === 'error') {
          finish(adapterError(clean(message.code) || 'AGENT_LIGHTNING_RUNTIME_FAILED', clean(message.message) || 'Sealed Agent Lightning runtime failed.'));
          return;
        }

        finish(adapterError('AGENT_LIGHTNING_PROTOCOL_INVALID', 'Agent Lightning runtime emitted an unsupported protocol message.'));
      });

      child.once('exit', (code, signal) => {
        if (settled) return;
        Promise.allSettled([...pendingWrites]).finally(() => {
          if (!settled && !sawResult) {
            const diagnostic = clean(stderr).slice(0, 2_000);
            finish(adapterError(
              'AGENT_LIGHTNING_RUNTIME_FAILED',
              `Sealed Agent Lightning runtime exited before CANDIDATE_ONLY result (code=${code}, signal=${signal || 'none'}).${diagnostic ? ` ${diagnostic}` : ''}`
            ));
          }
        });
      });

      timer = setTimeout(() => {
        finish(adapterError('AGENT_LIGHTNING_RUNTIME_TIMEOUT', 'Sealed Agent Lightning runtime exceeded the bounded execution timeout.'));
      }, timeoutMs);

      const { complete, ...envelope } = input;
      writeMessage(envelope);
    });
  };
}

function createAgentLightningTrainingAdapter(options = {}) {
  const learningContract = options.learningContract || null;
  const modelExecutor = options.modelExecutor || null;
  const runtimeInvoker = options.runtimeInvoker || createSealedAgentLightningRuntimeInvoker(options.runtime || {});

  if (!learningContract || typeof learningContract.projectRelationship !== 'function'
    || typeof learningContract.bindExperimentEvidence !== 'function') {
    throw adapterError('AGENT_LIGHTNING_LEARNING_CONTRACT_REQUIRED', 'The landed Learning Deep Training contract is required.');
  }
  if (!modelExecutor || typeof modelExecutor.executeModel !== 'function') {
    throw adapterError('AGENT_LIGHTNING_MODEL_BRAIN_REQUIRED', 'Model Brain executeModel authority is required.');
  }
  if (typeof runtimeInvoker !== 'function') {
    throw adapterError('AGENT_LIGHTNING_RUNTIME_REQUIRED', 'The sealed Agent Lightning runtime invoker is required.');
  }

  function validateProjection(projection, expectedScopeType, globalRun) {
    if (!projection || typeof projection !== 'object'
      || projection.authority !== 'Learning'
      || projection.readOnly !== true
      || projection.learningLevel !== 'L1'
      || projection.scopeType !== expectedScopeType
      || !clean(projection.scopeId)
      || !Array.isArray(projection.trajectory)) {
      throw adapterError(
        'AGENT_LIGHTNING_LEARNING_PROJECTION_REQUIRED',
        'Agent Lightning accepts only a Learning-issued read-only L1 projection.'
      );
    }

    if (globalRun && (projection.globalAggregation !== true || !clean(projection.globalEligibilityEvidenceId))) {
      throw adapterError('AGENT_LIGHTNING_GLOBAL_ELIGIBILITY_REQUIRED', 'Global runs require explicit Learning global eligibility evidence.');
    }

    for (const record of projection.trajectory) {
      if (!record || record.scopeType !== projection.scopeType || record.scopeId !== projection.scopeId) {
        throw adapterError('AGENT_LIGHTNING_SCOPE_MISMATCH', 'Learning projection records must remain inside one canonical scope.');
      }
    }
    return projection;
  }

  function projectRewards(projection) {
    return Object.freeze(projection.trajectory.map(record => {
      const score = record?.score;
      if (!score || score.authority !== 'Langfuse' || score.approvedByLearning !== true
        || typeof score.value !== 'number' || !Number.isFinite(score.value)) {
        throw adapterError(
          'AGENT_LIGHTNING_NUMERIC_REWARD_REQUIRED',
          'Only finite numeric Learning-approved Langfuse Score evidence may cross as reward.'
        );
      }
      return Object.freeze({ signalId: clean(record.signalId), value: score.value });
    }));
  }

  function projectTasks(projection, rewards) {
    return Object.freeze(projection.trajectory.map((record, index) => Object.freeze({
      signalId: clean(record.signalId),
      scopeType: projection.scopeType,
      scopeId: projection.scopeId,
      content: String(record.content == null ? '' : record.content),
      reward: rewards[index].value
    })));
  }

  async function train(scopeKind, input = {}) {
    const globalRun = scopeKind === 'global';
    if (globalRun && typeof learningContract.projectGlobal !== 'function') {
      throw adapterError('AGENT_LIGHTNING_GLOBAL_ELIGIBILITY_REQUIRED', 'Canonical Learning global eligibility is required.');
    }

    const projection = globalRun
      ? await learningContract.projectGlobal(input.learningInput || {})
      : await learningContract.projectRelationship(input.learningInput || {});

    validateProjection(projection, globalRun ? 'global' : 'relationship', globalRun);
    const rewards = projectRewards(projection);
    const tasks = projectTasks(projection, rewards);

    const complete = async request => {
      const messages = Array.isArray(request?.messages) ? request.messages : [];
      const completionOptions = request?.options && typeof request.options === 'object' ? request.options : {};
      return modelExecutor.executeModel(input.model, messages, completionOptions);
    };

    const result = await runtimeInvoker(Object.freeze({
      schemaVersion: 1,
      workPackage: 'V21-DEEP-TRAINING-P1-AGENT-LIGHTNING-PRODUCT-V1',
      algorithm: 'APO',
      statusBoundary: 'CANDIDATE_ONLY',
      projection,
      rewards,
      tasks,
      datasetName: clean(input.datasetName),
      signalId: clean(input.signalId),
      complete
    }));

    if (!result || result.status !== 'CANDIDATE_ONLY' || !result.candidate || typeof result.candidate !== 'object') {
      throw adapterError('AGENT_LIGHTNING_CANDIDATE_ONLY_REQUIRED', 'Deep Training may return only CANDIDATE_ONLY output.');
    }

    const learningEvidence = await learningContract.bindExperimentEvidence({
      projection,
      signalId: clean(input.signalId),
      datasetName: clean(input.datasetName),
      candidate: result.candidate,
      trainingEvidence: result.evidence || null
    });

    return Object.freeze({
      status: 'CANDIDATE_ONLY',
      candidate: Object.freeze({ ...result.candidate }),
      evidence: Object.freeze({
        agentLightning: result.evidence || null,
        learning: learningEvidence || null
      })
    });
  }

  return Object.freeze({
    trainRelationship: input => train('relationship', input),
    trainGlobal: input => train('global', input),
    authority: 'Learning projection + Model Brain execution + Agent Lightning APO CANDIDATE_ONLY'
  });
}

module.exports = {
  createAgentLightningTrainingAdapter,
  createSealedAgentLightningRuntimeInvoker
};
