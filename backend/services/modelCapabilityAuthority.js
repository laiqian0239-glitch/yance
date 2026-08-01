'use strict';

const { TASKS } = require('../../shared/constants');

const AUTHORITY = 'ModelCapabilityAuthority';
const SCHEMA_VERSION = 1;
const INTERACTIVE_TASKS = new Set([...TASKS, 'general', 'learning_synthesis']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => [key, ...values(item)]);
  return value == null ? [] : [clean(value)];
}

function classify(model = {}) {
  const slug = clean(model.name || model.model || model.id);
  const metadata = model.catalogMetadata && typeof model.catalogMetadata === 'object' ? model.catalogMetadata : {};
  const declared = new Set([
    ...values(model.capabilities),
    ...values(model.capabilityTags),
    ...values(metadata.capabilities),
    ...values(metadata.endpointCapabilities),
    ...values(metadata.supportedEndpoints),
    ...values(metadata.modality),
    ...values(metadata.architecture)
  ].map(lower).filter(Boolean));
  const batchOnly = /(?:^|[:/._-])batch(?:$|[:/._-])/iu.test(slug)
    || declared.has('batch-only')
    || declared.has('batch_only')
    || lower(metadata.apiMode) === 'batch'
    || lower(metadata.endpointType) === 'batch';
  const embedding = /(?:embed|embedding|bge-|nomic-embed|e5-)/iu.test(slug)
    || declared.has('embedding')
    || declared.has('embeddings');
  const imageOnly = declared.has('image-only') || declared.has('image_only');
  const explicitlyNonInteractive = declared.has('non-interactive') || declared.has('non_interactive');
  const interactiveChat = !batchOnly && !embedding && !imageOnly && !explicitlyNonInteractive;
  const capabilities = new Set(declared);
  if (batchOnly) capabilities.add('batch-only');
  if (interactiveChat) capabilities.add('interactive-chat');
  if (embedding) capabilities.add('embedding');
  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    slug,
    batchOnly,
    embedding,
    imageOnly,
    interactiveChat,
    capabilities: [...capabilities].sort()
  });
}

function supportsInteractiveChat(model = {}) { return classify(model).interactiveChat; }
function supportsTask(model = {}, task = '') {
  const target = clean(task);
  if (!target) return false;
  if (!INTERACTIVE_TASKS.has(target)) return false;
  return supportsInteractiveChat(model);
}

module.exports = { AUTHORITY, SCHEMA_VERSION, INTERACTIVE_TASKS, classify, supportsInteractiveChat, supportsTask };
