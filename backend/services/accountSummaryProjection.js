'use strict';

function buildAccountSummary(accounts = []) {
  const pendingAuthorization = accounts.filter(row => row.authorizationPending === true || row.lifecycleState === 'pending-auth');
  const activeAccounts = accounts.filter(row => !pendingAuthorization.includes(row));
  const connected = activeAccounts.filter(row => row.state === 'connected' && row.credentialReady === true);
  const limited = activeAccounts.filter(row => row.state === 'limited');
  const abnormal = activeAccounts.filter(row => ['error', 'reauthorize', 'credential-expiring'].includes(row.state));
  return {
    total: activeAccounts.length,
    pendingAuthorization: pendingAuthorization.length,
    connected: connected.length,
    limited: limited.length,
    abnormal: abnormal.length,
    paused: activeAccounts.filter(row => row.state === 'paused').length,
    unread: activeAccounts.reduce((sum, row) => sum + Number(row.unread || 0), 0),
    platforms: ['whatsapp', 'telegram', 'facebook'].map(platform => ({
      platform,
      total: activeAccounts.filter(row => row.platform === platform).length,
      pendingAuthorization: pendingAuthorization.filter(row => row.platform === platform).length,
      connected: connected.filter(row => row.platform === platform).length,
      limited: limited.filter(row => row.platform === platform).length,
      abnormal: abnormal.filter(row => row.platform === platform).length
    })),
    lastSyncAt: activeAccounts.map(row => row.lastSyncAt).filter(Boolean).sort().at(-1) || ''
  };
}

module.exports = { buildAccountSummary };
