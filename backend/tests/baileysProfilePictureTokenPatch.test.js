'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  TARGET_VERSION,
  PATCH_ID,
  ORIGINAL_PROFILE_FUNCTION,
  applyPatch
} = require('../../scripts/dependencies/apply-baileys-profile-picture-token-fix');

const ORIGINAL_TC_TOKEN = `export async function buildTcTokenFromJid({ authState, jid, baseContent = [], getLIDForPN }) {
    try {
        const storageJid = await resolveTcTokenJid(jid, getLIDForPN);
        const tcTokenData = await authState.keys.get('tctoken', [storageJid]);
        const entry = tcTokenData?.[storageJid];
        const tcTokenBuffer = entry?.token;
        if (!tcTokenBuffer?.length || isTcTokenExpired(entry?.timestamp)) {
            return baseContent.length > 0 ? baseContent : undefined;
        }
        baseContent.push({
            tag: 'tctoken',
            attrs: {},
            content: tcTokenBuffer
        });
        return baseContent;
    }
    catch (error) {
        return baseContent.length > 0 ? baseContent : undefined;
    }
}`;

function makeProject(version = TARGET_VERSION) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-baileys-patch-'));
  const packageRoot = path.join(root, 'node_modules', '@whiskeysockets', 'baileys');
  fs.mkdirSync(path.join(packageRoot, 'lib', 'Socket'), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, 'lib', 'Utils'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@whiskeysockets/baileys', version }), 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'lib', 'Socket', 'chats.js'), `prefix\n${ORIGINAL_PROFILE_FUNCTION}\nsuffix\n`, 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'lib', 'Utils', 'tc-token-utils.js'), ORIGINAL_TC_TOKEN, 'utf8');
  return { root, packageRoot };
}

test('rc13 compatibility patch nests tctoken under picture and includes timestamp', t => {
  const project = makeProject();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const first = applyPatch({ projectRoot: project.root });
  assert.equal(first.status, 'patched');

  const chats = fs.readFileSync(path.join(project.packageRoot, 'lib', 'Socket', 'chats.js'), 'utf8');
  const token = fs.readFileSync(path.join(project.packageRoot, 'lib', 'Utils', 'tc-token-utils.js'), 'utf8');
  assert.match(chats, new RegExp(PATCH_ID));
  assert.match(chats, /content: \[picture\]/);
  assert.match(chats, /picture\.content = tcTokenContent/);
  assert.match(token, /timestamp === undefined/);
  assert.match(token, /attrs: \{ t: String\(timestamp\) \}/);

  const second = applyPatch({ projectRoot: project.root });
  assert.equal(second.status, 'already-patched');
});

test('compatibility patch refuses unknown unpatched Baileys versions', t => {
  const project = makeProject('7.0.0-rc99');
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  assert.throws(() => applyPatch({ projectRoot: project.root }), /unsupported Baileys version/);
});

test('allow-missing supports clean source before dependency installation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-baileys-missing-'));
  try {
    assert.equal(applyPatch({ projectRoot: root, allowMissing: true }).status, 'missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
