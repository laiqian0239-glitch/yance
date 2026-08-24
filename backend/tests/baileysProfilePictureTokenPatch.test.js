'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_ROOT = path.join(ROOT, 'node_modules', '@whiskeysockets', 'baileys');

function read(relativePath) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, relativePath), 'utf8');
}

test('official Baileys rc14 already provides Yance-required profile-picture tctoken semantics', () => {
  const metadata = JSON.parse(read('package.json'));
  const chats = read('lib/Socket/chats.js');

  assert.equal(metadata.name, '@whiskeysockets/baileys');
  assert.equal(metadata.version, '7.0.0-rc14');
  assert.match(chats, /const picture = \{ tag: 'picture', attrs: \{ type, query: 'url' \} \};/u);
  assert.match(chats, /picture\.content = tcTokenContent/u);
  assert.match(chats, /return \[picture\];/u);
});

test('official Baileys rc14 requires and emits the trusted-contact-token timestamp', () => {
  const token = read('lib/Utils/tc-token-utils.js');

  assert.match(token, /const timestamp = entry\?\.timestamp/u);
  assert.match(token, /timestamp === undefined/u);
  assert.match(token, /attrs: \{ t: String\(timestamp\) \}/u);
});
