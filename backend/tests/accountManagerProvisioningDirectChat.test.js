'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountManager } = require('../services/accountManagerCore');

function managerWith(account, result = { roomId: '!room:yance.local', peerId: 'user:7991006491' }) {
  const manager = Object.create(AccountManager.prototype);
  let call = null;
  manager.publicAccount = (row) => ({ id: row.id, platform: row.platform });
  manager.mautrixProvisioningAccount = () => ({
    account,
    driver: {
      async ensureDirectChat(receivedAccount, identifier, loginId, options) {
        call = { receivedAccount, identifier, loginId, options };
        return result;
      },
    },
  });
  return { manager, getCall: () => call };
}

test('account manager derives exact mautrix login identity for direct-chat provisioning', async () => {
  const account = {
    id: 'te-canonical',
    platform: 'telegram',
    metadata: { mautrixLoginId: '8638095739', liveUser: { id: '8638095739' } },
  };
  const { manager, getCall } = managerWith(account);
  const output = await manager.ensureProvisioningDirectChat(
    'te-canonical',
    'telegram:7991006491',
    { matrixUserId: '@tester01:yance.local' },
  );

  assert.equal(output.roomId, '!room:yance.local');
  assert.equal(output.peerId, 'user:7991006491');
  assert.equal(getCall().receivedAccount, account);
  assert.equal(getCall().identifier, 'telegram:7991006491');
  assert.equal(getCall().loginId, '8638095739');
  assert.equal(getCall().options.matrixUserId, '@tester01:yance.local');
});

test('account manager fails closed when canonical account has no exact mautrix login identity', async () => {
  const { manager, getCall } = managerWith({
    id: 'te-canonical',
    platform: 'telegram',
    metadata: {},
  });

  await assert.rejects(
    () => manager.ensureProvisioningDirectChat(
      'te-canonical', 'telegram:7991006491', { matrixUserId: '@tester01:yance.local' },
    ),
    (error) => error && error.code === 'MAUTRIX_LOGIN_ID_REQUIRED',
  );
  assert.equal(getCall(), null);
});
