'use strict';

const { ACCOUNT_STATES } = require('../../shared/constants');

const STATE_LABELS = Object.freeze({
  'unconfigured': '未配置',
  'waiting-verification': '等待验证',
  'connecting': '正在连接',
  'connected': '已连接',
  'limited': '部分能力受限',
  'credential-expiring': '凭据即将过期',
  'reauthorize': '需要重新授权',
  'error': '连接异常',
  'paused': '已暂停',
  'logged-out': '已退出'
});

function normalizeAccountState(value) {
  const state = String(value || '').toLowerCase();
  return ACCOUNT_STATES.includes(state) ? state : 'error';
}

function stateLabel(value) {
  return STATE_LABELS[normalizeAccountState(value)] || '连接异常';
}

function healthFromState(value) {
  const state = normalizeAccountState(value);
  if (state === 'connected') return 'healthy';
  if (state === 'limited' || state === 'credential-expiring') return 'usable';
  if (state === 'connecting' || state === 'waiting-verification' || state === 'paused') return 'attention';
  if (state === 'unconfigured') return 'unconfigured';
  return 'failed';
}

module.exports = { STATE_LABELS, normalizeAccountState, stateLabel, healthFromState };
