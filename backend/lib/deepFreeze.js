'use strict';

function isFreezable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isFreezable(value) || seen.has(value)) return value;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }

  return Object.freeze(value);
}

module.exports = Object.freeze({
  deepFreeze
});
