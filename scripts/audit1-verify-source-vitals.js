#!/usr/bin/env node
'use strict';
// B09/B17: read-only comparison against *published* MIMIC-IV-ED Demo v2.2 ed/vitalsign.csv.gz.
// No database calls; no inferred source-unit assertions.
const fs=require('node:fs');
const zlib=require('node:zlib');
const path=require('node:path');
function csvParse(src){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(c==='"'){if(quoted&&src[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&src[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Unclosed quoted field in CSV');
  if(field!==''||row.length){row.push(field);rows.push(row);}
  const head=rows.shift();if(!head)throw Error('Empty CSV');
  return rows.map((v,i)=>{if(v.length!==head.length)throw Error(`CSV line ${i+2}: ${v.length} fields, expected ${head.length}`);return Object.fromEntries(head.map((h,j)=>[h,v[j]]));});
}
const numEqual=(a,b)=> a!==''&&b!==''&&Number.isFinite(Number(a))&&Number(a)===Number(b);
function compare(clean,source){
  const key=r=>[r.subject_id,r.stay_id,r.timestamp||r.charttime].join('|');
  const indexed=new Map();
  for(const r of source){const k=key(r);if(!indexed.has(k))indexed.set(k,[]);indexed.get(k).push(r);}
  const fields=[['temperature','temperature'],['heart_rate','heartrate'],['respiratory_rate','resprate'],['spo2','o2sat'],['systolic_bp','sbp']];
  const errors=[],unitCounts={fahrenheit_compatible:0,celsius_compatible_unverified:0,other:0};
  for(const [i,r] of clean.entries()){
    const k=key(r), candidates=indexed.get(k)||[];
    const matched=candidates.find(s=>fields.every(([a,b])=>numEqual(r[a],s[b])));
    if(!matched){errors.push({clean_csv_line:i+2,stay_id:r.stay_id,reason:candidates.length?'measurement_mismatch':'not_found_in_original'});continue;}
    const t=Number(r.temperature);
    if(t>=77&&t<=113)unitCounts.fahrenheit_compatible++;
    else if(t>=25&&t<=45)unitCounts.celsius_compatible_unverified++;
    else unitCounts.other++;
  }
  const suspicious=clean.filter(r=>Number(r.systolic_bp)<50).map(r=>{
    const candidates=indexed.get(key(r))||[];
    const original=candidates.find(s=>numEqual(r.systolic_bp,s.sbp));
    return {subject_id:r.subject_id,stay_id:r.stay_id,timestamp:r.timestamp,clean_sbp:r.systolic_bp,original_sbp:original?.sbp??null,original_dbp:original?.dbp??null,source_verified:!!original};
  });
  return {clean_rows:clean.length,source_rows:source.length,rows_exactly_matched:clean.length-errors.length,rows_mismatched:errors.length,unit_classification_by_range:unitCounts,suspicious_sbp_below_50:suspicious,errors:errors.slice(0,20),source_unit_conclusion:'Original vitalsign temperature has no per-row unit column. MIMIC documents Fahrenheit and warns some entries are actually Celsius. Unit cannot be individually confirmed for Celsius-like rows.'};
}
function main(argv=process.argv.slice(2)){
  if(argv.length!==2)throw Error('Usage: node scripts/audit1-verify-source-vitals.js data/cleaned_vitals.csv <path-to-published-vitalsign.csv.gz>');
  const cleaned=csvParse(fs.readFileSync(path.resolve(argv[0]),'utf8'));
  const buf=fs.readFileSync(path.resolve(argv[1]));
  const original=csvParse(argv[1].endsWith('.gz')?zlib.gunzipSync(buf).toString('utf8'):buf.toString('utf8'));
  const result=compare(cleaned,original);
  console.log(JSON.stringify(result,null,2));
  if(result.rows_mismatched||result.rows_exactly_matched!==554||result.suspicious_sbp_below_50.length!==1||!result.suspicious_sbp_below_50[0].source_verified)process.exitCode=1;
  return result;
}
if(require.main===module)try{main();}catch(e){console.error('SOURCE VERIFICATION FAILED:',e.message);process.exitCode=1;}
module.exports={csvParse,compare,main};
