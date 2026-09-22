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
const POST_LOGIN_SECURITY_PATCH = path.join(ROOT, 'upstream-patches/element-web/0018-yance-post-login-security-shell.patch');
const MODULE_OPENID_TOKEN_PATCH = path.join(ROOT, 'upstream-patches/element-web/0019-yance-module-openid-token.patch');
const PRODUCT_LIVE_ROOM_PUBLIC_SEAMS_PATCH = path.join(ROOT, 'upstream-patches/element-web/0020-yance-product-live-room-public-seams.patch');
const RUNTIME = path.join(ROOT, 'services/matrix/.runtime');

function run(cwd, command, args) {
  const isStrictGitApply = command === 'git' && args[0] === 'apply';
  const isExactSourceMaterializationGit =
    command === 'git' && ['clone', 'fetch', 'checkout'].includes(args[0]);
  const env = { ...process.env };
  if (command === 'git') env.GIT_TERMINAL_PROMPT = '0';
  if (isStrictGitApply) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'core.autocrlf';
    env.GIT_CONFIG_VALUE_0 = 'true';
  } else if (isExactSourceMaterializationGit) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'core.autocrlf';
    env.GIT_CONFIG_VALUE_0 = 'false';
  }
  const options = { env };
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
  console.log(`Materializing ${name} at ${upstream.commit}.`);
  // Windows can retain a just-exited Git handle briefly. Retrying only that
  // filesystem removal preserves the clean exact-source materialization rule.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.mkdirSync(RUNTIME, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  run(dir, 'git', ['init']);
  run(dir, 'git', ['remote', 'add', 'origin', upstream.repository]);
  run(dir, 'git', ['-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=120', 'fetch', '--depth=1', '--no-tags', 'origin', upstream.commit]);
  run(dir, 'git', ['checkout', '--detach', 'FETCH_HEAD']);
  assertExactCommit(dir, upstream.commit);
  return dir;
}


function materializeExactReleaseTag(repoDir, upstream, label) {
  const version = String(upstream?.version || '');
  if (version.length === 0 || version.trim() !== version) {
    throw new Error(`${label}: exact upstream release version is required`);
  }

  const tagRef = `refs/tags/${version}`;
  run(repoDir, 'git', [
    'fetch',
    '--no-tags',
    '--depth=1',
    'origin',
    `${tagRef}:${tagRef}`
  ]);

  const peeledCommit = output(repoDir, 'git', ['rev-parse', `${tagRef}^{commit}`]);
  if (peeledCommit !== upstream.commit) {
    throw new Error(`${label}: release tag ${version} resolves to ${peeledCommit}, expected ${upstream.commit}`);
  }

  const describedVersion = output(repoDir, 'git', ['describe', '--abbrev=0', '--tags', upstream.commit]);
  if (describedVersion !== version) {
    throw new Error(`${label}: git describe returned ${describedVersion}, expected ${version}`);
  }

  return version;
}

function main() {
  const synapse = materialize('synapse', LOCK.upstreams.synapse);
  const element = materialize('element-web', LOCK.upstreams.elementWeb);
  materializeExactReleaseTag(element, LOCK.upstreams.elementWeb, 'Element');
  const mautrix = materialize('mautrix-whatsapp', LOCK.upstreams.mautrixWhatsapp);
  const mautrixTelegram = materialize('mautrix-telegram', LOCK.upstreams.mautrixTelegram);
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
  applyPatch(element, POST_LOGIN_SECURITY_PATCH, 'Element post-login security shell patch');
  applyPatch(element, MODULE_OPENID_TOKEN_PATCH, 'Element module OpenID token patch');
  applyPatch(element, PRODUCT_LIVE_ROOM_PUBLIC_SEAMS_PATCH, 'Element Product live-room public seams patch');

  assertExactCommit(synapse, LOCK.upstreams.synapse.commit);
  assertExactCommit(mautrix, LOCK.upstreams.mautrixWhatsapp.commit);
  assertExactCommit(mautrixTelegram, LOCK.upstreams.mautrixTelegram.commit);
  assertExactCommit(mautrixMeta, LOCK.externalRuntimes.mautrixMeta.commit);
  console.log('V2.1 Matrix/Element/mautrix exact-source runtimes materialized.');
}

if (require.main === module) main();
module.exports = { applyPatch, assertExactCommit, main, run, materializeExactReleaseTag };
