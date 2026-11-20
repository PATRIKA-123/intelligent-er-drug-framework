#!/usr/bin/env node
"use strict";
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const alertFile = path.join(root, 'backend/services/alertService.js');
const ledgerFile = path.join(root, 'backend/services/screeningRunLedger.js');
const {patch} = require('../backend/test-b13-atomic-helpers');
function main() {
  const mode = process.argv.slice(2);
  if(mode.length !== 1 || !['--check', '--apply'].includes(mode[0])) throw Error('Use --check or --apply');
  const oldAlert=fs.readFileSync(alertFile,'utf8'), oldLedger=fs.readFileSync(ledgerFile,'utf8');
  const out=patch(oldAlert,oldLedger);
  if(mode[0] === '--check') { console.log(out.already ? 'B13_ATOMIC_COMPLETION_ALREADY_APPLIED' : 'B13_ATOMIC_COMPLETION_PREFLIGHT_OK'); return; }
  if(!out.already) {
    // Both files fully validated before either write.
    fs.writeFileSync(ledgerFile,out.ledger);
    fs.writeFileSync(alertFile,out.alert);
  }
  console.log('B13_ATOMIC_COMPLETION_APPLIED');
}
if(require.main===module) { try{main();} catch(e){console.error('SAFETY STOP:',e.message);process.exitCode=1;} }
