'use strict';

const CAPABILITY_CLASSES = Object.freeze(['interactive', 'usable', 'background', 'extreme', 'incompatible']);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function chooseExecutionMode(hardware = {}, runtime = {}) {
  const hasGpu = Array.isArray(hardware.gpus) && hardware.gpus.some(gpu => num(gpu?.vramBytes) > 0 || String(gpu?.name || '').trim());
  if (runtime.supportsLayerStreaming === true) return 'layer-streaming';
  if (runtime.supportsCpuGpuHybrid === true && hasGpu) return 'cpu-gpu-hybrid';
  if (hasGpu && runtime.supportsGpu !== false) return 'gpu';
  return 'cpu';
}

function classifyCandidate(input = {}) {
  const hardware = input.hardware || {};
  const runtime = input.runtime || {};
  const model = input.model || {};
  const benchmark = input.benchmark || {};
  const measured = benchmark.measured === true;
  const residentRamBytes = num(benchmark.residentRamBytes || model.quantizedBytes);
  const memoryFreeBytes = num(hardware.memoryFreeBytes);
  const memoryTotalBytes = num(hardware.memoryTotalBytes);
  const tokensPerSecond = num(benchmark.tokensPerSecond);
  const firstTokenMs = num(benchmark.firstTokenMs);
  const executionMode = chooseExecutionMode(hardware, runtime);

  const memoryCeiling = memoryFreeBytes || memoryTotalBytes;
  const memoryCompatible = !residentRamBytes || !memoryCeiling || residentRamBytes <= memoryCeiling;
  let capabilityClass = 'background';

  if (!memoryCompatible) capabilityClass = 'incompatible';
  else if (measured) {
    if (tokensPerSecond >= 12 && (!firstTokenMs || firstTokenMs <= 3000)) capabilityClass = 'interactive';
    else if (tokensPerSecond >= 4 && (!firstTokenMs || firstTokenMs <= 8000)) capabilityClass = 'usable';
    else if (tokensPerSecond >= 1) capabilityClass = 'background';
    else if (tokensPerSecond > 0 && (runtime.supportsLayerStreaming === true || String(runtime.id || '').toLowerCase() === 'airllm')) capabilityClass = 'extreme';
    else if (tokensPerSecond > 0) capabilityClass = 'background';
    else capabilityClass = 'incompatible';
  } else if (runtime.supportsLayerStreaming === true) capabilityClass = 'extreme';

  return Object.freeze({
    capabilityClass,
    executionMode,
    blockedByVramOnly: false,
    evidence: Object.freeze({
      measured,
      tokensPerSecond,
      firstTokenMs,
      residentRamBytes,
      memoryFreeBytes,
      memoryTotalBytes,
      cpuThreads: num(hardware.cpuThreads),
      gpuVramBytes: (Array.isArray(hardware.gpus) ? hardware.gpus : []).reduce((sum, gpu) => sum + num(gpu?.vramBytes), 0),
      upstreamCommit: String(runtime.provenance?.upstreamCommit || '')
    }),
    runtimeId: String(runtime.id || ''),
    modelId: String(model.id || ''),
    parameterCountB: num(model.parameterCountB),
    reason: capabilityClass === 'incompatible' ? 'insufficient-measured-memory-or-throughput' : 'evidence-based-local-runtime-fit'
  });
}

function rankCandidates(candidates = []) {
  const score = { interactive: 5, usable: 4, background: 3, extreme: 2, incompatible: 0 };
  return candidates.map(classifyCandidate).sort((a, b) => (score[b.capabilityClass] - score[a.capabilityClass]) || (b.evidence.tokensPerSecond - a.evidence.tokensPerSecond));
}

module.exports = { CAPABILITY_CLASSES, classifyCandidate, rankCandidates, chooseExecutionMode };