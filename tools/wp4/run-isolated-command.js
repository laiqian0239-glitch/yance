#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');

function parsePayload() {
  const raw = process.env.WP4_ISOLATED_COMMAND || '';
  if (!raw) throw new Error('WP4_ISOLATED_COMMAND is required');
  const payload = JSON.parse(raw);
  if (!payload || typeof payload.command !== 'string' || !Array.isArray(payload.args)) throw new TypeError('Invalid isolated command payload');
  return payload;
}

function terminateTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    childProcess.spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch (_) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
}


function descendantPids(rootPid) {
  if (process.platform === 'win32' || !Number.isInteger(rootPid) || rootPid <= 0) return [];
  const result = childProcess.spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  const children = new Map();
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const queue = [rootPid];
  const seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    for (const pid of children.get(parent) || []) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      found.push(pid);
      queue.push(pid);
    }
  }
  return found;
}

function terminateTracked(pids) {
  const ordered = [...pids].filter(pid => Number.isInteger(pid) && pid > 0).sort((a, b) => b - a);
  for (const pid of ordered) {
    if (process.platform === 'win32') childProcess.spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    else try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
}

function appendTail(current, chunk, limit) {
  const next = `${current}${String(chunk || '')}`;
  return next.length > limit ? next.slice(-limit) : next;
}

async function main() {
  const payload = parsePayload();
  const timeoutMs = Math.max(1, Number(payload.timeoutMs || 300000));
  const maxOutputBytes = Math.max(4096, Number(payload.maxOutputBytes || 30 * 1024 * 1024));
  const child = childProcess.spawn(payload.command, payload.args, {
    cwd: payload.cwd,
    env: { ...process.env, ...(payload.env || {}) },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError = null;
  const trackedPids = new Set();
  const tracker = setInterval(() => {
    for (const pid of descendantPids(child.pid)) trackedPids.add(pid);
  }, 50);
  tracker.unref();
  child.stdout?.on('data', chunk => { stdout = appendTail(stdout, chunk, maxOutputBytes); });
  child.stderr?.on('data', chunk => { stderr = appendTail(stderr, chunk, maxOutputBytes); });
  child.on('error', error => { spawnError = error; });

  const outcome = await new Promise(resolve => {
    let settled = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(tracker);
      for (const pid of descendantPids(child.pid)) trackedPids.add(pid);
      terminateTree(child.pid);
      terminateTracked(trackedPids);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code, signal: signal || '' });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      for (const pid of descendantPids(child.pid)) trackedPids.add(pid);
      terminateTree(child.pid);
      terminateTracked(trackedPids);
      setTimeout(() => finish(null, 'SIGKILL'), 250).unref();
    }, timeoutMs);
    child.once('exit', finish);
  });

  process.stdout.write(`${JSON.stringify({
    exitCode: Number.isInteger(outcome.code) ? outcome.code : null,
    signal: outcome.signal,
    timedOut,
    spawnError: spawnError ? { code: spawnError.code || '', message: spawnError.message } : null,
    stdout,
    stderr
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
