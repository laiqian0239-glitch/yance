'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const deploy = require('../../tools/facebook/deploy-page-discovery-hotfix');

test('deployment tool routes npx.cmd through cmd.exe on Windows and pins Wrangler', () => {
  assert.equal(deploy.npxCommand('win32'), 'npx.cmd');
  assert.equal(deploy.npxCommand('linux'), 'npx');
  assert.deepEqual(deploy.wranglerArgs('whoami').slice(0, 2), ['--yes', 'wrangler@4.112.0']);
  const windows = deploy.commandInvocation(['whoami'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(windows.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(windows.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(windows.args[3], /^npx\.cmd "--yes" "wrangler@4\.112\.0" "whoami"$/);
  const linux = deploy.commandInvocation(['whoami'], 'linux', {});
  assert.equal(linux.command, 'npx');
});

test('deployment tool resolves existing D1 without creating resources', () => {
  const rows = deploy.d1RowsFromJson(JSON.stringify([{ name: 'other', uuid: 'id-other' }, { name: 'yance-facebook-gateway', uuid: 'real-d1-id-1234' }]));
  assert.equal(deploy.resolveD1Id(rows), 'real-d1-id-1234');
  assert.equal(deploy.resolveD1Id([{ database_name: 'yance-facebook-gateway', database_id: 'db-id-5678' }]), 'db-id-5678');
});

test('deployment tool patches only public Configuration and D1 identifiers', () => {
  const input = '{"vars":{"META_BUSINESS_LOGIN_CONFIG_ID":"old"},"d1_databases":[{"database_id":"placeholder"}]}';
  const output = deploy.patchPublicConfig(input, { d1Id: 'real-d1-id-1234', businessConfigId: '4234889550142986' });
  assert.match(output, /"META_BUSINESS_LOGIN_CONFIG_ID": "4234889550142986"/);
  assert.match(output, /"database_id": "real-d1-id-1234"/);
  assert.equal(/SECRET|TOKEN_ENCRYPTION_KEY|META_APP_SECRET/.test(output), false);
});
