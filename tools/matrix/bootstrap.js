'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const LOCK = require(path.join(ROOT, 'config/upstreams/v21-comms-p0.json'));
const ELEMENT_WORKSPACE_PATCH = path.join(ROOT, 'upstream-patches/element-web/0001-yance-global-right-workspace.patch');
const PRODUCT_DEPENDENCY_LOCK_PATCH = path.join(ROOT, 'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
const MODULE_DELIVERY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0012-yance-element-module-runtime.patch');
const RUNTIME = path.join(ROOT, 'services/matrix/.runtime');

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
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
  run(repoDir, 'git', ['apply', '--check', patchPath]);
  run(repoDir, 'git', ['apply', patchPath]);
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

  const moduleTarget = path.join(element, 'modules', 'yance');
  fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });

  // Product dependencies live in the copied workspace module. Apply the lock-only
  // replay patch only after the overlay exists so the frozen Element lock describes
  // the exact modules/yance importer that pnpm will install with --frozen-lockfile.
  applyPatch(element, PRODUCT_DEPENDENCY_LOCK_PATCH, 'Product Experience dependency lock patch');

  if (!fs.existsSync(MODULE_DELIVERY_PATCH)) throw new Error('Element module delivery patch missing');
  run(element, 'git', ['apply', '--check', MODULE_DELIVERY_PATCH]);
  run(element, 'git', ['apply', MODULE_DELIVERY_PATCH]);

  assertExactCommit(synapse, LOCK.upstreams.synapse.commit);
  assertExactCommit(mautrix, LOCK.upstreams.mautrixWhatsapp.commit);
  console.log('V2.1 Matrix/Element/mautrix exact-source runtime materialized.');
}

if (require.main === module) main();
module.exports = { assertExactCommit, main };
