'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { disposeEventSocket } = require('../../electron/eventSocketLifecycle');

const STATES = Object.freeze({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

class ConnectingSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = STATES.CONNECTING;
    this.terminated = false;
  }
  terminate() {
    this.terminated = true;
    queueMicrotask(() => {
      this.emit('error', new Error('WebSocket was closed before the connection was established'));
      this.readyState = STATES.CLOSED;
      this.emit('close');
    });
  }
}

class OpenSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = STATES.OPEN;
    this.closed = false;
  }
  close() {
    this.closed = true;
    this.readyState = STATES.CLOSING;
  }
}

test('controlled restart safely retires a CONNECTING event socket without an uncaught asynchronous ws error', async () => {
  const socket = new ConnectingSocket();
  let staleReconnectCalled = false;
  socket.on('close', () => { staleReconnectCalled = true; });
  const result = disposeEventSocket(socket, STATES);
  assert.deepEqual(result, { disposed: true, action: 'terminate-connecting', initialReadyState: STATES.CONNECTING });
  assert.equal(socket.terminated, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.readyState, STATES.CLOSED);
  assert.equal(staleReconnectCalled, false, 'retired socket must not schedule a stale reconnect');
  assert.ok(socket.listenerCount('error') >= 1, 'retired CONNECTING socket must retain an error consumer');
});

test('controlled restart closes an OPEN event socket after removing stale application listeners', () => {
  const socket = new OpenSocket();
  let staleCloseCalled = false;
  socket.on('close', () => { staleCloseCalled = true; });
  const result = disposeEventSocket(socket, STATES);
  assert.deepEqual(result, { disposed: true, action: 'close-open', initialReadyState: STATES.OPEN });
  assert.equal(socket.closed, true);
  socket.emit('close');
  assert.equal(staleCloseCalled, false);
});
