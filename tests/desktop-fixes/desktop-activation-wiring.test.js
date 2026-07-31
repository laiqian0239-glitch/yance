'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.js'), 'utf8');

test('all desktop activation entry points use activateMainWindow', () => {
  assert.match(main, /function\s+activateMainWindow\s*\(/);
  for (const reason of [
    'tray-menu-show', 'second-instance', 'app-activate', 'post-install',
    'notification-click', 'deep-link'
  ]) assert.match(main, new RegExp(`activateMainWindow\\([^\\n]*['\"]${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(main, /const activate = eventName =>[\s\S]*activateMainWindow\(eventName\)/);
  assert.match(main, /tray\.on\('click', \(\) => activate\('tray-click'\)\)/);
  assert.match(main, /tray\.on\('double-click', \(\) => activate\('tray-double-click'\)\)/);
});

test('renderer activation requires explicit preload and renderer readiness handshakes', () => {
  assert.match(preload, /ipcRenderer\.send\('desktop:preload-ready'/);
  assert.match(preload, /DOMContentLoaded[\s\S]*ipcRenderer\.send\('desktop:renderer-ready'/);
  assert.match(preload, /onActivation:\s*callback\s*=>\s*on\('desktop:activation'/);
  assert.match(main, /ipcMain\.on\('desktop:preload-ready'/);
  assert.match(main, /ipcMain\.on\('desktop:renderer-ready'/);
});

test('window rebuild handlers are bound to the created window and cannot clear a replacement', () => {
  assert.match(main, /const createdWindow = new BrowserWindow/);
  assert.match(main, /createdWindow\.on\('closed',[\s\S]*if \(mainWindow === createdWindow\)[\s\S]*mainWindow = null/);
  assert.match(main, /if \(mainWindow !== createdWindow \|\| createdWindow\.isDestroyed\(\)\) return/);
});

test('desktop process owns only one tray construction site', () => {
  assert.equal((main.match(/new Tray\(/g) || []).length, 1);
});
