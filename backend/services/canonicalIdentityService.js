'use strict';

const authority = require('./identityAuthority');

module.exports = {
  identityAuthority: authority.singleton,
  IdentityAuthority: authority.IdentityAuthority,
  canonicalExternalIdentityScope: authority.canonicalExternalIdentityScope,
  canonicalPersonId: authority.canonicalPersonId,
  canonicalIdentityLinkId: authority.canonicalIdentityLinkId,
  canonicalizeWhatsAppAccounts: (...args) => authority.singleton.canonicalizeWhatsAppAccounts(...args),
  resolveCanonicalAccountId: (...args) => authority.singleton.resolveCanonicalAccountId(...args),
  accountIdentityAliases: (...args) => authority.singleton.accountIdentityAliases(...args),
  buildGroups: (...args) => authority.singleton.buildGroups(...args),
  canonicalScore: (...args) => authority.singleton.canonicalScore(...args)
};
