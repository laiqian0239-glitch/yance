#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');
const { EncryptedStore } = require('./encryptedStore');
const { createFacebookGateway } = require('./gateway');

function main() {
  const config = loadConfig();
  const store = new EncryptedStore({ filePath: config.dataFile, key: config.masterKey });
  const gateway = createFacebookGateway({ config, store });
  const server = http.createServer(gateway.app);
  server.on('upgrade', gateway.handleUpgrade);
  server.listen(config.port, config.host, () => {
    process.stdout.write(`Yance Facebook Gateway listening on http://${config.host}:${config.port} (public ${config.publicBaseUrl})\n`);
  });
  const shutdown = signal => {
    process.stdout.write(`Yance Facebook Gateway received ${signal}\n`);
    gateway.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { main };
