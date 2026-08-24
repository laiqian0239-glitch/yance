'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const file = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
let text = fs.readFileSync(file, 'utf8');
const before = "        github.event.pull_request.head.ref == 'product/v21-product-system-settings-reachability-p1-successor-v2-amendment-1'\n";
const after = "        github.event.pull_request.head.ref == 'product/v21-product-system-settings-reachability-p1-successor-v2-amendment-1' ||\n        github.event.pull_request.head.ref == 'fix/v21-electron-supported-runtime-p0-production-amendment-1'\n";
const count = text.split(before).length - 1;
assert.equal(count, 3, 'Product Final must expose exactly three successor admission lists');
text = text.replaceAll(before, after);
assert.equal(text.split("github.event.pull_request.head.ref == 'fix/v21-electron-supported-runtime-p0-production-amendment-1'").length - 1, 3, 'Electron successor must be admitted by all three Product Final jobs');
fs.writeFileSync(file, text, 'utf8');
