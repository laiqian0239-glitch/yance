'use strict';

const fs = require('node:fs');

const LETTA_PATH = 'node_modules/@letta-ai/letta-code';
const ROOT_SHARP_PATH = 'node_modules/sharp';
const NESTED_PREFIX = `${LETTA_PATH}/node_modules/`;
const NESTED_SHARP_PATH = `${NESTED_PREFIX}sharp`;

function requirePlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function planLettaSharpLockReconciliation(lock) {
  requirePlainObject(lock, 'package lock');
  if (lock.lockfileVersion !== 3) {
    throw new Error('lockfileVersion must be exactly 3');
  }

  const packages = requirePlainObject(lock.packages, 'package lock packages');
  const letta = requirePlainObject(packages[LETTA_PATH], 'Letta Code package entry');
  if (letta.version !== '0.30.5') {
    throw new Error('Letta Code must be exactly 0.30.5');
  }

  const lettaDependencies = requirePlainObject(letta.dependencies, 'Letta Code dependencies');
  if (lettaDependencies.sharp !== '^0.34.5') {
    throw new Error('Letta Code sharp declaration must be exactly ^0.34.5');
  }

  const rootSharp = requirePlainObject(packages[ROOT_SHARP_PATH], 'root sharp package entry');
  if (rootSharp.version !== '0.35.3') {
    throw new Error('root sharp must be exactly 0.35.3');
  }

  const nestedSharp = packages[NESTED_SHARP_PATH];
  if (!nestedSharp) {
    throw new Error('nested sharp 0.34.5 is absent or already reconciled');
  }
  requirePlainObject(nestedSharp, 'nested sharp package entry');
  if (nestedSharp.version !== '0.34.5') {
    throw new Error(`nested sharp must be exactly 0.34.5; found ${String(nestedSharp.version || 'unknown')}`);
  }

  const targets = [];
  for (const [repositoryPath, entry] of Object.entries(packages)) {
    if (!repositoryPath.startsWith(NESTED_PREFIX)) continue;
    const relative = repositoryPath.slice(NESTED_PREFIX.length);
    let expectedVersion = null;
    if (relative === 'sharp') expectedVersion = '0.34.5';
    else if (relative.startsWith('@img/sharp-libvips-')) expectedVersion = '1.2.4';
    else if (relative.startsWith('@img/sharp-')) expectedVersion = '0.34.5';
    if (expectedVersion === null) continue;

    requirePlainObject(entry, `${repositoryPath} package entry`);
    if (entry.version !== expectedVersion) {
      throw new Error(`${repositoryPath} has unexpected version ${String(entry.version || 'unknown')}; expected ${expectedVersion}`);
    }
    targets.push(repositoryPath);
  }

  if (!targets.includes(NESTED_SHARP_PATH)) {
    throw new Error('nested sharp reconciliation target is missing');
  }

  return Object.freeze({ deletePaths: Object.freeze(targets.sort()) });
}

function reconcileLettaSharpLockFile(lockPath) {
  if (typeof lockPath !== 'string' || !lockPath.trim()) {
    throw new Error('package-lock path must be a non-empty string');
  }

  const source = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(source);
  const plan = planLettaSharpLockReconciliation(lock);

  const next = JSON.parse(JSON.stringify(lock));
  for (const repositoryPath of plan.deletePaths) {
    delete next.packages[repositoryPath];
  }

  fs.writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return plan;
}

module.exports = {
  planLettaSharpLockReconciliation,
  reconcileLettaSharpLockFile
};
