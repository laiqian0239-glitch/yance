'use strict';
const { readStartupFrame } = require('../../../backend/bootstrap/desktopStartupPipe');
const mode = String(process.env.WP2_CHILD_MODE || 'normal');
readStartupFrame().then(frame => {
  if (process.send) process.send({ type: 'lifecycle-ready', pid: process.pid, startupNonce: frame.startupNonce });
  process.on('SIGTERM', () => {
    if (mode === 'ignore-term') return;
    process.exit(0);
  });
  setInterval(() => {}, 1000);
}).catch(error => {
  if (process.send) process.send({ type: 'probe:error', reasonCode: error.reasonCode || error.code || 'UNKNOWN' });
  process.exit(1);
});
