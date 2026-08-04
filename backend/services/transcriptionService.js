'use strict';

const core = require('./transcriptionServiceCore');

function asynchronousServiceBoundary(service) {
  if (!service || typeof service.transcribe !== 'function'
      || typeof service.executePersistedTranscription !== 'function') {
    throw new TypeError('Transcription service core must expose scheduling and persisted execution');
  }
  return Object.freeze({
    transcribe(input = {}) {
      return Promise.resolve().then(() => service.transcribe(input));
    },
    executePersistedTranscription(input = {}) {
      return Promise.resolve().then(() => service.executePersistedTranscription(input));
    }
  });
}

function createTranscriptionService(options = {}) {
  return asynchronousServiceBoundary(core.createTranscriptionService(options));
}

const defaultTranscriptionService = createTranscriptionService();

module.exports = Object.freeze({
  ...core,
  createTranscriptionService,
  asynchronousServiceBoundary,
  transcribe: input => defaultTranscriptionService.transcribe(input),
  executePersistedTranscription: input => defaultTranscriptionService.executePersistedTranscription(input)
});
