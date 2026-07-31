'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER_FILE = '.yance-source-uat-clone.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function evaluateSourceUatCloneReset(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || '.'));
  const env = options.env || process.env;
  const markerPath = path.resolve(String(env.YANCE_SOURCE_UAT_DATA_CLONE_MARKER || path.join(dataRoot, MARKER_FILE)));
  const base = { allowed: false, dataRoot, markerPath, reasonCode: 'SOURCE_UAT_CLONE_RESET_NOT_REQUESTED' };
  if (env.YANCE_SOURCE_UAT !== '1' || env.YANCE_SOURCE_UAT_RESET_SAFE_MODE !== '1') return base;
  if (!fs.existsSync(markerPath)) return { ...base, reasonCode: 'SOURCE_UAT_CLONE_MARKER_MISSING' };
  let marker;
  try { marker = readJson(markerPath); }
  catch (error) { return { ...base, reasonCode: 'SOURCE_UAT_CLONE_MARKER_INVALID', error: error.message };
  }
  const targetDataRoot = path.resolve(String(marker.targetDataRoot || '.'));
  const sourceDataRoot = path.resolve(String(marker.sourceDataRoot || '.'));
  if (marker.documentType !== 'YANCE_SOURCE_UAT_DATA_CLONE' || ![1, 2].includes(marker.schemaVersion)) return { ...base, reasonCode: 'SOURCE_UAT_CLONE_MARKER_CONTRACT_INVALID' };
  if (marker.schemaVersion === 2) {
    const whatsappAuthSourceRoot = path.resolve(String(marker.whatsappAuthSourceRoot || sourceDataRoot));
    if (whatsappAuthSourceRoot === targetDataRoot || marker.whatsappSourceUntouched !== true) {
      return { ...base, reasonCode: 'SOURCE_UAT_CLONE_WHATSAPP_SAFETY_FLAGS_INVALID', marker };
    }
  }
  if (targetDataRoot !== dataRoot) return { ...base, reasonCode: 'SOURCE_UAT_CLONE_TARGET_MISMATCH', marker };
  if (sourceDataRoot === targetDataRoot) return { ...base, reasonCode: 'SOURCE_UAT_CLONE_SOURCE_EQUALS_TARGET', marker };
  if (marker.sourceUntouched !== true || marker.realDataMutationAllowed !== false || marker.resetSafeModeInClone !== true) {
    return { ...base, reasonCode: 'SOURCE_UAT_CLONE_SAFETY_FLAGS_INVALID', marker };
  }
  return { allowed: true, dataRoot, markerPath, sourceDataRoot, targetDataRoot, marker, reasonCode: 'SOURCE_UAT_CLONE_SAFE_MODE_RESET_ALLOWED' };
}

module.exports = { MARKER_FILE, evaluateSourceUatCloneReset };
