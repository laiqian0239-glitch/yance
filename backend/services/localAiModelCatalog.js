'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '..', '..', 'config', 'local-ai', 'adaptive-local-model-catalog-v1.json');

function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (Number(data.schemaVersion) !== 1 || !Array.isArray(data.models)) {
    throw Object.assign(new Error('Adaptive local model catalog is invalid'), { code: 'ADAPTIVE_LOCAL_MODEL_CATALOG_INVALID' });
  }
  return data;
}

function listModels(options = {}) {
  const catalog = loadCatalog(options.catalogPath);
  return catalog.models.map(model => Object.freeze({ ...model }));
}

function findModel(id, options = {}) {
  const key = String(id || '').trim();
  return listModels(options).find(model => String(model.id) === key) || null;
}

module.exports = { DEFAULT_CATALOG_PATH, loadCatalog, listModels, findModel };