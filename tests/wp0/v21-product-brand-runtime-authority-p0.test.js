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

test('Yance login owns final product visual authority while preserving Element auth authority', () => {
  const moduleIndex = read('integration/element-module/src/index.tsx');
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');

  assert.match(login, /data-yance-login-authority="v2"/u);
  assert.match(login, /data-yance-login-form-host="element-auth"/u);
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
    /registerLoginComponent\s*\([\s\S]*?originalComponent\(props\)/u
  );

  // Authentication remains on Element's reviewed login implementation.
  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /m\.login\.password/u);
  assert.doesNotMatch(login, /accessToken/u);
});

test('Yance login first-use setup creates only a local Matrix identity and keeps Element as login authority', () => {
  const login = read('integration/element-module/src/YanceLogin.tsx');
  const styles = read('integration/element-module/src/YanceLogin.css');
  const preload = read('electron/preload.js');

  assert.match(login, /data-yance-local-matrix-identity="first-use"/u);
  assert.match(login, /getMatrixLocalIdentity/u);
  assert.match(login, /createMatrixLocalIdentity/u);
  assert.match(login, /请用同一密码在下方登录/u);
  assert.match(login, /data-yance-login-form-host="element-auth"[\s\S]*?\{children\}/u);
  assert.match(styles, /\.yance-login-local-identity\s*\{/u);
  assert.match(preload, /getMatrixLocalIdentity/u);
  assert.match(preload, /createMatrixLocalIdentity/u);

  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /m\.login\.password/u);
  assert.doesNotMatch(login, /accessToken/u);
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
  assert.match(moduleIndex, /originalComponent\(props\)/u);
  // Authentication authority stays on Element's reviewed login implementation.
  assert.doesNotMatch(login, /fetch\s*\(/u);
  assert.doesNotMatch(login, /_matrix\/client/u);
  assert.doesNotMatch(login, /accessToken/u);
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
  assert.match(moduleIndex, /currentLanguage === "en"/u);
  assert.match(moduleIndex, /=== "done"/u);
});
