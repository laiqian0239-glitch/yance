'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { fs.renameSync(tempPath, filePath); }
  catch (error) {
    if (!fs.existsSync(filePath)) throw error;
    fs.rmSync(filePath, { force: true, maxRetries: 10, retryDelay: 50 });
    fs.renameSync(tempPath, filePath);
  }
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }, 2000).unref();
}

function cappedCollector(limitBytes) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  return {
    push(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (bytes >= limitBytes) { truncated = true; return; }
      const accepted = value.subarray(0, Math.max(0, limitBytes - bytes));
      chunks.push(accepted);
      bytes += accepted.length;
      if (accepted.length < value.length) truncated = true;
    },
    text() {
      const value = Buffer.concat(chunks).toString('utf8');
      return truncated ? `${value}\n[output truncated by Yance command supervisor]\n` : value;
    }
  };
}

function runSupervisedCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAtUtc = new Date().toISOString();
    const startedMs = Date.now();
    const timeoutMs = options.timeoutMs || 900000;
    const heartbeatIntervalMs = options.heartbeatIntervalMs || 30000;
    const stdout = cappedCollector(options.maxBuffer || 96 * 1024 * 1024);
    const stderr = cappedCollector(options.maxBuffer || 96 * 1024 * 1024);
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    let lastActivityAtUtc = startedAtUtc;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let forcedTerminationTimer = null;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: options.shell === true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const heartbeat = (phase) => {
      const row = {
        schemaVersion: 1,
        documentType: 'YANCE_WP7_VERIFY_HEARTBEAT',
        step: options.name || '',
        phase,
        pid: child.pid || null,
        startedAtUtc,
        timestampUtc: new Date().toISOString(),
        elapsedMs: Date.now() - startedMs,
        timeoutMs,
        lastActivityAtUtc,
        stdoutBytes,
        stderrBytes
      };
      if (options.heartbeatPath) atomicWriteJson(options.heartbeatPath, row);
      if (options.timelinePath) appendJsonLine(options.timelinePath, row);
    };

    child.stdout?.on('data', (chunk) => {
      stdout.push(chunk);
      stdoutBytes += chunk.length;
      lastActivityAtUtc = new Date().toISOString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr.push(chunk);
      stderrBytes += chunk.length;
      lastActivityAtUtc = new Date().toISOString();
    });
    child.once('error', (error) => { spawnError = error; });

    heartbeat('STARTED');
    const heartbeatTimer = setInterval(() => heartbeat('RUNNING'), heartbeatIntervalMs);
    heartbeatTimer.unref();
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      heartbeat('TIMEOUT_TERMINATION_REQUESTED');
      terminateProcessTree(child);
      // taskkill can terminate the process tree while the direct child pipe
      // remains open. Do not leave the supervisor pending forever waiting for
      // a close event that will never arrive.
      forcedTerminationTimer = setTimeout(() => finish(null, 'SIGKILL'), 10000);
    }, timeoutMs);
    timeoutTimer.unref();

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
      heartbeat(timedOut ? 'TIMED_OUT' : 'FINISHED');
      resolve({
        status: Number.isInteger(code) ? code : null,
        signal: signal || null,
        error: timedOut ? Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }) : spawnError,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut
      });
    };
    child.once('close', finish);
  });
}

module.exports = { atomicWriteJson, appendJsonLine, runSupervisedCommand, terminateProcessTree };
