'use strict';

function resolveSoftwareRenderingPolicy(options = {}) {
  const platform = String(options.platform || '');
  const packaged = options.packaged === true;
  const argv = Array.isArray(options.argv) ? options.argv.map(String) : [];
  const env = options.env && typeof options.env === 'object' ? options.env : {};

  if (env.YANCE_ENABLE_HARDWARE_ACCELERATION === '1') {
    return Object.freeze({ enabled: false, source: 'disabled' });
  }

  if (
    platform === 'win32' &&
    env.YANCE_SOURCE_UAT === '1' &&
    env.YANCE_DISABLE_GPU !== '0'
  ) {
    return Object.freeze({ enabled: true, source: 'source-uat-default' });
  }

  if (env.YANCE_DISABLE_GPU === '1') {
    return Object.freeze({ enabled: true, source: 'explicit' });
  }

  if (
    platform === 'win32' &&
    packaged &&
    argv.includes('--post-install') &&
    env.YANCE_DISABLE_GPU !== '0'
  ) {
    return Object.freeze({ enabled: true, source: 'packaged-post-install' });
  }

  return Object.freeze({ enabled: false, source: 'disabled' });
}

module.exports = { resolveSoftwareRenderingPolicy };