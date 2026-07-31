'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rl = require('../../electron/m2/releaseLayout');
const plr = require('../../electron/m2/packagedLaunchResolver');

const RES = 'C:/Program Files/Yance/resources';
const norm = (p) => String(p).split('\\').join('/');

test('releaseLayout: production 按 resources/app 解析（与 M2 resolver 一致）', () => {
  const r = rl.resolveLayoutPaths('production', { resourcesPath: RES });
  assert.strictEqual(norm(r.appRoot), 'C:/Program Files/Yance/resources/app');
  assert.strictEqual(norm(r.backendEntry), 'C:/Program Files/Yance/resources/app/backend/desktopHostedEntry.js');
  assert.strictEqual(norm(r.nodeModules), 'C:/Program Files/Yance/resources/app/node_modules');
  assert.strictEqual(norm(r.nodeRuntime), 'C:/Program Files/Yance/resources/runtime/node22/node.exe');
  assert.strictEqual(r.isPackaged, true);
});

test('releaseLayout: dev 模式 appRoot 退化为 resourcesPath（项目根）', () => {
  const r = rl.resolveLayoutPaths('dev', { resourcesPath: 'D:/code/yance' });
  assert.strictEqual(r.appRoot, 'D:/code/yance');
  assert.strictEqual(r.isPackaged, false);
});

test('releaseLayout: unknown mode 抛错', () => {
  assert.throws(() => rl.resolveLayoutPaths('staging', { resourcesPath: RES }), /Unknown release layout mode/);
});

test('validateLayout: 全部存在 → valid true', () => {
  const res = rl.validateLayout('production', { resourcesPath: RES }, { existsSync: () => true });
  assert.strictEqual(res.valid, true);
  assert.deepStrictEqual(res.missingKeys, []);
  assert.strictEqual(res.presentKeys.length, 3);
});

test('validateLayout: 缺失 backendEntry → valid false 且报告 missingKeys', () => {
  const existsSync = (p) => !/[\\/]backend[\\/]desktopHostedEntry\.js$/.test(p);
  const res = rl.validateLayout('production', { resourcesPath: RES }, { existsSync });
  assert.strictEqual(res.valid, false);
  assert.deepStrictEqual(res.missingKeys, ['backendEntry']);
  assert.strictEqual(norm(res.missing[0].path), norm('C:/Program Files/Yance/resources/app/backend/desktopHostedEntry.js'));
});

test('validateLayout: 无 existsSync 时全部归为 missing（不抛）', () => {
  const res = rl.validateLayout('production', { resourcesPath: RES });
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.missingKeys.length, 3);
});

test('M2 resolver 消费 M6 契约：resolveBackendLaunchPaths 代理一致', () => {
  const prod = plr.resolveBackendLaunchPaths({ resourcesPath: RES, isPackaged: true });
  const viaContract = rl.resolveLayoutPaths('production', { resourcesPath: RES });
  assert.strictEqual(norm(prod.backendEntry), norm(viaContract.backendEntry));
  assert.strictEqual(norm(prod.nodeRuntime), norm(viaContract.nodeRuntime));
  assert.strictEqual(prod.isPackaged, viaContract.isPackaged);
});

test('M2 resolver PRODUCTION_LAYOUT 即 M6 契约 production', () => {
  assert.strictEqual(plr.PRODUCTION_LAYOUT, rl.LAYOUTS.production);
});
