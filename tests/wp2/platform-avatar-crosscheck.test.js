'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { COMMANDS, isKnownCommand } = require(path.join(ROOT, 'shared/core/contracts.js'));
const accountContext = fs.readFileSync(path.join(ROOT, 'backend/core/accountContext.js'), 'utf8');
const accountRoutes = fs.readFileSync(path.join(ROOT, 'backend/routes/accounts.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
const safeRenderers = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-contact-safe-renderers.js'), 'utf8');
const avatarRuntime = fs.readFileSync(path.join(ROOT, 'frontend/js/sqliteConversationRuntime.js'), 'utf8');

test('shared command contract covers WhatsApp/Telegram challenge, avatar failure and Facebook OAuth lifecycle', () => {
  const required = [
    COMMANDS.ACCOUNT_GET_AUTH_CHALLENGE,
    COMMANDS.ACCOUNT_AVATAR_LOAD_FAILURE,
    COMMANDS.ACCOUNT_TELEGRAM_QR_START,
    COMMANDS.ACCOUNT_FACEBOOK_OAUTH_START,
    COMMANDS.ACCOUNT_FACEBOOK_OAUTH_STATUS,
    COMMANDS.ACCOUNT_FACEBOOK_OAUTH_SELECT_PAGE,
    COMMANDS.ACCOUNT_FACEBOOK_OAUTH_CANCEL
  ];
  for (const command of required) assert.equal(isKnownCommand(command), true, command);
});

test('Facebook commands remain wired through route and account context after shared contract edits', () => {
  for (const command of [
    'account.facebook.oauth.start',
    'account.facebook.oauth.status',
    'account.facebook.oauth.selectPage',
    'account.facebook.oauth.cancel'
  ]) {
    assert.ok(accountContext.includes(`case '${command}'`), `context missing ${command}`);
    assert.ok(accountRoutes.includes(`'${command}'`), `route missing ${command}`);
  }
});

test('all routed contact surfaces use the shared avatar mounting pipeline', () => {
  assert.match(ui, /function avatarHostMarkup/);
  assert.match(ui, /function hydrateRuntimeAvatars/);
  assert.match(ui, /hydrateRuntimeAvatars\(\$\('profileList'\),rows\)/);
  assert.match(ui, /hydrateRuntimeAvatars\(\$\('profileDetailHero'\),\[r\]\)/);
  assert.match(ui, /hydrateRuntimeAvatars\(\$\('timelineList'\),rows\)/);
  assert.match(ui, /hydrateRuntimeAvatars\(\$\('timelineDetailHero'\),\[r\]\)/);
  assert.match(safeRenderers, /runtime\?\.mountAvatar/);
  assert.match(avatarRuntime, /reportAvatarFailure/);
  assert.match(avatarRuntime, /frontend-load-failed/);
});
