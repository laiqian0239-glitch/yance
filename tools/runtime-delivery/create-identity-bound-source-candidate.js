'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  createIdentityBoundSourceArchive,
  sha256File,
} = require('./identity-bound-source-archive');

function git(repoRoot, args) {
  return String(execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })).trim();
}

function resolveRepositoryIdentity(repoRoot) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']);
  const lineage = git(repoRoot, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/u);
  const branch = git(repoRoot, ['branch', '--show-current']);
  if (!branch) throw new Error('working tree must be on a named branch');
  return {
    branch,
    commit,
    tree: git(repoRoot, ['rev-parse', 'HEAD^{tree}']),
    parent: lineage[1] || null,
  };
}

function createSourceCandidate(options) {
  if (!options || typeof options !== 'object') throw new TypeError('source candidate options are required');
  const repoRoot = path.resolve(options.repoRoot || '.');
  const outputPath = path.resolve(options.outputPath || 'Yance_Source_Candidate.zip');
  if (git(repoRoot, ['status', '--porcelain'])) throw new Error('working tree must be clean');
  const identity = resolveRepositoryIdentity(repoRoot);
  const artifact = {
    artifactType: options.artifactType || 'WINDOWS_UI_SOURCE_CANDIDATE',
    artifactClass: options.artifactClass,
    artifactId: options.artifactId,
    formalRelease: options.formalRelease === true,
    readyForPromotion: options.readyForPromotion === true,
    windowsUiUat: options.windowsUiUat === true,
  };
  const archive = createIdentityBoundSourceArchive({ repoRoot, outputPath, identity, artifact });
  return {
    outputPath,
    sha256: sha256File(outputPath),
    identity,
    artifact,
    verification: archive.verification,
  };
}

if (require.main === module) {
  try {
    const [repoArg, outputArg, artifactClass, artifactId, artifactType] = process.argv.slice(2);
    if (!outputArg || !artifactClass || !artifactId) {
      throw new Error('usage: node create-identity-bound-source-candidate.js <repoRoot> <outputZip> <artifactClass> <artifactId> [artifactType]');
    }
    const result = createSourceCandidate({
      repoRoot: repoArg || '.',
      outputPath: outputArg,
      artifactType: artifactType || 'WINDOWS_UI_SOURCE_CANDIDATE',
      artifactClass,
      artifactId,
      formalRelease: false,
      readyForPromotion: false,
      windowsUiUat: false,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  createSourceCandidate,
  resolveRepositoryIdentity,
};
