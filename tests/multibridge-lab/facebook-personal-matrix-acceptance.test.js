'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'multibridge-lab', 'facebook-personal-matrix-acceptance.ps1');
const CMD = path.join(ROOT, 'tools', 'multibridge-lab', 'RUN_FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE.cmd');
const README = path.join(ROOT, 'tools', 'multibridge-lab', 'FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_README.txt');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-facebook-matrix-acceptance.yml');

function text(file) {
  assert.ok(fs.existsSync(file), `missing required file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function runProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd ?? ROOT,
      windowsHide: true,
      env: options.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

test('Facebook Personal acceptance probe is read-only except ephemeral Matrix login/logout and proves connected space plus history', () => {
  const script = text(SCRIPT);
  const wrapper = text(CMD);
  const readme = text(README);
  const workflow = text(WORKFLOW);

  assert.match(script, /\.runtime[\\/]synapse[\\/]lab-password\.txt/);
  assert.match(script, /@lab:yance-lab\.local/);
  assert.match(script, /\/_matrix\/client\/v3\/login/);
  assert.match(script, /m\.login\.password/);
  assert.match(script, /m\.id\.user/);
  assert.match(script, /\/_matrix\/client\/v3\/account\/whoami/);
  assert.match(script, /\/_matrix\/provision\/v3\/whoami/);
  assert.match(script, /CONNECTED/);
  assert.match(script, /space_room/);
  assert.match(script, /m\.room\.create/);
  assert.match(script, /m\.space/);
  assert.match(script, /m\.space\.child/);
  assert.match(script, /\/messages\?dir=b&limit=/);
  assert.match(script, /m\.room\.message/);
  assert.match(script, /FACEBOOK_PROVISIONING_CONNECTED_GREEN/);
  assert.match(script, /FACEBOOK_MATRIX_SPACE_GREEN/);
  assert.match(script, /FACEBOOK_MATRIX_HISTORY_GREEN/);
  assert.match(script, /FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_GREEN/);
  assert.match(script, /\/_matrix\/client\/v3\/logout/);

  assert.doesNotMatch(script, /send\/m\.room\.message|createRoom|\/createRoom|\/join\//i);
  assert.doesNotMatch(script, /docker\s+(?:compose|run|exec)|wsl(?:\.exe)?|netsh|Set-NetFirewall|portproxy/i);
  assert.doesNotMatch(script, /Write-(?:Host|Output)[^\r\n]*(?:password|access[_ -]?token)/i);
  assert.doesNotMatch(script, /facebook\.com|cookie|2fa|verification code/i);

  assert.match(wrapper, /PACKAGE_INTEGRITY_GREEN/);
  assert.match(wrapper, /PACKAGE_MOTW_RELEASE_GREEN/);
  assert.match(wrapper, /facebook-personal-matrix-acceptance\.ps1/);
  assert.match(wrapper, /Unblock-File/);
  assert.match(wrapper, /pause/i);
  assert.doesNotMatch(wrapper, /ExecutionPolicy\s+(?:Bypass|Unrestricted)|Set-ExecutionPolicy/i);

  assert.match(readme, /read-only/i);
  assert.match(readme, /does not send/i);
  assert.match(readme, /CONNECTED/);
  assert.match(readme, /initial history/i);
  assert.match(readme, /password/i);
  assert.match(readme, /never printed/i);

  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /facebook-personal-matrix-acceptance\.test\.js/);
  assert.match(workflow, /WINDOWS_POWERSHELL_5_1_MATRIX_ACCEPTANCE_PARSE_GREEN/);
  assert.match(workflow, /yance-facebook-personal-matrix-acceptance-/);
  assert.match(workflow, /MATRIX_ACCEPTANCE_PACKAGE_GREEN/);
});

test('Windows acceptance probe proves connected Facebook provisioning identity, Matrix space membership, and redacted initial history', { skip: process.platform !== 'win32' }, async () => {
  text(SCRIPT);
  const expectedUser = '@lab:yance-lab.local';
  const password = 'unit-test-password-not-for-output';
  const accessToken = 'unit-test-access-token-not-for-output';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fb-matrix-acceptance-'));
  const passwordPath = path.join(tmp, '.runtime', 'synapse', 'lab-password.txt');
  fs.mkdirSync(path.dirname(passwordPath), { recursive: true });
  fs.writeFileSync(passwordPath, `${password}\r\n`, 'utf8');

  let loginBody = null;
  let logoutSeen = false;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(url.pathname);
      let body = '';
      for await (const chunk of req) body += chunk;
      if (req.method === 'POST' && decodedPath === '/_matrix/client/v3/login') {
        loginBody = JSON.parse(body || '{}');
        return writeJson(res, 200, { access_token: accessToken, device_id: 'TEST', user_id: expectedUser });
      }
      if (req.headers.authorization !== `Bearer ${accessToken}`) {
        return writeJson(res, 401, { errcode: 'M_UNAUTHORIZED', error: 'missing token' });
      }
      if (req.method === 'GET' && decodedPath === '/_matrix/client/v3/account/whoami') {
        return writeJson(res, 200, { user_id: expectedUser, device_id: 'TEST' });
      }
      if (req.method === 'GET' && decodedPath === '/_matrix/provision/v3/whoami') {
        assert.equal(url.searchParams.get('user_id'), expectedUser);
        return writeJson(res, 200, {
          network: { displayname: 'Facebook Messenger', network_url: 'https://www.facebook.com', network_icon: 'mxc://test/icon', network_id: 'facebook', beeper_bridge_type: 'facebook' },
          login_flows: [], homeserver: 'test', bridge_bot: '@facebookbot:test', command_prefix: '!fb', management_room: '!mgmt:test',
          logins: [{ state: { state_event: 'CONNECTED', timestamp: 1 }, id: 'remote-redacted', name: 'Remote Redacted', profile: { name: 'Remote Redacted' }, space_room: '!fbspace:test' }],
        });
      }
      if (req.method === 'GET' && decodedPath === '/_matrix/client/v3/rooms/!fbspace:test/state') {
        return writeJson(res, 200, [
          { type: 'm.room.create', state_key: '', content: { type: 'm.space' } },
          { type: 'm.room.name', state_key: '', content: { name: 'Facebook Messenger' } },
          { type: 'm.space.child', state_key: '!room1:test', content: { via: ['test'] } },
        ]);
      }
      if (req.method === 'GET' && decodedPath === '/_matrix/client/v3/rooms/!room1:test/messages') {
        assert.equal(url.searchParams.get('dir'), 'b');
        return writeJson(res, 200, {
          start: 's', end: 'e',
          chunk: [
            { type: 'm.room.message', sender: '@remote:test', content: { msgtype: 'm.text', body: 'private body must never be printed' } },
          ],
        });
      }
      if (req.method === 'POST' && decodedPath === '/_matrix/client/v3/logout') {
        logoutSeen = true;
        return writeJson(res, 200, {});
      }
      return writeJson(res, 404, { errcode: 'M_NOT_FOUND', error: decodedPath });
    } catch (err) {
      writeJson(res, 500, { error: String(err) });
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const run = await runProcess('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT,
      '-LabRoot', tmp,
      '-HomeserverUrl', base,
      '-BridgeUrl', base,
      '-ExpectedUserId', expectedUser,
      '-MessageScanLimit', '20',
    ]);
    assert.equal(run.code, 0, `acceptance probe failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /MATRIX_LOCAL_LOGIN_GREEN/);
    assert.match(run.stdout, /FACEBOOK_PROVISIONING_CONNECTED_GREEN login_count=1/);
    assert.match(run.stdout, /FACEBOOK_MATRIX_SPACE_GREEN child_rooms=1/);
    assert.match(run.stdout, /FACEBOOK_MATRIX_HISTORY_GREEN rooms_with_messages=1 message_events=1/);
    assert.match(run.stdout, /FINAL STATUS: FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_GREEN/);
    assert.ok(logoutSeen, 'ephemeral Matrix token was not logged out');
    assert.equal(loginBody?.type, 'm.login.password');
    assert.equal(loginBody?.identifier?.type, 'm.id.user');
    assert.equal(loginBody?.identifier?.user, expectedUser);
    assert.equal(loginBody?.password, password);
    assert.doesNotMatch(run.stdout + run.stderr, new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(run.stdout + run.stderr, new RegExp(accessToken));
    assert.doesNotMatch(run.stdout + run.stderr, /private body must never be printed/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});