'use strict';
const fs = require('node:fs');

const before = JSON.parse(fs.readFileSync('/tmp/package-lock.before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function parentPackagePath(packagePath) {
  const parts = packagePath.split('/');
  let index = -1;
  for (let i = 0; i < parts.length; i += 1) if (parts[i] === 'node_modules') index = i;
  return index <= 0 ? '' : parts.slice(0, index).join('/');
}
function resolveDependency(packages, fromPath, dependencyName) {
  let base = parentPackagePath(fromPath);
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    base = parentPackagePath(base);
  }
}
function closure(lock, startPath) {
  const packages = lock.packages || {};
  const seen = new Set();
  const queue = [startPath];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current) || !packages[current]) continue;
    seen.add(current);
    const entry = packages[current];
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = entry[field];
      if (!dependencies || typeof dependencies !== 'object') continue;
      for (const name of Object.keys(dependencies)) {
        const resolved = resolveDependency(packages, current, name);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
  }
  return seen;
}

const allowed = new Set(['', ...closure(before, 'node_modules/electron'), ...closure(after, 'node_modules/electron')]);
const keys = new Set([...Object.keys(before.packages || {}), ...Object.keys(after.packages || {})]);
const outside = [...keys].filter(key => !allowed.has(key) && !same(before.packages?.[key], after.packages?.[key]));
for (const key of outside) {
  if (Object.prototype.hasOwnProperty.call(before.packages || {}, key)) after.packages[key] = before.packages[key];
  else delete after.packages[key];
}
fs.writeFileSync('package-lock.json', `${JSON.stringify(after, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ restoredOutsideElectronClosurePaths: outside }, null, 2));
