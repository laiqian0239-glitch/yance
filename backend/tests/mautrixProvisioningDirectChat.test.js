'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const adapter = require('../services/mautrixProvisioningAdapter');

function tempSecret() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-mautrix-secret-'));
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, '0123456789abcdef0123456789abcdef', 'utf8');
  return { dir, file };
}

test('Telegram direct chat uses official create_dm with exact login and Matrix human identity', async (t) => {
  const secret = tempSecret();
  t.after(() => fs.rmSync(secret.dir, { recursive: true, force: true }));
  const oldSecret = process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE;
  const oldUrl = process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL;
  const oldFetch = global.fetch;
  t.after(() => {
    process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE = oldSecret || '';
    process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL = oldUrl || '';
    global.fetch = oldFetch;
  });
  process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE = secret.file;
  process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL = 'http://127.0.0.1:64792/_matrix/provision';
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 'user:7991006491',
          name: 'Marc Rotte',
          mxid: '@telegram_7991006491:yance.local',
          dm_room_mxid: '!lyiCOwJAuQxvuHffmx:yance.local',
        };
      },
    };
  };

  const result = await adapter.telegram.ensureDirectChat(
    { id: 'te-canonical', platform: 'telegram' },
    'telegram:7991006491',
    '8638095739',
    { matrixUserId: '@tester01:yance.local' },
  );

  assert.equal(result.roomId, '!lyiCOwJAuQxvuHffmx:yance.local');
  assert.equal(result.peerId, 'user:7991006491');
  assert.equal(captured.options.method, 'POST');
  const parsed = new URL(captured.url);
  assert.equal(parsed.pathname, '/_matrix/provision/v3/create_dm/7991006491');
  assert.equal(parsed.searchParams.get('user_id'), '@tester01:yance.local');
  assert.equal(parsed.searchParams.get('login_id'), '8638095739');
  assert.equal(captured.options.body, undefined);
});

test('direct chat fails closed when the bridge does not return a room id', async (t) => {
  const secret = tempSecret();
  t.after(() => fs.rmSync(secret.dir, { recursive: true, force: true }));
  const oldSecret = process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE;
  const oldFetch = global.fetch;
  t.after(() => {
    process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE = oldSecret || '';
    global.fetch = oldFetch;
  });
  process.env.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE = secret.file;
  global.fetch = async () => ({ ok: true, status: 200, async json() { return { id: 'user:7991006491' }; } });

  await assert.rejects(
    () => adapter.telegram.ensureDirectChat(
      { id: 'te-canonical', platform: 'telegram' }, '7991006491', '8638095739',
      { matrixUserId: '@tester01:yance.local' },
    ),
    (error) => error && error.code === 'MAUTRIX_DIRECT_CHAT_ROOM_REQUIRED',
  );
});
