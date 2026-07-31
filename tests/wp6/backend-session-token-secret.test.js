'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');

test('BackendProcessHost public API session binding never exposes token', () => {
  const host = Object.create(BackendProcessHost.prototype);
  host.session = { backendPid: 11, startupNonce:'n', backendSessionId:'s', fd6PipeInstanceId:'f', apiSessionToken:'secret-token', ownerContext:{ownerSessionId:'o'} };
  host.rejectedOwner = null; host.ownerRegistryFailure = null;
  host.snapshot = () => ({ running:true, apiSessionEstablished:true, backendPid:11, ownerTrusted:true });
  const publicBinding = host.getApiSessionBinding();
  assert.equal(Object.prototype.hasOwnProperty.call(publicBinding, 'apiSessionToken'), false);
  assert.equal(host.getApiSessionBinding({ includeToken:true }).apiSessionToken, 'secret-token');
});
