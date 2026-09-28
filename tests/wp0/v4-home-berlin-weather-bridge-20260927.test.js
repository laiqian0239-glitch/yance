'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Berlin weather is projected through the existing read-only desktop bridge', () => {
  const system = read('backend/routes/system.js');
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');
  const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
  const types = read('integration/element-module/src/product-experience/experienceTypes.ts');

  assert.match(system, /berlinWeatherService/u);
  assert.match(system, /router\.get\(['"]\/weather\/berlin['"]/u);
  assert.match(bridge, /systemBerlinWeather:\s*['"]store:system-berlin-weather['"]/u);
  assert.match(bridge, /\/api\/r32\/system\/weather\/berlin/u);
  assert.match(preload, /getBerlinWeather:\s*\(\)\s*=>\s*invokeStore\(['"]store:system-berlin-weather['"]/u);
  assert.match(projection, /getBerlinWeather:\s*\(\)\s*=>\s*Promise<Record<string, unknown>>/u);
  assert.match(projection, /export async function loadBerlinWeather\(\)/u);
  assert.match(types, /export type BerlinWeatherProjection/u);
});
