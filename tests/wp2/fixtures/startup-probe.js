'use strict';
const { readStartupFrame } = require('../../../backend/bootstrap/desktopStartupPipe');

function sendAndExit(message, successCode = 0) {
  if (!process.send) process.exit(successCode);
  process.send(message, error => process.exit(error ? 1 : successCode));
}

readStartupFrame().then(frame => {
  sendAndExit({
    type: 'probe:startup-frame',
    pidMatches: frame.backendPid === process.pid,
    tokenReceived: typeof frame.apiSessionToken === 'string' && frame.apiSessionToken.length >= 43,
    startupNonce: frame.startupNonce,
    buildId: frame.expectedBuildId,
    manifestSha256: frame.manifestSha256
  });
}).catch(error => {
  sendAndExit({ type: 'probe:error', reasonCode: error.reasonCode || error.code || 'UNKNOWN' }, 1);
});
