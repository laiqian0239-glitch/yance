'use strict';

const test = require('node:test');
const assert = require('node:assert');
const plr = require('../../electron/m2/packagedLaunchResolver');

const RES = 'C:/Program Files/Yance/resources';
const norm = (p) => String(p).split('\\').join('/');

test('resolveBackendLaunchPaths: packaged 按 resources/app 解析', () => {
  const r = plr.resolveBackendLaunchPaths({ resourcesPath: RES, isPackaged: true });
  assert.strictEqual(norm(r.appRoot), 'C:/Program Files/Yance/resources/app');
  assert.strictEqual(norm(r.backendEntry), 'C:/Program Files/Yance/resources/app/backend/desktopHostedEntry.js');
  assert.strictEqual(norm(r.nodeModules), 'C:/Program Files/Yance/resources/app/node_modules');
  assert.strictEqual(norm(r.nodeRuntime), 'C:/Program Files/Yance/resources/runtime/node22/node.exe');
  assert.strictEqual(r.isPackaged, true);
});

test('resolveBackendLaunchPaths: dev 模式用项目根', () => {
  const r = plr.resolveBackendLaunchPaths({ resourcesPath: 'D:/code/yance', isPackaged: false });
  assert.strictEqual(r.appRoot, 'D:/code/yance');
});

test('verifyPathsExist: packaged 缺失路径抛结构化错误（绝不 fallback）', () => {
  const r = plr.resolveBackendLaunchPaths({ resourcesPath: RES, isPackaged: true });
  // 模拟 backendEntry 缺失；分隔符无关（Windows 下 path.join 产出反斜杠）。
  const existsSync = (p) => !/[\\/]backend[\\/]desktopHostedEntry\.js$/.test(p);
  let err;
  try {
    plr.verifyPathsExist(r, { existsSync, isPackaged: true, devFallbackAttempted: true });
  } catch (e) {
    err = e;
  }
  assert.ok(err, '应抛错');
  assert.strictEqual(err.errorCode, 'M2_PACKAGED_LAUNCH_PATH_UNRESOLVED');
  assert.strictEqual(err.reasonCode, 'M2_PACKAGED_LAUNCH_DEV_FALLBACK_DENIED');
  assert.deepStrictEqual(err.missingPaths, ['backendEntry']);
  assert.strictEqual(err.isPackaged, true);
});

test('verifyPathsExist: packaged 全部存在返回 allPresent=true', () => {
  const r = plr.resolveBackendLaunchPaths({ resourcesPath: RES, isPackaged: true });
  const existsSync = () => true;
  const res = plr.verifyPathsExist(r, { existsSync, isPackaged: true });
  assert.strictEqual(res.allPresent, true);
  assert.deepStrictEqual(res.missing, []);
});

test('verifyPathsExist: dev 模式缺失不抛错（返回 missing）', () => {
  const r = plr.resolveBackendLaunchPaths({ resourcesPath: 'D:/code/yance', isPackaged: false });
  const existsSync = () => false;
  const res = plr.verifyPathsExist(r, { existsSync, isPackaged: false });
  assert.strictEqual(res.allPresent, false);
  assert.ok(res.missing.length > 0);
});
