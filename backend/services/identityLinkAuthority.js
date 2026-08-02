'use strict';

const authority = require('./identityAuthority');

module.exports = {
  ...authority,
  IdentityLinkAuthority: authority.IdentityAuthority,
  singleton: authority.singleton
};
