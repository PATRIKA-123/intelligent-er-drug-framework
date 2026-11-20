#!/usr/bin/env node
'use strict';
// Scoped NEWS2 API patch. Writes only after all expected anchors are verified.
const fs = require('node:fs');
const path = require('node:path');
const route = path.resolve(__dirname, '../backend/routes/stays.js');
function patch(source) {
  if (source.includes('B10_DURABLE_NEWS2_PROVENANCE')) return source;
  const anchor='router.get("/:stay_id/news2", authMiddleware, requireStayAccess(), async (req, res) => {';
  const start=source.indexOf(anchor);
  if(start<0 || source.indexOf(anchor,start+anchor.length)!==-1) throw Error('Expected unique NEWS2 route not found');
  const end=source.indexOf('\nrouter.get(',start+anchor.length);
  if(end<0) throw Error('NEWS2 route end not found');
  let segment=source.slice(start,end);
  const declaration='    const prov = await assumedInputsSql("o");';
  if(segment.split(declaration).length!==2) throw Error('NEWS2 provenance declaration changed; manual review required');
  const pattern=/\$\{prov\.basedOn\}\s+AS based_on_assumed_inputs\s+FROM news2_results_real n\s+LEFT JOIN observations o ON o\.observation_id = n\.observation_id/;
  if(!pattern.test(segment)) throw Error('NEWS2 SELECT expected SQL text missing; no file changed');
  const additions=String.raw`
    // B10_DURABLE_NEWS2_PROVENANCE: use stored snapshot where migrated.
    const { hasColumn } = require("../services/schemaCapabilities");
    const hasSnapshot = await hasColumn("news2_input_provenance", "observation_id");
    const individualFlags = hasSnapshot
      ? "s.consciousness_assumed, s.oxygen_support_assumed, s.spo2_scale_assumed,"
      : prov.columns + ",";
    const basedOn = hasSnapshot
      ? "CASE WHEN s.consciousness_assumed IS TRUE OR s.oxygen_support_assumed IS TRUE OR s.spo2_scale_assumed IS TRUE THEN TRUE WHEN s.consciousness_assumed IS FALSE AND s.oxygen_support_assumed IS FALSE AND s.spo2_scale_assumed IS FALSE THEN FALSE ELSE NULL END"
      : prov.basedOn;
    const missing = hasSnapshot
      ? "CASE WHEN s.observation_id IS NULL THEN NULL ELSE (s.consciousness_missing OR s.oxygen_support_missing OR s.spo2_scale_missing) END"
      : "CASE WHEN o.observation_id IS NULL THEN NULL ELSE (o.consciousness IS NULL OR o.oxygen_support IS NULL OR o.spo2_scale IS NULL) END";
    const origin = hasSnapshot ? "s.provenance_origin" : "'LIVE_DERIVED'::text";
    const snapJoin = hasSnapshot ? "LEFT JOIN news2_input_provenance s ON s.observation_id = n.observation_id" : "";
`;
  segment=segment.replace(declaration,declaration+additions);
  const replacement=[
    '${individualFlags}',
    '              ${basedOn} AS based_on_assumed_inputs,',
    '              ${missing} AS based_on_missing_inputs,',
    '              ${origin} AS input_provenance_origin',
    '       FROM news2_results_real n LEFT JOIN observations o ON o.observation_id = n.observation_id',
    '       ${snapJoin}'
  ].join('\n');
  segment=segment.replace(pattern,()=>replacement);
  return source.slice(0,start)+segment+source.slice(end);
}
if(require.main===module){
  try{
    const source=fs.readFileSync(route,'utf8');
    const next=patch(source);
    if(next===source) console.log('B10 NEWS2 API already patched');
    else {fs.writeFileSync(route,next);console.log('Patched backend/routes/stays.js NEWS2 API');}
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={patch};
