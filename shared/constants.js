'use strict';

let cachedReleaseIdentity = null;
function configureSharedReleaseIdentity(identity) {
  if (!identity || !identity.buildId || !identity.manifestSha256) throw new Error('A verified ReleaseIdentity is required');
  cachedReleaseIdentity = identity;
}
function getReleaseIdentity() {
  if (!cachedReleaseIdentity) throw new Error('Shared ReleaseIdentity has not been configured by the owning runtime');
  return cachedReleaseIdentity;
}

const PRODUCT = {};
Object.defineProperties(PRODUCT, {
  name: { enumerable: true, get: () => getReleaseIdentity().productName },
  version: { enumerable: true, get: () => getReleaseIdentity().productVersion },
  publicName: { enumerable: true, get: () => getReleaseIdentity().publicProductName || getReleaseIdentity().productName },
  publicNameEnglish: { enumerable: true, get: () => getReleaseIdentity().publicProductNameEnglish || 'Yance' },
  publicVersion: { enumerable: true, get: () => getReleaseIdentity().publicVersion || getReleaseIdentity().productVersion },
  updateName: { enumerable: true, get: () => getReleaseIdentity().productName },
  updateVersion: { enumerable: true, get: () => getReleaseIdentity().productVersion },
  internalProductId: { enumerable: true, get: () => getReleaseIdentity().internalProductId || 'Yance' },
  build: { enumerable: true, get: () => getReleaseIdentity().buildId },
  buildId: { enumerable: true, get: () => getReleaseIdentity().buildId },
  releaseManifestSha256: { enumerable: true, get: () => getReleaseIdentity().manifestSha256 },
  port: { enumerable: true, value: Number(process.env.YANCE_PORT || 27632) }
});
Object.freeze(PRODUCT);

const TASKS = Object.freeze([
  'translation',
  'understanding',
  'relationship',
  'director',
  'quick_reply',
  'deep_reply',
  'quality_review',
  'summary',
  'fact_extraction',
  'memory_extraction',
  'media_analysis',
  'material_analysis',
  'persona_rewrite',
  'speech_transcription'
]);

const MESSAGE_TYPES = Object.freeze([
  'text', 'image', 'gif', 'video', 'voice', 'audio', 'document', 'sticker',
  'contact', 'contacts', 'location', 'reaction', 'revoke', 'unknown'
]);

const QUALIFICATION = Object.freeze({
  untested: 'untested',
  testing: 'testing',
  verified: 'verified',
  experimental: 'experimental',
  failed: 'failed',
  blocked: 'blocked'
});

const ACCOUNT_PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'facebook']);
const ACCOUNT_STATES = Object.freeze([
  'unconfigured',
  'waiting-verification',
  'connecting',
  'connected',
  'limited',
  'credential-expiring',
  'reauthorize',
  'error',
  'paused',
  'logged-out'
]);

module.exports = { PRODUCT, TASKS, MESSAGE_TYPES, QUALIFICATION, ACCOUNT_PLATFORMS, ACCOUNT_STATES, configureSharedReleaseIdentity, getReleaseIdentity };
