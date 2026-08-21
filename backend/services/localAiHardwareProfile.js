'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function normalizeGpu(gpu = {}) {
  return Object.freeze({
    name: String(gpu.name || gpu.model || '').trim(),
    vendor: String(gpu.vendor || '').trim(),
    vramBytes: finite(gpu.vramBytes || gpu.memoryBytes),
    driver: String(gpu.driver || '').trim()
  });
}

function normalizeHardwareProfile(input = {}) {
  return Object.freeze({
    platform: String(input.platform || process.platform).trim().toLowerCase(),
    arch: String(input.arch || process.arch).trim().toLowerCase(),
    cpuModel: String(input.cpuModel || '').trim(),
    cpuThreads: Math.max(1, Math.floor(finite(input.cpuThreads || input.logicalCores || os.cpus()?.length || 1))),
    memoryTotalBytes: finite(input.memoryTotalBytes || os.totalmem()),
    memoryFreeBytes: finite(input.memoryFreeBytes || os.freemem()),
    diskFreeBytes: finite(input.diskFreeBytes),
    diskPath: String(input.diskPath || '').trim(),
    gpus: Object.freeze((Array.isArray(input.gpus) ? input.gpus : []).map(normalizeGpu)),
    measuredAt: String(input.measuredAt || new Date().toISOString()),
    source: String(input.source || 'local-runtime-evidence')
  });
}

function diskEvidence(targetPath = process.cwd()) {
  if (typeof fs.statfsSync !== 'function') return { diskFreeBytes: 0, diskPath: path.resolve(targetPath) };
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    const stat = fs.statfsSync(current);
    return { diskFreeBytes: finite(stat.bsize || stat.frsize) * finite(stat.bavail ?? stat.bfree), diskPath: current };
  } catch (_) { return { diskFreeBytes: 0, diskPath: current }; }
}

function nvidiaSmiGpus() {
  try {
    const output = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true, timeout: 3500 });
    return output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
      const [name, memoryMb, driver] = line.split(',').map(value => value.trim());
      return normalizeGpu({ name, vendor: 'NVIDIA', vramBytes: finite(memoryMb) * 1024 * 1024, driver });
    });
  } catch (_) { return []; }
}

function windowsCimGpus() {
  if (process.platform !== 'win32') return [];
  try {
    const script = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress";
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(row => normalizeGpu({ name: row.Name, vramBytes: finite(row.AdapterRAM), driver: row.DriverVersion }));
  } catch (_) { return []; }
}

function collectGpuEvidence() {
  const nvidia = nvidiaSmiGpus();
  if (nvidia.length) return nvidia;
  if (process.platform === 'win32') return windowsCimGpus();
  return [];
}

function collectHardwareProfile(options = {}) {
  const cpus = os.cpus() || [];
  const disk = diskEvidence(options.diskPath || options.runtimeRoot || process.cwd());
  const extra = typeof options.collectExtra === 'function' ? options.collectExtra() || {} : {};
  return normalizeHardwareProfile({
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model || '',
    cpuThreads: cpus.length || 1,
    memoryTotalBytes: os.totalmem(),
    memoryFreeBytes: os.freemem(),
    ...disk,
    gpus: collectGpuEvidence(),
    ...extra,
    source: 'direct-local-hardware-probe'
  });
}

module.exports = { normalizeHardwareProfile, collectHardwareProfile, collectGpuEvidence, diskEvidence };