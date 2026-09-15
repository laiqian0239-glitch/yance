'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

test('Electron runtime icons come only from canonical Yance branding authority', () => {
  const main = read('electron/main.js');
  assert.doesNotMatch(main, /frontend[\\/]',\s*'assets[\\/]'|frontend\/assets\/icon\.(?:ico|png)/u);
  assert.match(main, /assets[\\/]',\s*'branding[\\/]',\s*'yance/u);
  assert.match(main, /Yance\.ico/u);
  assert.match(main, /yance-app-icon-(?:64|128|256|512|1024)\.png/u);
});

test('canonical production brand authority is deep purple and white, not retired teal', () => {
  const tokens = read('assets/branding/yance/branding-tokens.json');
  const master = read('assets/branding/yance/source/yance-mark-master.svg');
  const flat = read('assets/branding/yance/product/yance-mark-flat.svg');
  const micro = read('assets/branding/yance/product/yance-mark-micro.svg');
  const productionAuthority = `${tokens}\n${master}\n${flat}\n${micro}`;

  assert.match(tokens, /#2A0F4A/iu);
  assert.match(tokens, /#FFFFFF/iu);
  assert.doesNotMatch(productionAuthority, /#(?:17BDB5|3DD9D0|0F2E31)/iu);
});

test('Yance registers the pinned Element login component seam without a second auth protocol', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  assert.equal(exists('integration/element-module/src/YanceLogin.tsx'), true);
  assert.equal(exists('integration/element-module/src/YanceLogin.css'), true);
  assert.match(moduleIndex, /registerLoginComponent\s*\(/u);
  assert.match(moduleIndex, /YanceLogin/u);
});

test('brand preview assets remain available but are not the normal Product workspace path', () => {
  const workspace = read('integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(exists('integration/element-module/src/BrandPreviewSurface.tsx'), true);
  assert.equal(exists('integration/element-module/src/BrandPreviewSurface.css'), true);
  assert.doesNotMatch(workspace, /BrandPreviewSurface/u);
  assert.match(workspace, /ProductExperienceShell/u);
});

test('Yance login owns invitation and durable-device visual projection while Element keeps login-completion authority', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');

  assert.match(login, /data-yance-login-authority="v2"/u);
  assert.match(login, /data-yance-login-form-host="personal-access-invitation"/u);
  assert.match(login, /data-yance-invitation-login="jwt-element-on-logged-in"/u);
  assert.match(login, /data-yance-device-resume="unkey-status-element-on-logged-in"/u);
  assert.match(login, /已授权设备登录/u);
  assert.match(login, /已授权设备可直接进入；首次使用请输入邀请码/u);
  assert.match(login, /欢迎回来/u);
  assert.match(login, /让每一次沟通/u);
  assert.match(login, /yance-login-card/u);

  assert.match(styles, /\.yance-login-auth \.mx_AuthPage\s*\{/u);
  assert.match(styles, /\.yance-login-auth \.mx_AuthHeader,[\s\S]*?display:\s*none\s*!important/u);
  assert.match(styles, /\.yance-login-auth \.mx_AuthPage_modalBlur\s*\{[\s\S]*?display:\s*none\s*!important/u);
  assert.match(styles, /\.yance-login-auth \.mx_AuthBody\s*\{/u);
  assert.match(styles, /\.yance-login-auth \.mx_Login_submit/u);
  assert.match(styles, /#2a0f4a/iu);

  assert.match(
    moduleIndex,
    /registerLoginComponent\s*\([\s\S]*?\(props\)\s*=>\s*<YanceLogin onLoggedIn=\{props\.onLoggedIn\}/u
  );

  // Initial and resumed login must enter through Element's CustomLoginComponentProps.onLoggedIn public seam.
  assert.match(login, /onLoggedIn\(result\.accountAuth\)/u);
  assert.doesNotMatch(login, /await\s+overwriteAccountAuth\s*\(|overwriteAccountAuth\s*\(result\.accountAuth\)/u);
  assert.doesNotMatch(moduleIndex, /YanceAccountAuthApi|accountAuthApi/u);
  assert.doesNotMatch(moduleIndex, /overwriteAccountAuth/u);
  assert.doesNotMatch(moduleIndex, /desktop\.logoutPersonalAccess/u, 'Element session logout must leave durable device entitlement untouched');
  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /m\.login\.password/u);
});

test('successful invitation or device-resume handoff cannot reopen a second submission window', () => {
  const login = read('integration/element-module/src/YanceLogin.tsx');
  assert.match(login, /submissionInFlightRef\s*=\s*React\.useRef\(false\)/u);
  assert.match(login, /handoffCommittedRef\s*=\s*React\.useRef\(false\)/u);
  assert.match(login, /if \(submissionInFlightRef\.current \|\| handoffCommittedRef\.current\) return/u);
  assert.match(login, /submissionInFlightRef\.current = true/u);
  assert.match(login, /handoffAccepted = true/u);
  assert.match(login, /handoffCommittedRef\.current = true/u);
  assert.match(login, /if \(!handoffAccepted\)\s*\{[\s\S]*?submissionInFlightRef\.current = false[\s\S]*?setSubmitting\(false\)/u);
  assert.match(login, /disabled=\{submitting \|\| handoffCommitted\}/u);
  assert.match(login, /正在确认本机授权/u);
  assert.match(login, /正在进入言策/u);
});

test('Yance login does not expose local Matrix account creation or raw Element password controls', () => {
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');
  const preload = read('electron/preload.js');

  assert.match(login, /data-yance-login-form-host="personal-access-invitation"/u);
  assert.match(login, /loginPersonalAccess/u);
  assert.match(login, /onLoggedIn/u);
  assert.doesNotMatch(login, /data-yance-local-matrix-identity="first-use"/u);
  assert.doesNotMatch(login, /getMatrixLocalIdentity/u);
  assert.doesNotMatch(login, /createMatrixLocalIdentity/u);
  assert.doesNotMatch(login, /请用同一密码在下方登录/u);
  assert.match(styles, /\.yance-login-local-identity\s*\{/u);
  assert.doesNotMatch(preload, /getMatrixLocalIdentity|createMatrixLocalIdentity/u);

  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /m\.login\.password/u);
});

test('Element auth surface routes anonymous startup to the registered Yance V2 login via login_for_welcome', () => {
  const elementConfig = JSON.parse(read('config/matrix/element-config.json'));
  const synapseConfig = read('config/matrix/synapse/homeserver.yaml');

  assert.match(
    synapseConfig,
    /^enable_registration:\s*false\s*$/mu,
    'Synapse production config must keep user registration disabled'
  );
  assert.equal(
    elementConfig.setting_defaults && elementConfig.setting_defaults['UIFeature.registration'],
    false,
    'Element production config must hide and guard registration UI when Synapse registration is disabled'
  );
  assert.equal(
    elementConfig.embedded_pages && elementConfig.embedded_pages.login_for_welcome,
    true,
    'element-config.json must enable embedded_pages.login_for_welcome'
  );
  assert.notEqual(
    elementConfig.setting_defaults && elementConfig.setting_defaults['UIFeature.passwordReset'],
    false,
    'Element password recovery must remain enabled while registration is disabled'
  );

  const moduleIndex = read('integration/element-module/src/index.tsx');
  const login = read('integration/element-module/src/YanceLogin.tsx');
  assert.match(moduleIndex, /registerLoginComponent\s*\(/u);
  assert.match(moduleIndex, /props\.onLoggedIn/u);
  assert.doesNotMatch(moduleIndex, /overwriteAccountAuth/u);
  // Authentication completion authority stays on Element's reviewed custom-login callback.
  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /m\.login\.password/u);
});

test('Yance Element module delivers all product styles through Element-native CSSStyleSheet authority', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  const vite = read('integration/element-module/vite.config.ts');
  const pkg = JSON.parse(read('integration/element-module/package.json'));

  assert.equal(
    pkg.devDependencies?.['@arcmantle/vite-plugin-import-css-sheet'],
    '^1.0.12'
  );
  assert.match(vite, /importCSSSheet/u);
  assert.match(vite, /plugins:\s*\[importCSSSheet\(\),\s*react\(\)\]/u);

  for (const css of [
    './BrandPreviewSurface.css',
    './LearningWorkspace.css',
    './MediaWorkspace.css',
    './PresenceWorkspace.css',
    './VoiceWorkspace.css',
    './YanceLogin.css',
    './product-experience/ProductExperienceShell.css'
  ]) {
    assert.ok(
      moduleIndex.includes(`from "${css}" with { type: "css" }`),
      `missing CSSStyleSheet authority import: ${css}`
    );
  }

  assert.match(moduleIndex, /document\.adoptedStyleSheets/u);
  assert.match(moduleIndex, /ELEMENT_YANCE_STYLE_AUTHORITY_MISSING/u);
  assert.doesNotMatch(moduleIndex, /createElement\(["']link["']\)/u);
});

test('forgot password remains Element protocol authority while Yance owns locale and visible auth surface', () => {
  const elementConfig = JSON.parse(read('config/matrix/element-config.json'));
  const styles = read('integration/element-module/src/YanceLogin.css');

  assert.equal(elementConfig.setting_defaults?.language, 'zh-hans');
  assert.equal(elementConfig.disable_login_language_selector, true);

  assert.match(styles, /YANCE_FORGOT_PASSWORD_AUTHORITY_V1/u);
  assert.match(styles, /mx_AuthBody_forgot-password/u);
  assert.match(styles, /mx_AuthPage:has/u);
  assert.match(styles, /#2a0f4a/iu);

  // Product styling must not clone or replace Matrix password-reset protocol.
  assert.doesNotMatch(styles, /_matrix\/client|requestResetToken|setNewPassword/u);
});

test('legacy Element English locale migrates once to Yance simplified Chinese default', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');

  assert.match(moduleIndex, /YANCE_LOCALE_MIGRATION_V2/u);
  assert.match(moduleIndex, /mx_local_settings/u);
  assert.match(moduleIndex, /zh-hans/u);
  assert.match(moduleIndex, /window\.location\.reload/u);
  assert.match(moduleIndex, /\["", "en", "en_EN", "en-US", "en-GB"\]\.includes\(currentLanguage\)/u);
  assert.match(moduleIndex, /=== "done"/u);
});

test('Yance owns post-login security presentation while Element keeps crypto and session authority', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');
  const patch = read('upstream-patches/element-web/0018-yance-post-login-security-shell.patch');

  assert.match(moduleIndex, /registerPostLoginSecurityComponent\?\.\(/u);
  assert.match(moduleIndex, /<YancePostLoginSecurity>\{content\}<\/YancePostLoginSecurity>/u);
  assert.match(login, /data-yance-post-login-security-authority="product"/u);
  assert.match(login, /data-yance-post-login-security-content="element"/u);
  assert.match(login, /保护你的安全登录/u);
  assert.match(login, /“设备”指一次受保护的加密登录会话/u);
  assert.match(login, /并不意味着你必须有另一台实体设备/u);
  assert.match(styles, /YANCE_POST_LOGIN_SECURITY_PROJECTION_V1/u);
  assert.match(styles, /\.yance-post-login-security-card\s*\{/u);
  assert.doesNotMatch(styles, /yance-post-login-security[^\n{]*mx_AuthPage|:has\([^)]*mx_CompleteSecurity|:has\([^)]*mx_AuthPage/iu);

  assert.match(patch, /SetupEncryptionStore/u);
  assert.match(patch, /SetupEncryptionBody/u);
  assert.match(patch, /InitialCryptoSetupDialog/u);
  assert.match(patch, /originalComponent/u);
  assert.doesNotMatch(login, /fetch\s*\(|_matrix\/client|m\.login\.password/u);
});