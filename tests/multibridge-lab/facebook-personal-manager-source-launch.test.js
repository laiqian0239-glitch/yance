'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCHER = path.join(ROOT, 'tools', 'multibridge-lab', 'RUN_FACEBOOK_PERSONAL_MANAGER_SOURCE.cmd');
const README = path.join(ROOT, 'tools', 'multibridge-lab', 'FACEBOOK_PERSONAL_MANAGER_SOURCE_README.txt');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-native-process.yml');

const MANAGER_COMMIT = 'd2c08e60c7a877602bc6da2961daf2daffcff79b';
const MANAGER_REPO = 'https://github.com/mautrix/manager.git';

test('Facebook Personal operator launcher uses exact upstream manager source instead of bypassing unsigned installer', () => {
  assert.ok(fs.existsSync(LAUNCHER), `missing source launcher: ${LAUNCHER}`);
  assert.ok(fs.existsSync(README), `missing source launcher README: ${README}`);

  const launcher = fs.readFileSync(LAUNCHER, 'utf8');
  const readme = fs.readFileSync(README, 'utf8');
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  assert.match(launcher, new RegExp(`set "MANAGER_COMMIT=${MANAGER_COMMIT}"`));
  assert.match(launcher, /https:\/\/github\.com\/mautrix\/manager\.git/);
  assert.match(launcher, /git\s+clone\s+--no-checkout/i);
  assert.match(launcher, /git\s+-C\s+"%MANAGER_DIR%"\s+fetch[^\r\n]*%MANAGER_COMMIT%/i);
  assert.match(launcher, /git\s+-C\s+"%MANAGER_DIR%"\s+checkout\s+--detach\s+%MANAGER_COMMIT%/i);
  assert.match(launcher, /git\s+-C\s+"%MANAGER_DIR%"\s+rev-parse\s+HEAD/i);
  assert.match(launcher, /if\s+\/I\s+not\s+"%ACTUAL_HEAD%"=="%MANAGER_COMMIT%"/i);
  assert.match(launcher, /UPSTREAM_MANAGER_SOURCE_GREEN/);

  assert.match(launcher, /node\s+--version/i);
  assert.match(launcher, /npm\s+--version/i);
  assert.match(launcher, /npm\s+ci\s+--include=dev/i);
  assert.match(launcher, /npm\s+run\s+lint/i);
  assert.match(launcher, /UPSTREAM_MANAGER_DEPENDENCIES_GREEN/);
  assert.match(launcher, /UPSTREAM_MANAGER_LINT_GREEN/);
  assert.match(launcher, /npm\s+start/i);
  assert.match(launcher, /HUMAN_AUTH_REQUIRED/);
  assert.match(launcher, /pause/i);

  assert.doesNotMatch(launcher, /mautrix-manager-0\.2\.1(?:\.Setup|-Setup).*\.exe/i);
  assert.doesNotMatch(launcher, /SmartScreen|Run anyway|仍要运行/i);
  assert.doesNotMatch(launcher, /Unblock-File|Zone\.Identifier/i);
  assert.doesNotMatch(launcher, /ExecutionPolicy\s+(?:Bypass|Unrestricted)|Set-ExecutionPolicy/i);
  assert.doesNotMatch(launcher, /cookie|password|2fa|access[_ -]?token/i);

  assert.match(readme, /mautrix-manager v0\.2\.1/i);
  assert.match(readme, new RegExp(MANAGER_COMMIT));
  assert.match(readme, /official source/i);
  assert.match(readme, /do not.*Run anyway/i);
  assert.match(readme, /Facebook Personal/i);

  assert.match(workflow, /Verify exact upstream mautrix-manager source launch chain/);
  assert.match(workflow, new RegExp(MANAGER_COMMIT));
  assert.match(workflow, /npm ci --include=dev/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /MAUTRIX_MANAGER_SOURCE_CHAIN_GREEN/);
  assert.match(workflow, /yance-facebook-personal-manager-source-launch/);
});
