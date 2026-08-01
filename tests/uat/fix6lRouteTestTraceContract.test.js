'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

test('route test UI creates and sends one routeTestId and surfaces it in user-visible evidence', () => {
  const runtime = fs.readFileSync(path.join(root, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(runtime, /function createRouteTestId\(\)/u);
  assert.match(runtime, /routeTestId=createRouteTestId\(\)/u);
  assert.match(runtime, /JSON\.stringify\(\{routeTestId,routeDraft:/u);
  assert.match(runtime, /payload\.routeTestId\|\|routeTestId/u);
  assert.match(runtime, /追踪号/u);
});

test('route test backend accepts the client trace id and returns the authoritative id', () => {
  const routes = fs.readFileSync(path.join(root, 'backend/routes/models.js'), 'utf8');
  assert.match(routes, /routeTestId:\s*String\(req\.body\?\.routeTestId/u);
  assert.match(routes, /routeTestId:\s*result\.routeTestId/u);
  assert.match(routes, /candidateExecutionService\.execute/u);
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  assert.match(server, /routeTestId:\s*String\(error\.routeTestId/u);
});
