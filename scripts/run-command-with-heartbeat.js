#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  const options = {};
  for (let index = 0; index < optionArgs.length; index += 2) {
    const key = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error(`Invalid option near ${key || '<end>'}`);
    options[key.slice(2)] = value;
  }
  return { options, commandArgs };
}

function timestamp() {
  return new Date().toISOString();
}

function run(argv = process.argv.slice(2)) {
  const { options, commandArgs } = parseArguments(argv);
  const name = String(options.name || '').trim();
  const logPath = path.resolve(String(options.log || ''));
  const workingDirectory = path.resolve(String(options.cwd || ''));
  const file = String(options.file || '').trim();
  const heartbeatMs = Math.max(25, Number(options['heartbeat-ms'] || 15000));
  if (!name || !options.log || !options.cwd || !file || !Number.isFinite(heartbeatMs)) {
    throw new Error('Required options: --name, --log, --cwd, --file');
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const descriptor = fs.openSync(logPath, 'w');
  let lastOutput = 'waiting for command output';
  let tail = '';
  let closed = false;

  function observe(chunk) {
    tail = `${tail}${chunk.toString('utf8')}`.slice(-4096);
    const lines = tail.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    if (lines.length) lastOutput = lines.at(-1).slice(0, 180);
  }

  function forward(chunk, destination) {
    if (!chunk?.length) return;
    fs.writeSync(descriptor, chunk);
    observe(chunk);
    destination.write(chunk);
  }

  process.stderr.write(`[${timestamp()}] RUNNING STAGE: ${name}\n`);
  process.stderr.write(`[${timestamp()}] LOG: ${logPath}\n`);

  const child = spawn(file, commandArgs, {
    cwd: workingDirectory,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => forward(chunk, process.stdout));
  child.stderr.on('data', chunk => forward(chunk, process.stderr));

  const heartbeat = setInterval(() => {
    process.stderr.write(`[${timestamp()}] HEARTBEAT ${name}: pid=${child.pid || 'starting'}; last=${lastOutput}; log=${logPath}\n`);
  }, heartbeatMs);

  function finish(code, signal) {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    fs.closeSync(descriptor);
    process.stderr.write(`[${timestamp()}] FINISHED STAGE: ${name}; exit=${code ?? 'null'}; signal=${signal || 'none'}\n`);
    process.exitCode = code === 0 && signal == null ? 0 : (Number.isInteger(code) ? code : 1);
  }

  child.once('error', error => {
    process.stderr.write(`[${timestamp()}] COMMAND START FAILED ${name}: ${error.stack || error.message}\n`);
    finish(1, null);
  });
  child.once('close', finish);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      try { child.kill(signal); } catch (_) {}
    });
  }
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, run };
