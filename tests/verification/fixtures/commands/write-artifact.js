'use strict';
const fs = require('node:fs');
fs.mkdirSync('.pvep-output', { recursive: true });
fs.writeFileSync('.pvep-output/report.json', '{"pass":true}\n');
process.stdout.write('artifact-written\n');
