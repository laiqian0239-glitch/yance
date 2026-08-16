'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const people = () => read('integration/element-module/src/product-experience/PeopleSurface.tsx');
const css = () => read('integration/element-module/src/product-experience/ProductExperienceShell.css');
const packageJson = () => JSON.parse(read('integration/element-module/package.json'));

function loadUniversePosition(source) {
  const start = source.indexOf('function universePosition');
  const end = source.indexOf('\n\nexport function PeopleSurface', start);
  assert.notEqual(start, -1, 'PeopleSurface must define universePosition');
  assert.notEqual(end, -1, 'universePosition must remain isolated from the component body');
  const executable = source
    .slice(start, end)
    .replace(
      'function universePosition(index: number, count: number): UniversePosition',
      'function universePosition(index, count)',
    );
  return Function(`"use strict"; ${executable}; return universePosition;`)();
}

function minimumDistance(points) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const dx = points[left].x - points[right].x;
      const dy = points[left].y - points[right].y;
      minimum = Math.min(minimum, Math.hypot(dx, dy));
    }
  }
  return minimum;
}

function minimumPixelDistance(points, width, height) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const dx = ((points[left].x - points[right].x) / 100) * width;
      const dy = ((points[left].y - points[right].y) / 100) * height;
      minimum = Math.min(minimum, Math.hypot(dx, dy));
    }
  }
  return minimum;
}

test('People Home defaults to list and exposes an explicit relationship universe peer view', () => {
  const shellSource = shell();
  const peopleSource = people();
  assert.match(shellSource, /peopleHomeView/u);
  assert.match(shellSource, /useState<PeopleHomeView>\("list"\)/u);
  assert.match(peopleSource, /viewMode/u);
  assert.match(peopleSource, /onViewModeChange/u);
  assert.match(peopleSource, />\s*列表\s*</u);
  assert.match(peopleSource, />\s*关系宇宙\s*</u);
  assert.doesNotMatch(shellSource, /useState<PeopleHomeView>\("universe"\)/u);
});

test('relationship universe is user-centered and does not invent contact-to-contact graph authority', () => {
  const source = people();
  assert.match(source, /yance-relationship-universe/u);
  assert.match(source, />\s*我\s*</u);
  assert.match(source, /relationships\.map/u);
  assert.match(source, /focusedRelationshipId/u);
  assert.match(source, /relationship\.relationshipIntelligence/u);
  assert.match(source, /进入关系世界/u);
  assert.doesNotMatch(source, /relationshipPotential|affection|closeness|compatibility|influence|priorityScore/iu);
  assert.doesNotMatch(source, /sourceId|targetId|personToPerson|contactEdges|socialGraph/iu);
});

test('relationship universe keeps dense 21 and 33 relationship controls collision-free on a narrow stage', () => {
  const peopleSource = people();
  const positionFor = loadUniversePosition(peopleSource);
  for (const count of [21, 33]) {
    const positions = Array.from({ length: count }, (_, index) => positionFor(index, count));
    assert.ok(
      minimumDistance(positions) >= 8,
      `${count} relationship nodes must keep at least 8 normalized stage units between centers`,
    );
    assert.ok(
      minimumPixelDistance(positions, 320, 430) >= 42,
      `${count} relationship controls must keep at least 42px between centers on a conservative 320x430 stage`,
    );
    for (const position of positions) {
      assert.ok(position.x >= 5 && position.x <= 95, `${count} relationship node x must remain bounded`);
      assert.ok(position.y >= 5 && position.y <= 95, `${count} relationship node y must remain bounded`);
    }
  }
  assert.match(peopleSource, /denseUniverse\s*=\s*relationships\.length\s*>\s*8/u);
  assert.match(peopleSource, /data-dense=\{denseUniverse\s*\|\|\s*undefined\}/u);
  assert.match(peopleSource, /denseUniverse\s*\?\s*\{[\s\S]{0,220}width:\s*"40px"[\s\S]{0,220}height:\s*"40px"/u);
  assert.match(peopleSource, /denseUniverse\s*\?\s*null\s*:\s*\(/u);
});

test('universe focus is separate from relationship selection and survives Relationship World round trips', () => {
  const source = shell();
  assert.match(source, /focusedRelationshipId/u);
  assert.match(source, /setFocusedRelationshipId/u);
  assert.match(source, /onFocus=\{setFocusedRelationshipId\}/u);
  assert.match(source, /onSelect=\{chooseRelationship\}/u);
  assert.match(source, /clearSelectedRelationship/u);
  assert.doesNotMatch(source, /setPeopleHomeView\("list"\)[\s\S]{0,180}clearSelectedRelationship/u);
});

test('normal Product relationship chrome is Chinese and graph dependencies are not added', () => {
  const source = `${shell()}\n${people()}`;
  assert.match(source, /我的关系/u);
  assert.match(source, /体验设置/u);
  assert.match(source, /正在加载关系|关系数据暂不可用/u);
  const manifest = packageJson();
  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
    ...(manifest.optionalDependencies || {}),
    ...(manifest.peerDependencies || {}),
  };
  for (const dependency of ['sigma', 'graphology', 'cytoscape', '@xyflow/react', 'd3-force']) {
    assert.equal(Object.hasOwn(dependencies, dependency), false, `${dependency} must not be added for this P0`);
  }
});

test('universe presentation uses existing Product motion and reduced-motion contracts only', () => {
  const source = `${people()}\n${css()}`;
  assert.match(source, /motion\.button/u);
  assert.match(source, /reducedMotion/u);
  assert.match(source, /yance-relationship-universe/u);
  assert.doesNotMatch(source, /setInterval\s*\(|requestAnimationFrame\s*\(|forceSimulation\s*\(/u);
});
