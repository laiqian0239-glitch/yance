'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const LOCK = require(path.join(ROOT, 'config/upstreams/v21-comms-p0.json'));
const ELEMENT_WORKSPACE_PATCH = path.join(ROOT, 'upstream-patches/element-web/0001-yance-global-right-workspace.patch');
const ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0002-yance-package-manager-authority.patch');
const ELEMENT_NX_CRLF_LOCKFILE_PATCH = path.join(ROOT, 'upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch');
const MODULE_DELIVERY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0012-yance-element-module-runtime.patch');
const RUNTIME = path.join(ROOT, 'services/matrix/.runtime');

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
}

function output(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function assertExactCommit(repoDir, expected) {
  const actual = output(repoDir, 'git', ['rev-parse', 'HEAD']);
  if (actual !== expected) throw new Error(`pin drift: expected ${expected}, got ${actual}`);
}

function applyPatch(repoDir, patchPath, label) {
  if (!fs.existsSync(patchPath)) throw new Error(`${label} missing: ${path.relative(ROOT, patchPath)}`);
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'true'
  };
  run(repoDir, 'git', ['apply', '--check', patchPath], { env });
  run(repoDir, 'git', ['apply', patchPath], { env });
}

function materialize(name, upstream) {
  if (!/^[a-f0-9]{40}$/u.test(upstream.commit)) throw new Error(`${name}: mutable or short commit rejected`);
  const dir = path.join(RUNTIME, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME, { recursive: true });
  run(RUNTIME, 'git', ['clone', '--no-checkout', upstream.repository, name]);
  run(dir, 'git', ['fetch', 'origin', upstream.commit, '--depth=1']);
  run(dir, 'git', ['checkout', '--detach', upstream.commit]);
  assertExactCommit(dir, upstream.commit);
  return dir;
}

function main() {
  const synapse = materialize('synapse', LOCK.upstreams.synapse);
  const element = materialize('element-web', LOCK.upstreams.elementWeb);
  const mautrix = materialize('mautrix-whatsapp', LOCK.upstreams.mautrixWhatsapp);

  applyPatch(element, ELEMENT_WORKSPACE_PATCH, 'Element workspace patch');
  applyPatch(element, ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH, 'Element package-manager authority patch');
  applyPatch(element, ELEMENT_NX_CRLF_LOCKFILE_PATCH, 'Element Nx CRLF lockfile patch');

  const moduleTarget = path.join(element, 'modules', 'yance');
  fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });

  applyPatch(element, MODULE_DELIVERY_PATCH, 'Element module delivery patch');

  assertExactCommit(synapse, LOCK.upstreams.synapse.commit);
  assertExactCommit(mautrix, LOCK.upstreams.mautrixWhatsapp.commit);
  console.log('V2.1 Matrix/Element/mautrix exact-source runtime materialized.');
}

if (require.main === module) main();
module.exports = { applyPatch, assertExactCommit, main };
