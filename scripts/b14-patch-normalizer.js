'use strict';
const fs=require('node:fs');
const path=require('node:path');
const file=path.resolve(__dirname,'../backend/services/medicationNormalizationService.js');
function replaceOnce(s,from,to){
  const n=s.split(from).length-1;
  if(n!==1)throw Error('B14 safety stop: expected source anchor once, found '+n);
  return s.replace(from,to);
}
function patch(s){
  if(s.includes('// B14_VERSIONED_PROVENANCE'))return {code:s,changed:false};
  s=replaceOnce(s,'SELECT mapping_id, medication_id, canonical_name, mapping_status','SELECT mapping_id, medication_id, canonical_name, mapping_status, mapping_version, created_at');
  s=replaceOnce(s,'SELECT component_id, medication_id, component_name, component_canonical_name, mapping_status','SELECT component_id, medication_id, component_name, component_canonical_name, mapping_status, mapping_version, created_at');
  s=replaceOnce(s,'const markMapped = (med, name, source, componentOf, rowId) => {','const markMapped = (med, name, source, componentOf, rowId, mappingRow) => {');
  s=replaceOnce(s,'mapping_version: null });',`// B14_VERSIONED_PROVENANCE: NULL explicitly means legacy/unversioned.
      mapping_version: mappingRow.mapping_version ?? null,
      version_status: mappingRow.mapping_version ? 'VERSIONED' : 'LEGACY_UNVERSIONED',
      mapping_created_at: mappingRow.created_at ?? null });`);
  s=replaceOnce(s,'}, null, first.mapping_id);','}, null, first.mapping_id, first);');
  s=replaceOnce(s,'}, med.medication_name, first.component_id);','}, med.medication_name, first.component_id, first);');
  // Duplicate rows that disagree on version are ambiguous, never silently first-row wins.
  s=replaceOnce(s,'&& normalized(r.mapping_status) === normalized(first.mapping_status));','&& normalized(r.mapping_status) === normalized(first.mapping_status)\n        && (r.mapping_version ?? null) === (first.mapping_version ?? null));');
  s=replaceOnce(s,'&& normalized(r.mapping_status) === normalized(first.mapping_status))) {','&& normalized(r.mapping_status) === normalized(first.mapping_status)\n          && (r.mapping_version ?? null) === (first.mapping_version ?? null))) {');
  return {code:s,changed:true};
}
if(require.main===module){
  try{const a=process.argv.slice(2);if(a.length!==1||!['--check','--apply'].includes(a[0]))throw Error('Usage: node scripts/b14-patch-normalizer.js --check|--apply');
    const original=fs.readFileSync(file,'utf8');const result=patch(original);
    if(a[0]==='--apply'&&result.changed)fs.writeFileSync(file,result.code);
    console.log(a[0]==='--check'?'B14_PATCH_PREFLIGHT_OK':result.changed?'B14_NORMALIZER_PATCH_APPLIED':'B14_ALREADY_PATCHED');
  }catch(e){console.error(e.message);process.exitCode=1}
}
module.exports={patch};
