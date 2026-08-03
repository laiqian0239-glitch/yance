'use strict';

const core = require('./externalActionOutboxAuthorityCore');

const externalActionOutboxAuthority = new core.ExternalActionOutboxAuthority();

module.exports = externalActionOutboxAuthority;
for (const [name, value] of Object.entries(core)) {
  Object.defineProperty(module.exports, name, {
    value,
    enumerable: true,
    writable: false,
    configurable: false
  });
}
Object.freeze(module.exports);
