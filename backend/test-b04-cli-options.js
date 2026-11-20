'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('B04 accepts --verify/--apply by parsing only user arguments', () => {
  const file = path.resolve(__dirname, '../scripts/b04-rebuild-verified.js');
  const code = fs.readFileSync(file, 'utf8');
  assert.match(code, /process\.argv\.slice\(2\)\.some\(/);
  const valid = argv => !argv.slice(2).some(a => !['--apply', '--verify'].includes(a));
  assert.equal(valid(['node','b04-rebuild-verified.js','--verify']), true);
  assert.equal(valid(['node','b04-rebuild-verified.js','--apply']), true);
  assert.equal(valid(['node','b04-rebuild-verified.js','--unknown']), false);
});
