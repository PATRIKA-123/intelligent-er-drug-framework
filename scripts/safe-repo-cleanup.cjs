#!/usr/bin/env node
'use strict';
// Only removes known obsolete, non-runtime files after checking references.
// Dry run: node scripts/safe-repo-cleanup.cjs
// Apply:   node scripts/safe-repo-cleanup.cjs --apply
// Never removes migrations, database scripts, test suites or core documentation.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const candidates = [
  'INSTRUCTIONS/README_ADMIN_FRONTENDFIX.md',
  'INSTRUCTIONS/ADMIN_V2_SETUP.md',
  'INSTRUCTIONS/ADMIN_V3_SETUP.md',
  'INSTRUCTIONS/ADMIN_V4_SETUP.md',
  'INSTRUCTIONS/ADMIN_V5_SETUP.md',
  'frontend/src/assets/react.svg',
  'frontend/src/assets/vite.svg',
];
function tracked() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
}
const files = tracked();
const sourceFiles = files.filter(p => /\.(jsx?|tsx?|css|html|json|cjs|mjs)$/.test(p) && !p.includes('package-lock') && p !== 'scripts/safe-repo-cleanup.cjs');
const seen = new Set();
function referenced(target) {
  const filename = path.basename(target);
  return sourceFiles.some(f => {
    if (f === target) return false;
    try { return fs.readFileSync(path.join(root, f), 'utf8').includes(filename); }
    catch { return false; }
  });
}
let count = 0;
for (const relative of candidates) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep) || seen.has(relative)) continue;
  seen.add(relative);
  if (!fs.existsSync(absolute)) continue;
  if (fs.statSync(absolute).isDirectory()) continue;
  if (referenced(relative)) {
    console.log(`KEEP (referenced): ${relative}`);
    continue;
  }
  if (apply) { fs.unlinkSync(absolute); console.log(`REMOVED: ${relative}`); }
  else console.log(`WOULD REMOVE: ${relative}`);
  count++;
}
console.log(`${apply ? 'Removed' : 'Dry run: eligible'} ${count} obsolete files.`);
console.log('Kept: migrations, DB utilities, all tests, CI workflows, README files and application code.');
if (!apply) console.log('If correct, run: node scripts/safe-repo-cleanup.cjs --apply');
