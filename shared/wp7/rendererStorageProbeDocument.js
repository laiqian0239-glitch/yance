'use strict';

const WP7_RENDERER_STORAGE_PROBE_PATH = '/__wp7/renderer-storage';
const WP7_RENDERER_STORAGE_PROBE_MARKER = 'wp7-renderer-storage-probe-v1';
const ALLOWED_EXECUTION_CLASSES = new Set(['FINAL_WINDOWS', 'PRE_REVIEW_PACKAGED_INTEGRATION']);
const WP7_RENDERER_STORAGE_PROBE_DOCUMENT = [
  '<!doctype html>',
  `<html lang="en" data-wp7-renderer-storage-probe="${WP7_RENDERER_STORAGE_PROBE_MARKER}">`,
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Yance WP7 Renderer Storage Probe</title>',
  '</head>',
  '<body></body>',
  '</html>'
].join('');

function rendererStorageProbeExecutionClass(env = process.env) {
  return String(env.WP7_PROBE_EXECUTION_CLASS || 'FINAL_WINDOWS').trim();
}

function rendererStorageProbeEnabled(env = process.env) {
  return String(env.WP7_PROBE_ID || '').trim() === 'safe-mode-negative'
    && ALLOWED_EXECUTION_CLASSES.has(rendererStorageProbeExecutionClass(env));
}

function rendererStorageProbeResponse(env = process.env) {
  if (!rendererStorageProbeEnabled(env)) {
    return Object.freeze({
      statusCode: 404,
      headers: Object.freeze({
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      }),
      body: 'Not Found\n'
    });
  }
  return Object.freeze({
    statusCode: 200,
    headers: Object.freeze({
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; media-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    }),
    body: WP7_RENDERER_STORAGE_PROBE_DOCUMENT
  });
}

module.exports = {
  WP7_RENDERER_STORAGE_PROBE_PATH,
  WP7_RENDERER_STORAGE_PROBE_MARKER,
  WP7_RENDERER_STORAGE_PROBE_DOCUMENT,
  rendererStorageProbeExecutionClass,
  rendererStorageProbeEnabled,
  rendererStorageProbeResponse
};
