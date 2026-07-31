'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeArtifactBootstrapService } = require('../services/runtimeArtifactBootstrapService');
const { RuntimeArtifactRegistryService, defaultDocument } = require('../services/runtimeArtifactRegistryService');

class MemoryStore {
  constructor() { this.value = defaultDocument(); }
  read() { return structuredClone(this.value); }
  async updateAsync(updater) { this.value = await updater(structuredClone(this.value)); return this.read(); }
}
function write(root, relative, content = relative) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('runtime bootstrap records current commercial product artifacts and makes the second run idempotent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-artifact-bootstrap-'));
  const cacheRoot = path.join(root, 'data-cache');
  const registry = new RuntimeArtifactRegistryService({ store: new MemoryStore(), pointerPath: path.join(root, 'selection.json') });
  try {
    write(root, 'package.json', JSON.stringify({ name: 'yance-desktop', version: '1.0.0' }));
    write(root, 'frontend/index.html', '<main>Yance</main>');
    write(root, 'frontend/theme-catalog.json', JSON.stringify({ themes: [{ id: 'default' }] }));
    write(root, 'frontend/assets/sounds/message.wav', 'sound');
    write(root, 'backend/persona/presets/yeonhee-kim-v1.json', JSON.stringify({ profileId: 'owner' }));
    for (const file of ['facebookAdapter.js', 'whatsappAdapter.js', 'telegramAdapter.js', 'platformCapabilities.js', 'platformMessagingService.js']) write(root, `backend/services/${file}`, file);
    write(root, 'tools/facebook-business-suite-avatar-importer/manifest.json', JSON.stringify({ version: '1.1.0' }));
    const fakeModels = {
      read: () => ({ models: [{ id: 'm1', provider: 'openrouter', name: 'model', qualification: 'verified', allowedTasks: ['director'] }], routes: { director: { enabled: true, primaryModelId: 'm1', fallbackModelId: '' } } })
    };
    const service = new RuntimeArtifactBootstrapService({ registry, root, cacheRoot, modelRegistry: fakeModels, logger: { warn() {} } });
    const first = await service.bootstrap();
    assert.equal(first.ok, true);
    assert.equal(first.registered.length, 8);
    assert.deepEqual(Object.keys(registry.snapshot().current).sort(), [
      'ai-routing', 'application', 'facebook-web-companion', 'frontend-static', 'notification-sound-catalog', 'persona-assets', 'platform-adapter', 'theme-catalog'
    ]);
    assert.deepEqual(registry.snapshot().lastKnownGood, {});

    const second = await service.bootstrap();
    assert.equal(second.ok, true);
    assert.equal(second.registered.every(row => row.changed === false), true);
    assert.deepEqual(registry.snapshot().lastKnownGood, {});

    fakeModels.read = () => ({ models: [{ id: 'm2', provider: 'openrouter', name: 'new-model', qualification: 'verified', allowedTasks: ['director'] }], routes: { director: { enabled: true, primaryModelId: 'm2', fallbackModelId: 'm1' } } });
    const third = await service.bootstrap();
    assert.equal(third.ok, true);
    const artifactState = registry.snapshot();
    assert.notEqual(artifactState.current['ai-routing'].artifactId, artifactState.lastKnownGood['ai-routing'].artifactId);
    assert.notEqual(artifactState.current['ai-routing'].rootPath, artifactState.lastKnownGood['ai-routing'].rootPath);
    assert.equal(fs.existsSync(artifactState.lastKnownGood['ai-routing'].rootPath), true, 'last-known-good routing snapshot must remain immutable and hash-verifiable');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
