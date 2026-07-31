'use strict';

const fs = require('node:fs');
const path = require('node:path');
const releaseSource = require('../release/release-source.json');

function clean(value) { return value == null ? '' : String(value).trim(); }
function normalizeBaseUrl(value) {
  const raw = clean(value).replace(/\/$/, '');
  if (!raw) return '';
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.protocol === 'http:')) {
    throw Object.assign(new Error('更新源必须使用 HTTPS'), { code: 'UPDATE_HTTPS_REQUIRED' });
  }
  return url.toString().replace(/\/$/, '');
}

function readJsonFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch (_) { return {}; }
}
function githubUpdateConfig({ env = process.env, isPackaged = false, source = releaseSource } = {}) {
  // Explicit test-harness mode exercises updater verification with an injected
  // updater object. It does not enable a real network service or public channel.
  if (env.YANCE_INTERNAL_UPDATE_TEST === '1' || env.YANCE_UPDATE_TEST_TRANSPORT === '1') {
    return {
      configured: true,
      provider: 'github',
      owner: 'internal-test',
      repo: 'yance-local-fixture',
      channel: 'latest',
      allowPrerelease: false,
      source: 'internal-test-fixture',
      token: null
    };
  }

  // Internal-test builds intentionally use manual installer updates. This keeps
  // the product fully local and avoids requiring a server, paid infrastructure,
  // publishing credentials, or a production release repository.
  if (source.onlineUpdatesEnabled !== true) {
    return {
      configured: false,
      provider: 'github',
      owner: '',
      repo: '',
      channel: clean(env.YANCE_UPDATE_CHANNEL || 'latest'),
      allowPrerelease: false,
      source: 'internal-test-manual-installer',
      mode: source.updateMode || 'MANUAL_INSTALLER_ONLY',
      token: null
    };
  }

  // A future explicitly-authorized online release may opt in. Packaged builds
  // use source-controlled values; development builds may override only after an
  // explicit enable flag. No token is read by the desktop client.
  const owner = clean(isPackaged ? source.updateGithubOwner : env.YANCE_UPDATE_GITHUB_OWNER);
  const repo = clean(isPackaged ? source.updateGithubRepo : env.YANCE_UPDATE_GITHUB_REPO);
  const channel = clean((isPackaged ? source.updateChannel : env.YANCE_UPDATE_CHANNEL) || 'latest');
  const explicitlyEnabled = isPackaged || env.YANCE_ENABLE_GITHUB_UPDATES === '1';
  if (!explicitlyEnabled || !owner || !repo) {
    return { configured: false, provider: 'github', owner: '', repo: '', channel, allowPrerelease: false, source: 'github-unconfigured', token: null };
  }
  return {
    configured: true,
    provider: 'github',
    owner,
    repo,
    channel,
    allowPrerelease: channel === 'beta' || channel === 'alpha',
    source: isPackaged ? 'github-packaged-fixed' : 'github-env-override',
    token: null
  };
}

function runtimeUpdateConfig({ isPackaged = false, resourcesPath = '', appPath = '', env = process.env } = {}) {
  const envUrl = clean(env.YANCE_UPDATE_BASE_URL);
  const envChannel = clean(env.YANCE_UPDATE_CHANNEL || 'latest');
  if (envUrl) return { configured: true, url: normalizeBaseUrl(envUrl), channel: envChannel, source: 'environment' };
  const file = isPackaged
    ? path.join(resourcesPath, 'update-config.json')
    : path.join(appPath || process.cwd(), 'build', 'runtime-update-config.json');
  const stored = readJsonFile(file);
  const url = clean(stored.url);
  const configured = stored.configured === true && Boolean(url);
  return {
    configured,
    url: configured ? normalizeBaseUrl(url) : '',
    channel: clean(stored.channel || 'latest'),
    source: configured ? 'packaged-config' : 'unconfigured',
    file
  };
}

function releaseNotes(value) {
  if (Array.isArray(value)) return value.map(item => clean(item?.note || item)).filter(Boolean).join('\n');
  return clean(value);
}

module.exports = { clean, normalizeBaseUrl, releaseNotes, runtimeUpdateConfig, githubUpdateConfig, readJsonFile };
