'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSoftwareRenderingPolicy } = require('../../electron/gpuSoftwareRenderingPolicy');

test('packaged Windows post-install defaults to software rendering', () => {
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'win32',
    packaged: true,
    argv: ['Yance.exe', '--post-install'],
    env: {}
  }), { enabled: true, source: 'packaged-post-install' });
});

test('ordinary packaged launch keeps hardware acceleration unchanged', () => {
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'win32',
    packaged: true,
    argv: ['Yance.exe'],
    env: {}
  }), { enabled: false, source: 'disabled' });
});

test('explicit hardware and GPU environment controls remain authoritative', () => {
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'win32',
    packaged: true,
    argv: ['Yance.exe', '--post-install'],
    env: { YANCE_ENABLE_HARDWARE_ACCELERATION: '1' }
  }), { enabled: false, source: 'disabled' });
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'win32',
    packaged: true,
    argv: ['Yance.exe', '--post-install'],
    env: { YANCE_DISABLE_GPU: '0' }
  }), { enabled: false, source: 'disabled' });
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'linux',
    packaged: true,
    argv: ['Yance'],
    env: { YANCE_DISABLE_GPU: '1' }
  }), { enabled: true, source: 'explicit' });
});

test('Windows source UAT keeps its existing software rendering default', () => {
  assert.deepEqual(resolveSoftwareRenderingPolicy({
    platform: 'win32',
    packaged: false,
    argv: [],
    env: { YANCE_SOURCE_UAT: '1' }
  }), { enabled: true, source: 'source-uat-default' });
});
