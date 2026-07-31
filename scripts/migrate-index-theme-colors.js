'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'frontend', 'index.html');
const source = fs.readFileSync(target, 'utf8');

const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[^)]*\)/g;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 1) { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function parseHex(value) {
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) return null;
  const expanded = hex.length <= 4 ? [...hex].map(ch => ch + ch).join('') : hex;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}
function parseRgb(value) {
  const parts = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')')).split(',').map(part => part.trim());
  if (parts.length < 3) return null;
  const nums = parts.slice(0, 3).map(Number);
  if (nums.some(value => !Number.isFinite(value))) return null;
  const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
  return { r: nums[0], g: nums[1], b: nums[2], a: Number.isFinite(alpha) ? alpha : 1 };
}
function parseColor(value) { return value.startsWith('#') ? parseHex(value) : parseRgb(value); }
function luminance({ r, g, b }) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function saturation({ r, g, b }) { const max = Math.max(r, g, b), min = Math.min(r, g, b); return max === 0 ? 0 : (max - min) / max; }
function hue({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), delta = max - min;
  if (!delta) return 0;
  let value;
  if (max === rn) value = ((gn - bn) / delta) % 6;
  else if (max === gn) value = (bn - rn) / delta + 2;
  else value = (rn - gn) / delta + 4;
  return (value * 60 + 360) % 360;
}
function tokenFor(color) {
  const light = luminance(color);
  const sat = saturation(color);
  const h = hue(color);
  if (light < 0.08) return '--shadow-base';
  if (sat < 0.12) {
    if (light > 0.88) return '--text-primary';
    if (light > 0.68) return '--text-secondary';
    if (light > 0.42) return '--text-muted';
    if (light > 0.22) return '--border-active';
    if (light > 0.13) return '--surface-control';
    return '--surface-app';
  }
  if (light < 0.20 && sat < 0.72) return '--surface-panel';
  if (h >= 345 || h < 15) return light > 0.72 ? '--accent-tertiary' : '--status-danger';
  if (h < 48) return h < 25 ? '--status-danger' : '--status-warning';
  if (h < 78) return '--status-warning';
  if (h < 165) return '--status-success';
  if (h < 205) return '--accent-primary';
  if (h < 255) return '--accent-primary';
  if (h < 315) return '--accent-secondary';
  return '--accent-tertiary';
}
function replacement(value) {
  const parsed = parseColor(value);
  if (!parsed) return value;
  const token = tokenFor(parsed);
  const alpha = clamp(parsed.a, 0, 1);
  if (alpha >= 0.995) return `var(${token})`;
  const percent = round(alpha * 100, alpha * 100 < 10 ? 1 : 0);
  return `color-mix(in srgb,var(${token}) ${percent}%,transparent)`;
}
function isCustomPropertyValue(text, index) {
  const lineStart = Math.max(text.lastIndexOf('\n', index), text.lastIndexOf('{', index), text.lastIndexOf(';', index)) + 1;
  const prefix = text.slice(lineStart, index);
  return /--[\w-]+\s*:\s*$/.test(prefix);
}
function isThemePreviewValue(text, index) {
  const start = Math.max(0, index - 120);
  const prefix = text.slice(start, index);
  return /--preview-(?:bg|a|b|line)\s*:\s*$/.test(prefix);
}

let converted = 0;
let preserved = 0;
const output = source.replace(colorPattern, (value, index, text) => {
  if (isCustomPropertyValue(text, index) || isThemePreviewValue(text, index)) {
    preserved += 1;
    return value;
  }
  const next = replacement(value);
  if (next !== value) converted += 1;
  return next;
});

fs.writeFileSync(target, output, 'utf8');
console.log(JSON.stringify({ target: path.relative(root, target), converted, preserved }, null, 2));
