'use strict';

const legacyCanonicalIdentity = require('../repositories/canonicalIdentityRepository');
const authority = require('./identityAuthority');

module.exports = {
  ...legacyCanonicalIdentity,
  identityAuthority: authority.singleton,
  IdentityAuthority: authority.IdentityAuthority,
  canonicalExternalIdentityScope: authority.canonicalExternalIdentityScope,
  canonicalPersonId: authority.canonicalPersonId,
  canonicalIdentityLinkId: authority.canonicalIdentityLinkId
};
