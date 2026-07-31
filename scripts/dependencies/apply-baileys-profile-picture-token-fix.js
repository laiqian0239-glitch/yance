'use strict';

const fs = require('fs');
const path = require('path');

const TARGET_VERSION = '7.0.0-rc13';
const PATCH_ID = 'YANCE_BAILEYS_PROFILE_PICTURE_TCTOKEN_20260626';

function readUtf8(file) { return fs.readFileSync(file, 'utf8'); }
function writeAtomic(file, text) {
  const temporary = `${file}.yance-tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
}
function exists(file) { try { return fs.statSync(file).isFile(); } catch (_) { return false; } }

const ORIGINAL_PROFILE_FUNCTION = `    const profilePictureUrl = async (jid, type = 'preview', timeoutMs) => {
        const baseContent = [{ tag: 'picture', attrs: { type, query: 'url' } }];
        // WA Web only includes tctoken for user JIDs (not groups/newsletters)
        // and never for own profile pic (Chat model for self has no tcToken).
        // Including tctoken for own JID causes the server to never respond.
        const normalizedJid = jidNormalizedUser(jid);
        const isUserJid = isPnUser(normalizedJid) || isLidUser(normalizedJid);
        const me = authState.creds.me;
        const isSelf = me && (normalizedJid === jidNormalizedUser(me.id) || (me.lid && normalizedJid === jidNormalizedUser(me.lid)));
        let content = baseContent;
        if (serverProps.profilePicPrivacyToken && isUserJid && !isSelf) {
            content = await buildTcTokenFromJid({
                authState,
                jid: normalizedJid,
                baseContent,
                getLIDForPN
            });
        }
        jid = jidNormalizedUser(jid);
        const result = await query({
            tag: 'iq',
            attrs: {
                target: jid,
                to: S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:profile:picture'
            },
            content
        }, timeoutMs);
        const child = getBinaryNodeChild(result, 'picture');
        return child?.attrs?.url;
    };`;

const PATCHED_PROFILE_FUNCTION = `    const profilePictureUrl = async (jid, type = 'preview', timeoutMs) => {
        // ${PATCH_ID}: WhatsApp expects a trusted-contact token to be nested
        // inside the <picture> query node. rc13 emitted it as an IQ sibling,
        // which can make the server silently return no picture URL.
        const normalizedJid = jidNormalizedUser(jid);
        const isUserJid = isPnUser(normalizedJid) || isLidUser(normalizedJid);
        const me = authState.creds.me;
        const isSelf = me && (normalizedJid === jidNormalizedUser(me.id) || (me.lid && normalizedJid === jidNormalizedUser(me.lid)));
        let tcTokenContent;
        if (serverProps.profilePicPrivacyToken && isUserJid && !isSelf) {
            tcTokenContent = await buildTcTokenFromJid({
                authState,
                jid: normalizedJid,
                getLIDForPN
            });
        }
        jid = jidNormalizedUser(jid);
        const picture = { tag: 'picture', attrs: { type, query: 'url' } };
        if (tcTokenContent?.length) picture.content = tcTokenContent;
        const result = await query({
            tag: 'iq',
            attrs: {
                target: jid,
                to: S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:profile:picture'
            },
            content: [picture]
        }, timeoutMs);
        const child = getBinaryNodeChild(result, 'picture');
        return child?.attrs?.url;
    };`;

function patchChats(text) {
  if (text.includes(PATCH_ID) && text.includes('content: [picture]')) return { text, changed: false, alreadyPatched: true };
  if (!text.includes(ORIGINAL_PROFILE_FUNCTION)) throw new Error('Baileys chats.js does not match the supported rc13 profilePictureUrl implementation');
  return { text: text.replace(ORIGINAL_PROFILE_FUNCTION, PATCHED_PROFILE_FUNCTION), changed: true, alreadyPatched: false };
}

function patchTcTokenUtils(text) {
  const patchedMarker = "attrs: { t: String(timestamp) }";
  if (text.includes(patchedMarker) && text.includes('timestamp === undefined')) return { text, changed: false, alreadyPatched: true };

  const before = `        const entry = tcTokenData?.[storageJid];
        const tcTokenBuffer = entry?.token;
        if (!tcTokenBuffer?.length || isTcTokenExpired(entry?.timestamp)) {`;
  const after = `        const entry = tcTokenData?.[storageJid];
        const tcTokenBuffer = entry?.token;
        const timestamp = entry?.timestamp;
        if (!tcTokenBuffer?.length || timestamp === undefined || isTcTokenExpired(timestamp)) {`;
  if (!text.includes(before)) throw new Error('Baileys tc-token-utils.js does not match the supported rc13 token implementation');
  text = text.replace(before, after);

  const attrsBefore = `        baseContent.push({
            tag: 'tctoken',
            attrs: {},
            content: tcTokenBuffer
        });`;
  const attrsAfter = `        baseContent.push({
            tag: 'tctoken',
            attrs: { t: String(timestamp) },
            content: tcTokenBuffer
        });`;
  if (!text.includes(attrsBefore)) throw new Error('Baileys tc-token-utils.js tctoken node does not match rc13');
  text = text.replace(attrsBefore, attrsAfter);
  return { text, changed: true, alreadyPatched: false };
}

function applyPatch(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const packageRoot = path.join(projectRoot, 'node_modules', '@whiskeysockets', 'baileys');
  const packageJsonPath = path.join(packageRoot, 'package.json');
  if (!exists(packageJsonPath)) {
    if (options.allowMissing) return { status: 'missing', projectRoot, packageRoot };
    throw new Error(`Baileys installation not found: ${packageRoot}`);
  }

  const packageJson = JSON.parse(readUtf8(packageJsonPath));
  const chatsPath = path.join(packageRoot, 'lib', 'Socket', 'chats.js');
  const tokenPath = path.join(packageRoot, 'lib', 'Utils', 'tc-token-utils.js');
  if (!exists(chatsPath) || !exists(tokenPath)) throw new Error('Baileys built runtime files are missing');

  const chatsResult = patchChats(readUtf8(chatsPath));
  const tokenResult = patchTcTokenUtils(readUtf8(tokenPath));
  const alreadyPatched = chatsResult.alreadyPatched && tokenResult.alreadyPatched;
  if (!alreadyPatched && packageJson.version !== TARGET_VERSION) {
    throw new Error(`Refusing to patch unsupported Baileys version ${packageJson.version}; expected ${TARGET_VERSION}`);
  }

  if (chatsResult.changed) writeAtomic(chatsPath, chatsResult.text);
  if (tokenResult.changed) writeAtomic(tokenPath, tokenResult.text);

  const verifiedChats = readUtf8(chatsPath);
  const verifiedToken = readUtf8(tokenPath);
  if (!verifiedChats.includes(PATCH_ID) || !verifiedChats.includes('content: [picture]')) throw new Error('Baileys profile picture query patch verification failed');
  if (!verifiedToken.includes('attrs: { t: String(timestamp) }')) throw new Error('Baileys tc token timestamp patch verification failed');

  return {
    status: alreadyPatched ? 'already-patched' : 'patched',
    version: packageJson.version,
    patchId: PATCH_ID,
    files: [chatsPath, tokenPath]
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const projectRootIndex = argv.indexOf('--project-root');
  const projectRootArgument = projectRootIndex >= 0 ? argv[projectRootIndex + 1] : '';
  const projectRootEquals = argv.find(value => value.startsWith('--project-root='));
  const projectRoot = projectRootArgument || (projectRootEquals ? projectRootEquals.slice('--project-root='.length) : '');
  try {
    const result = applyPatch({ allowMissing: args.has('--allow-missing'), projectRoot: projectRoot || process.cwd() });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { TARGET_VERSION, PATCH_ID, ORIGINAL_PROFILE_FUNCTION, PATCHED_PROFILE_FUNCTION, patchChats, patchTcTokenUtils, applyPatch };
