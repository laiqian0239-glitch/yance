'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const {
  NamedRuntimeMutex,
  RuntimeMutexSet,
  legacyRuntimeMutexName,
  portableEndpointForName,
  portablePortForName,
  runtimeMutexName
} = require('../../backend/runtime/NamedRuntimeMutex');

function findHistoricalPortCollision() {
  const byPort = new Map();
  for (let index = 0; index < 20000; index += 1) {
    const name = `Local\\Yance.PortableCollision.${index}`;
    const port = portablePortForName(name);
    const prior = byPort.get(port);
    if (prior && portableEndpointForName(prior).host !== portableEndpointForName(name).host) {
      return [prior, name];
    }
    byPort.set(port, name);
  }
  throw new Error('Unable to construct a historical portable-port collision');
}

test('portable runtime mutex separates distinct names that share the historical 7,000-port hash', async () => {
  const [firstName, secondName] = findHistoricalPortCollision();
  const firstEndpoint = portableEndpointForName(firstName);
  const secondEndpoint = portableEndpointForName(secondName);

  assert.equal(firstEndpoint.port, secondEndpoint.port);
  assert.notEqual(firstEndpoint.host, secondEndpoint.host);
  assert.match(firstEndpoint.host, /^127\./);
  assert.match(secondEndpoint.host, /^127\./);

  const first = new NamedRuntimeMutex({ name: firstName, platform: 'linux' });
  const second = new NamedRuntimeMutex({ name: secondName, platform: 'linux' });
  try {
    await first.acquire();
    await second.acquire();
    assert.equal(first.held, true);
    assert.equal(second.held, true);
  } finally {
    await second.release();
    await first.release();
  }
});


async function foreignListenerOnHistoricalPort() {
  for (let index = 0; index < 2000; index += 1) {
    const name = `Local\Yance.PortableForeignListener.${process.pid}.${index}`;
    const endpoint = portableEndpointForName(name);
    if (endpoint.host === '127.0.0.1') continue;
    const server = net.createServer();
    const listening = await new Promise(resolve => {
      server.once('error', () => resolve(false));
      server.listen({ host: '127.0.0.1', port: endpoint.port, exclusive: true }, () => resolve(true));
    });
    if (listening) return { name, endpoint, server };
    try { server.close(); } catch (_) {}
  }
  throw new Error('Unable to reserve a historical portable mutex port for the foreign-listener regression');
}

test('an unrelated 127.0.0.1 listener on the historical port is not mistaken for the same runtime owner', async () => {
  const fixture = await foreignListenerOnHistoricalPort();
  const mutex = new NamedRuntimeMutex({ name: fixture.name, platform: 'linux' });
  try {
    await mutex.acquire();
    assert.equal(mutex.held, true);
    assert.notEqual(fixture.endpoint.host, '127.0.0.1');
  } finally {
    await mutex.release();
    await new Promise(resolve => fixture.server.close(resolve));
  }
});

test('portable runtime mutex still denies a second owner of the exact same name', async () => {
  const name = `Local\\Yance.PortableSameName.${process.pid}.${Date.now()}`;
  const first = new NamedRuntimeMutex({ name, platform: 'linux' });
  const second = new NamedRuntimeMutex({ name, platform: 'linux' });
  try {
    await first.acquire();
    await assert.rejects(
      second.acquire(),
      error => error?.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD' && error?.failedPhase === 'runtime_ownership'
    );
  } finally {
    await second.release();
    await first.release();
  }
});


test('new and legacy brand mutexes share the same path hash but use distinct bounded prefixes', () => {
  const identity = `fixture:${process.pid}:${Date.now()}`;
  const current = runtimeMutexName(identity);
  const legacy = legacyRuntimeMutexName(identity);
  assert.match(current, /^Local\\Yance\.AppRuntime\.[a-f0-9]{24}$/);
  assert.match(legacy, /^Local\\Yance29\.AppRuntime\.[a-f0-9]{24}$/);
  assert.equal(current.split('.').at(-1), legacy.split('.').at(-1));
});

test('Yance runtime mutex set blocks a legacy-brand owner for the same data identity', async () => {
  const identity = `compatibility:${process.pid}:${Date.now()}`;
  const currentName = runtimeMutexName(identity);
  const legacyName = legacyRuntimeMutexName(identity);
  const active = new RuntimeMutexSet({ names: [currentName, legacyName], platform: 'linux' });
  const legacyContender = new NamedRuntimeMutex({ name: legacyName, platform: 'linux' });
  try {
    const snapshot = await active.acquire();
    assert.equal(snapshot.held, true);
    assert.deepEqual(snapshot.compatibilityNames, [legacyName]);
    await assert.rejects(legacyContender.acquire(), error => error?.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
  } finally {
    await legacyContender.release();
    await active.release();
  }
});

test('compatibility mutex acquisition failure releases the already acquired new-brand mutex', async () => {
  const identity = `rollback:${process.pid}:${Date.now()}`;
  const currentName = runtimeMutexName(identity);
  const legacyName = legacyRuntimeMutexName(identity);
  const legacyOwner = new NamedRuntimeMutex({ name: legacyName, platform: 'linux' });
  const set = new RuntimeMutexSet({ names: [currentName, legacyName], platform: 'linux' });
  const newBrandTakeover = new NamedRuntimeMutex({ name: currentName, platform: 'linux' });
  try {
    await legacyOwner.acquire();
    await assert.rejects(set.acquire(), error => error?.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD');
    await newBrandTakeover.acquire();
    assert.equal(newBrandTakeover.held, true);
  } finally {
    await newBrandTakeover.release();
    await set.release();
    await legacyOwner.release();
  }
});
