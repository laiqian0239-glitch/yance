'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(ROOT, 'installer/wp7/YanceFinalInstaller.nsi'), 'utf8');

test('finish page offers a default checked public-brand Run action', () => {
  assert.match(script, /!define\s+MUI_FINISHPAGE_RUN\b/);
  assert.match(script, /!define\s+MUI_FINISHPAGE_RUN_TEXT\s+"运行\$\{PUBLIC_PRODUCT_NAME\}"/);
  assert.match(script, /!define\s+MUI_FINISHPAGE_RUN_FUNCTION\s+"LaunchYance"/);
});

test('finish action launches the installed app with explicit post-install intent', () => {
  const launch = script.match(/Function\s+LaunchYance([\s\S]*?)FunctionEnd/)?.[1] || '';
  assert.ok(launch.includes("Exec '\"$INSTDIR\\${PRODUCT_EXECUTABLE_NAME}\" --post-install'"));
  assert.match(launch, /IfErrors\s+post_install_launch_failed\s+post_install_launch_started/);
  assert.doesNotMatch(launch, /Call\s+WaitForPostInstallLaunch/);
  assert.match(script, /RequestExecutionLevel\s+user/);
});
test('silent installs and unchecked finish action do not have an unconditional Section launch', () => {
  const installSection = script.match(/Section\s+"Install"([\s\S]*?)SectionEnd/)?.[1] || '';
  assert.doesNotMatch(installSection, /Exec(?:Shell)?\s+.*Yance\.exe/i);
});


test('installer process shutdown is image-name based and does not rely on a localized window title', () => {
  assert.doesNotMatch(script, /FindWindow[\s\S]*"Yance"/);
  assert.match(script, /nsExec::ExecToStack 'taskkill \/IM \$\{IMAGE_NAME\} \/T \/F'/);
  assert.match(script, /!insertmacro StopImageOrAbort "\$\{PRODUCT_EXECUTABLE_NAME\}" "yance_current"/);
  assert.match(script, /StrCmp \$0 "128" \$\{DISPLAY_LABEL\}_not_running/);
  assert.match(script, /安装已中止/);
});

test('Finish-page launch failure is visible instead of silently closing the installer', () => {
  assert.match(script, /ClearErrors[\s\S]*IfErrors\s+post_install_launch_failed\s+post_install_launch_started/);
  assert.match(script, /安装已经完成，但\$\{PUBLIC_PRODUCT_NAME\}未能自动启动/);
});


test('Finish-page launch ends installer authority after process creation succeeds', () => {
  const launch = script.match(/Function\s+LaunchYance([\s\S]*?)FunctionEnd/)?.[1] || '';
  assert.doesNotMatch(script, /Function\s+WaitForPostInstallLaunch/u);
  assert.doesNotMatch(script, /Call\s+WaitForPostInstallLaunch/u);
  assert.doesNotMatch(script, /post_install_wait_/u);
  assert.doesNotMatch(script, /post_install_stale_evidence/u);
  assert.doesNotMatch(script, /post-install-launch\.pass/u);
  assert.doesNotMatch(script, /post-install-launch\.json/u);
  assert.doesNotMatch(script, /IntCmp \$R0 180/u);
  assert.doesNotMatch(script, /主窗口可见且运行时就绪的 PASS 回执/u);
  assert.doesNotMatch(script, /主窗口可见且运行时就绪/u);
  assert.doesNotMatch(script, /启动超时/u);
  assert.match(launch, /post_install_launch_started:\s*[\r\n]+\s*Return/u);
  assert.doesNotMatch(script, /post_install_receipt_seen/);
});
