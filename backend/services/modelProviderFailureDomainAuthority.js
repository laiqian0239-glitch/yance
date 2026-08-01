'use strict';

const AUTHORITY = 'ModelProviderFailureDomainAuthority';
const SCHEMA_VERSION = 1;

function clean(value) { return String(value == null ? '' : value).trim(); }

function providerFailureDomain(model = {}) {
  const explicit = clean(model.failureDomain || model.providerFailureDomain || model.catalogMetadata?.providerFailureDomain);
  if (explicit) return explicit.toLowerCase();
  const provider = clean(model.provider).toLowerCase();
  const slug = clean(model.modelSlug || model.catalogMetadata?.slug || model.catalogMetadata?.id || model.slug);
  const slugProvider = slug.includes('/') ? clean(slug.split('/')[0]).toLowerCase() : '';
  if (provider && !['openrouter', 'openai-compatible', 'cloud'].includes(provider)) return provider;
  if (slugProvider) return slugProvider;
  const name = clean(model.name);
  const namedVendor = name.match(/(?:^|·|\s)(Anthropic|OpenAI|Google|xAI|Meta|Mistral|Qwen|DeepSeek|NVIDIA|Microsoft|Cohere)(?::|\s|·)/iu);
  if (namedVendor) return namedVendor[1].toLowerCase().replace('xai', 'x-ai');
  return provider || 'unknown';
}

function independent(left = {}, right = {}) {
  const leftDomain = providerFailureDomain(left);
  const rightDomain = providerFailureDomain(right);
  return Boolean(leftDomain && rightDomain && leftDomain !== 'unknown' && rightDomain !== 'unknown' && leftDomain !== rightDomain);
}

module.exports = { AUTHORITY, SCHEMA_VERSION, providerFailureDomain, independent };
