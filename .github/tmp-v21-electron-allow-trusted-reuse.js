'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const file = '.github/tmp-v21-electron-43-4-1-factory.js';
let text = fs.readFileSync(file, 'utf8');
const oldBlock = `const changedNewIdentities = changedPaths.filter(repositoryPath => {\n  if (!repositoryPath || !lock.packages?.[repositoryPath]) return false;\n  return !same(identity(beforeLock.packages?.[repositoryPath]), identity(lock.packages?.[repositoryPath]));\n});\nconst unsupportedNewIdentities = changedNewIdentities.filter(repositoryPath => !targetPaths.has(repositoryPath));\nassert.deepEqual(unsupportedNewIdentities, [], \`reviewed seven-package npm graph expanded: \${unsupportedNewIdentities.join(', ')}\`);`;
const newBlock = `const changedNewIdentities = changedPaths.filter(repositoryPath => {\n  if (!repositoryPath || !lock.packages?.[repositoryPath]) return false;\n  return !same(identity(beforeLock.packages?.[repositoryPath]), identity(lock.packages?.[repositoryPath]));\n});\nconst beforePolicy = readJson('governance/dependency-install-policy.json');\nconst trustedBeforeIdentities = new Set((beforePolicy.trustedCacheSeeds || []).map(seed => JSON.stringify({\n  version: seed.version ?? null,\n  resolved: seed.resolved ?? null,\n  integrity: seed.integrity ?? null\n})));\nconst unsupportedNewIdentities = changedNewIdentities.filter(repositoryPath => {\n  if (targetPaths.has(repositoryPath)) return false;\n  const nextIdentity = identity(lock.packages?.[repositoryPath]);\n  return !nextIdentity || !trustedBeforeIdentities.has(JSON.stringify(nextIdentity));\n});\nassert.deepEqual(unsupportedNewIdentities, [], \`Electron closure introduced an unreviewed and previously untrusted identity: \${unsupportedNewIdentities.join(', ')}\`);`;
assert.equal(text.split(oldBlock).length - 1, 1, 'factory guard patch target must be exact');
text = text.replace(oldBlock, newBlock);
fs.writeFileSync(file, text, 'utf8');
