'use strict';

const fs = require('fs');
const path = require('path');

const PRESET_DIRECTORY = path.join(__dirname, 'presets');
const DEFAULT_PRESET_ID = 'yeonhee-kim-v1';
const PRESET_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;

function clean(value) { return String(value == null ? '' : value).trim(); }

function loadPersonaPreset(presetId = DEFAULT_PRESET_ID) {
  const id = clean(presetId) || DEFAULT_PRESET_ID;
  if (!PRESET_ID_PATTERN.test(id)) {
    const error = new Error('Persona preset ID is invalid');
    error.code = 'PERSONA_PRESET_ID_INVALID';
    throw error;
  }
  const filePath = path.join(PRESET_DIRECTORY, `${id}.json`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${path.resolve(PRESET_DIRECTORY)}${path.sep}`)) {
    const error = new Error('Persona preset path escaped the preset directory');
    error.code = 'PERSONA_PRESET_PATH_INVALID';
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Persona preset could not be loaded: ${id}`);
    wrapped.code = error.code === 'ENOENT' ? 'PERSONA_PRESET_NOT_FOUND' : 'PERSONA_PRESET_INVALID';
    wrapped.cause = error;
    throw wrapped;
  }
  return payload;
}

function listPersonaPresets() {
  return fs.readdirSync(PRESET_DIRECTORY, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => {
      const id = entry.name.slice(0, -5);
      const payload = loadPersonaPreset(id);
      return {
        presetId: id,
        title: clean(payload.displayName) || id,
        profileId: clean(payload.profileId),
        mode: clean(payload.mode),
        editable: true
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

const DEFAULT_PERSONA_PROFILE = Object.freeze(loadPersonaPreset(DEFAULT_PRESET_ID));

module.exports = {
  DEFAULT_PRESET_ID,
  DEFAULT_PERSONA_PROFILE,
  loadPersonaPreset,
  listPersonaPresets
};
