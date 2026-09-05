'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const LOCK = require(path.join(ROOT, 'config/upstreams/v21-comms-p0.json'));
const ELEMENT_WORKSPACE_PATCH = path.join(ROOT, 'upstream-patches/element-web/0001-yance-global-right-workspace.patch');
const ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0002-yance-package-manager-authority.patch');
const ELEMENT_NX_CRLF_LOCKFILE_PATCH = path.join(ROOT, 'upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch');
const PRODUCT_DEPENDENCY_LOCK_PATCH = path.join(ROOT, 'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
const PRODUCT_CSS_SHEET_LOCK_PATCH = path.join(ROOT, 'upstream-patches/element-web/0011a-yance-css-sheet-plugin-lock.patch');
const MODULE_DELIVERY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0012-yance-element-module-runtime.patch');
const ROOM_STATE_READ_PATCH = path.join(ROOT, 'upstream-patches/element-web/0013-yance-module-room-state-read.patch');
const APPEARANCE_AUTHORITY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0014-yance-module-appearance-authority.patch');
const LOCATION_NAVIGATION_PATCH = path.join(ROOT, 'upstream-patches/element-web/0015-yance-module-location-navigation.patch');
const COMPOSER_ACCESSORY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0016-yance-composer-accessory-slot.patch');
const PRODUCT_CONVERSATION_CONTROL_PATCH = path.join(ROOT, 'upstream-patches/element-web/0017-yance-product-conversation-control.patch');
const RUNTIME = path.join(ROOT, 'services/matrix/.runtime');

function run(cwd, command, args) {
  const isStrictGitApply = command === 'git' && args[0] === 'apply';
  const options = isStrictGitApply
    ? {
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.autocrlf',
          GIT_CONFIG_VALUE_0: 'true'
        }
      }
    : {};
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
  const mautrixMeta = materialize('mautrix-meta', LOCK.externalRuntimes.mautrixMeta);

  applyPatch(element, ELEMENT_WORKSPACE_PATCH, 'Element workspace patch');
  applyPatch(element, ELEMENT_PACKAGE_MANAGER_AUTHORITY_PATCH, 'Element package-manager authority patch');
  applyPatch(element, ELEMENT_NX_CRLF_LOCKFILE_PATCH, 'Element Nx CRLF lockfile patch');

  const moduleTarget = path.join(element, 'modules', 'yance');
  fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });
  const assistantUiToolUiSource = path.join(ROOT, 'vendor/assistant-ui-tool-ui/v2026.2.13');
  const assistantUiToolUiTarget = path.join(element, 'vendor/assistant-ui-tool-ui/v2026.2.13');
  fs.cpSync(assistantUiToolUiSource, assistantUiToolUiTarget, { recursive: true });

  // Product dependencies live in the copied workspace module. Apply the base lock
  // replay after the overlay exists, then apply the tiny successor replay so the
  // effective modules/yance importer stays exact without regenerating 0011.
  applyPatch(element, PRODUCT_DEPENDENCY_LOCK_PATCH, 'Product Experience dependency lock patch');
  applyPatch(element, PRODUCT_CSS_SHEET_LOCK_PATCH, 'Product CSS sheet dependency lock patch');

  if (!fs.existsSync(MODULE_DELIVERY_PATCH)) throw new Error('Element module delivery patch missing');
  run(element, 'git', ['apply', '--check', MODULE_DELIVERY_PATCH]);
  run(element, 'git', ['apply', MODULE_DELIVERY_PATCH]);
  if (!fs.existsSync(ROOM_STATE_READ_PATCH)) throw new Error('Element module room-state read patch missing');
  run(element, 'git', ['apply', '--check', ROOM_STATE_READ_PATCH]);
  run(element, 'git', ['apply', ROOM_STATE_READ_PATCH]);
  applyPatch(element, APPEARANCE_AUTHORITY_PATCH, 'Element appearance authority patch');
  applyPatch(element, LOCATION_NAVIGATION_PATCH, 'Element location navigation patch');
  applyPatch(element, COMPOSER_ACCESSORY_PATCH, 'Element composer accessory patch');
  applyPatch(element, PRODUCT_CONVERSATION_CONTROL_PATCH, 'Element Product conversation control patch');

  assertExactCommit(synapse, LOCK.upstreams.synapse.commit);
  assertExactCommit(mautrix, LOCK.upstreams.mautrixWhatsapp.commit);
  assertExactCommit(mautrixMeta, LOCK.externalRuntimes.mautrixMeta.commit);
  console.log('V2.1 Matrix/Element/mautrix exact-source runtimes materialized.');
}

if (require.main === module) main();
module.exports = { applyPatch, assertExactCommit, main };
