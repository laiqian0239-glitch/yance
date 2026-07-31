'use strict';
const { bootDesktopHostedBackend } = require('../../../backend/desktopHostedEntry');
bootDesktopHostedBackend({ serverEntry: require.resolve('./api-auth-server') }).catch(error => {
  if (process.send) process.send({ type: 'probe:error', reasonCode: error.reasonCode || error.code || 'UNKNOWN' });
  process.exit(1);
});
