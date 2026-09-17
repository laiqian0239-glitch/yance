'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = relativePath => JSON.parse(read(relativePath));

test('end-user Matrix identity uses one shared Synapse registration helper and no duplicate HMAC algorithm', () => {
  const helper = read('backend/services/synapseSharedSecretRegistration.js');
  const adapter = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');
  const service = read('backend/services/endUserMatrixIdentityService.js');
  assert.match(helper, /createHmac\('sha1',\s*sharedSecret\)/u);
  assert.match(helper, /\/_synapse\/admin\/v1\/register/u);
  assert.match(adapter, /registerSynapseUserWithSharedSecret/u);
  assert.match(service, /registerSynapseUserWithSharedSecret/u);
  assert.equal((adapter.match(/createHmac\(/g) || []).length, 0, 'Facebook adapter must not retain a duplicate Synapse HMAC parser');
});

test('retired local Matrix identity endpoints are absent from the Product production server', () => {
  const server = read('backend/server.js');
  assert.doesNotMatch(server, /endUserMatrixIdentityService/u);
  assert.doesNotMatch(server, /\/api\/desktop\/matrix-local-identity/u);
});

test('retired local Matrix identity IPC is absent from preload, bridge, manifest, and command inventory', () => {
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');
  const inventory = read('tools/wp2/command-path-inventory.js');
  const manifest = read('electron/m2/ipcManifest.json');
  for (const source of [bridge, preload, inventory, manifest]) {
    assert.doesNotMatch(source, /matrixLocalIdentity|matrix-local-identity|desktop:matrix-local-identity/u);
  }
});

test('YanceLogin uses invitation or durable-device resume while Element remains the sole login-completion authority', () => {
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const loginOnly = login.slice(0, login.indexOf('export function YancePostLoginSecurity'));
  const index = read('integration/element-module/src/index.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');
  assert.match(login, /loginPersonalAccess/u);
  assert.match(login, /onLoggedIn\(result\.accountAuth\)/u);
  assert.match(login, /data-yance-login-form-host="personal-access-invitation"/u);
  assert.match(login, /data-yance-invitation-login="jwt-element-on-logged-in"/u);
  assert.match(login, /data-yance-device-resume="unkey-status-element-on-logged-in"/u);
  assert.match(login, /已授权设备登录/u);
  assert.match(login, /mode === "invitation" \? \{ invitationKey: key \} : \{\}/u);
  assert.match(login, /邀请码/u);
  assert.match(index, /<YanceLogin onLoggedIn=\{props\.onLoggedIn\}/u);
  assert.doesNotMatch(index, /overwriteAccountAuth|accountAuthApi/u);
  assert.doesNotMatch(index, /desktop\.logoutPersonalAccess/u, 'Element session logout must not clear the independent durable device entitlement');
  assert.doesNotMatch(loginOnly, /overwriteAccountAuth\s*\(/u);
  assert.match(loginOnly, /submissionInFlightRef/u);
  assert.match(loginOnly, /handoffCommittedRef/u);
  assert.match(loginOnly, /if \(!handoffAccepted\)\s*\{[\s\S]*?submissionInFlightRef\.current = false[\s\S]*?setSubmitting\(false\)/u);
  assert.doesNotMatch(login, /data-yance-local-matrix-identity="first-use"/u);
  assert.doesNotMatch(login, /getMatrixLocalIdentity/u);
  assert.doesNotMatch(login, /createMatrixLocalIdentity/u);
  assert.doesNotMatch(login, /登录用户名/u);
  assert.doesNotMatch(loginOnly, /children/u);
  assert.doesNotMatch(login, /用户名/u);
  assert.doesNotMatch(login, /@\$\\?\{trimmedLocalpart\}:yance\.local/u);
  assert.doesNotMatch(login, /账号 ID 和你刚刚设置的密码登录/u);
  assert.match(styles, /\.yance-login-local-identity\s*\{/u);
  for (const forbidden of ['_matrix/client', 'm.login.password', 'localStorage.setItem', 'fetch(']) {
    assert.equal(login.includes(forbidden), false, `renderer must not implement Matrix session authority: ${forbidden}`);
  }
});

test('YanceLogin CSS owns the authentication panel vertical scroll authority so the Element submit button stays reachable on wide-but-short windows', () => {
  // Regression guard for ELECTRON_AUTH_VIEWPORT_OVERFLOW_UNSCROLLABLE.
  // The desktop auth surface is a two-column grid (`.yance-login-shell`) with a Yance
  // first-use card stacked above the Element login card inside the right column
  // (`.yance-login-auth`). The total content height (≈ 880–1200 px depending on
  // validation/error text growth) routinely exceeds the CSS viewport height on short
  // Windows screens and at 125%/150% display scaling. The original CSS only granted
  // `overflow: auto` inside the `@media (max-width: 760px)` (width-keyed) branch, so
  // any wide-but-short window had no vertical scroll path and the Element submit
  // button was clipped below the fold. The fix moves scroll ownership to the
  // authentication column and caps the grid row at the viewport height.
  const styles = read('integration/element-module/src/YanceLogin.css');

  // (1) The desktop shell is capped at the viewport and its single grid row uses a
  // `minmax(0, 1fr)` track so auth content can never push the row (and therefore
  // the shell) taller than the viewport.
  assert.match(
    styles,
    /\.yance-login-shell\s*\{[^}]*height:\s*100vh/u,
    'shell must be height-capped at the viewport so the row cannot be pushed taller'
  );
  assert.match(
    styles,
    /\.yance-login-shell\s*\{[^}]*grid-template-rows:\s*minmax\(\s*0\s*,\s*1fr\s*\)/u,
    'single grid row must use minmax(0, 1fr) so content overflow cannot grow the track'
  );

  // (2) The authentication column is the single authoritative vertical scroll root on
  // the desktop auth surface.
  assert.match(
    styles,
    /\.yance-login-auth\s*\{[^}]*overflow-y:\s*auto/u,
    'authentication column must declare overflow-y: auto to own vertical scrolling'
  );
  assert.match(
    styles,
    /\.yance-login-auth\s*\{[^}]*overflow-x:\s*hidden/u,
    'authentication column must clip its own horizontal overflow so the left branding column never moves'
  );
  assert.match(
    styles,
    /\.yance-login-auth\s*\{[^}]*justify-content:\s*safe center/u,
    'centering must use `safe center` so the top of overflowing content is never clipped'
  );
  assert.match(
    styles,
    /\.yance-login-auth\s*\{[^}]*min-height:\s*0/u,
    'authentication column must allow shrink (min-height: 0) so the capped grid row can size it'
  );
  assert.match(
    styles,
    /\.yance-login-auth\s*\{[^}]*overscroll-behavior:\s*contain/u,
    'authentication column must contain scroll chaining so it does not bubble to ancestors'
  );

  // (3) The left branding column is kept stable: brand height is bounded by the row and
  // it keeps its `overflow: hidden` so the radial-gradient orbs are never disturbed.
  assert.match(
    styles,
    /\.yance-login-brand\s*\{[^}]*max-height:\s*100%/u,
    'branding column must be height-bounded by the row so it never pushes the row taller'
  );
  assert.match(
    styles,
    /\.yance-login-brand\s*\{[^}]*overflow:\s*hidden/u,
    'branding column must keep overflow: hidden so the gradient orbs render cleanly'
  );

  // (4) YanceLogin.css must NOT introduce html/body overflow rules; document scroll
  // ownership belongs to Element, not to Yance, and we must not regress it.
  assert.doesNotMatch(styles, /(^|\n)\s*html\s*\{/u);
  assert.doesNotMatch(styles, /(^|\n)\s*body\s*\{/u);

  // (5) The stacked mobile/narrow branch releases the desktop cap: the shell becomes
  // the scroll root again and the authentication column stops being a scroll container.
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.yance-login-shell\s*\{[\s\S]*?height:\s*auto/u,
    'in the stacked branch, shell height must release to auto so it can scroll as a block'
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.yance-login-shell\s*\{[\s\S]*?overflow:\s*auto/u,
    'in the stacked branch, shell overflow must release to auto so it owns vertical scrolling'
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.yance-login-auth\s*\{[\s\S]*?overflow:\s*visible/u,
    'in the stacked branch, authentication column overflow must release so shell is the single scroll root'
  );

  // (6) The desktop shell must NOT carry `overflow: auto` outside the ≤760px branch;
  // otherwise scrolling the shell would drag the left branding panel out of view.
  const desktopShellBlock = styles.match(/\.yance-login-shell\s*\{[^}]*\}/u);
  assert.ok(desktopShellBlock, 'desktop .yance-login-shell block must exist');
  assert.match(
    desktopShellBlock[0],
    /overflow:\s*hidden/u,
    'desktop shell must keep overflow: hidden so the orbs render and branding stays in place'
  );
  assert.doesNotMatch(
    desktopShellBlock[0],
    /overflow:\s*auto/u,
    'desktop shell must not be given overflow: auto, which would scroll the branding panel'
  );
});

test('compact desktop login height breakpoints keep Yance brand text legible without adding a second scroll owner', () => {
  const styles = read('integration/element-module/src/YanceLogin.css');
  assert.match(styles, /YANCE_COMPACT_AUTH_VISUAL_GEOMETRY_V1/u);

  assert.match(
    styles,
    /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-height:\s*680px\)[\s\S]*?\.yance-login-brand-copy h1\s*\{[^}]*font-size:\s*clamp\(36px,\s*4vw,\s*42px\)/u,
    'wide-but-short desktop login must compact the Yance headline before hidden brand overflow can clip it'
  );
  assert.match(
    styles,
    /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-height:\s*560px\)[\s\S]*?\.yance-login-capabilities\s*\{[^}]*gap:\s*6px[\s\S]*?\.yance-login-capabilities span\s*\{[^}]*font-size:\s*10px/u,
    'very short desktop login must retain compact capability chips inside the approved Product brand boundary'
  );
  const compact = styles.slice(styles.indexOf('/* YANCE_COMPACT_AUTH_VISUAL_GEOMETRY_V1'));
  assert.doesNotMatch(compact, /\.yance-login-brand\s*\{[^}]*overflow(?:-y)?:\s*(?:auto|scroll)/u);
  assert.doesNotMatch(compact, /(^|\n)\s*(?:html|body)\s*\{/u);
  assert.doesNotMatch(compact, /\.yance-login-auth\s*\{[^}]*overflow-y:\s*(?:auto|scroll)/u,
    'compact rules must reuse the existing auth-column scroll owner rather than declaring a second lifecycle');
});

test('local identity provisioning records durable intent before the remote call and classifies every outcome', () => {
  const service = read('backend/services/endUserMatrixIdentityService.js');
  const adapter = read('backend/services/facebookPersonalMessengerMautrixAdapter.js');

  const pendingWrite = service.indexOf('writeStateAtomic(pendingPath()');
  const remoteCall = service.indexOf('registerSynapseUserWithSharedSecret({');
  const receiptWrite = service.indexOf('writeStateAtomic(receiptPath()');
  assert.ok(pendingWrite >= 0 && remoteCall > pendingWrite, 'the durable pending marker must be written before the homeserver call');
  assert.ok(receiptWrite > remoteCall, 'the authoritative receipt may only be written after the homeserver confirms');

  assert.match(service, /YANCE_LOCAL_MATRIX_HUMAN_IDENTITY_PENDING_V1/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_PROVISION_IN_PROGRESS/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_PERSIST_FAILED/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_REGISTRATION_OUTCOME_UNKNOWN/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_LOCALPART_TAKEN/u);
  assert.match(service, /classifyRemoteOutcome/u);

  // Atomic durable write: O_EXCL create for the marker, temp+rename for the receipt.
  assert.match(service, /openSync\([^)]*'wx'/u);
  assert.match(service, /renameSync\(tempPath/u);

  // Upstream error bodies must never be forwarded or spread back into details.
  assert.doesNotMatch(service, /details:\s*\{\s*\.\.\./u);
  assert.doesNotMatch(service, /error\.details\.body/u);

  // Namespace collision proof: the bridged platform localpart is reserved.
  assert.match(adapter, /yance_fb_/u);
  assert.match(service, /RESERVED_LOCALPART_PREFIXES[\s\S]{0,200}?yance_/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_LOCALPART_RESERVED/u);

  // Secret custody stays enforced at every durable write.
  assert.match(service, /SECRET_MARKER_PATTERN/u);
  assert.match(service, /MATRIX_LOCAL_IDENTITY_SECRET_RECEIPT_DENIED/u);
});