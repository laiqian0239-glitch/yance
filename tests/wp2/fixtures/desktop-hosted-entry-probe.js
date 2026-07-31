'use strict';
const { bootDesktopHostedBackend } = require('../../../backend/desktopHostedEntry');
bootDesktopHostedBackend({ serverEntry: require.resolve('./server-identity-probe') }).catch(error => {
  if (process.send) process.send({ type: 'probe:error', reasonCode: error.reasonCode || error.code || 'UNKNOWN', message: error.message });
  process.exit(1);
});
