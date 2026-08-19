'use strict';

const RETIRED_CODE = 'FACEBOOK_PERSONAL_MESSENGER_EXPERIMENTAL_RETIRED';
function retired() {
  const error = new Error('Facebook Personal Messenger experimental browser driver has been retired; use mautrix/meta production authority.');
  error.code = RETIRED_CODE;
  error.status = 410;
  throw error;
}
function enabled() { return false; }
function credentialReady() { return false; }
function status() {
  return Object.freeze({
    state: 'retired',
    canSend: false,
    canReceive: false,
    supportLevel: 'retired',
    riskDisclosureRequired: false,
    reasonCode: RETIRED_CODE,
    replacementDriverId: 'facebook-personal-messenger-mautrix-meta'
  });
}

module.exports = Object.freeze({
  supportLevel: 'retired',
  official: false,
  messagingSupported: false,
  riskDisclosureRequired: false,
  enabled,
  credentialReady,
  status,
  connect: retired,
  disconnect: retired,
  sync: retired,
  sendText: retired,
  sendMedia: retired,
  sendPresence: retired,
  markRead: retired
});
