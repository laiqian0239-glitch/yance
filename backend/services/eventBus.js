'use strict';

const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  publish(type, payload = {}) {
    const event = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, at: new Date().toISOString(), payload };
    this.emit('event', event);
    this.emit(type, event);
    return event;
  }
}

module.exports = new EventBus();
