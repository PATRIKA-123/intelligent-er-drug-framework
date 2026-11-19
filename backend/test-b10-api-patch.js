'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {patch}=require('../scripts/b10-patch-news2-api');
const source=`router.get("/:stay_id/news2", authMiddleware, requireStayAccess(), async (req, res) => {
    const prov = await assumedInputsSql("o");
    const result = await pool.query(
      \`SELECT n.observation_id,
              \${prov.basedOn} AS based_on_assumed_inputs
       FROM news2_results_real n LEFT JOIN observations o ON o.observation_id = n.observation_id
       WHERE n.stay_id = $1\`, [stay_id]
    );
});
router.get("/:stay_id/trends", authMiddleware, requireStayAccess(), async (req, res) => {});`;
test('B10 API patch is deterministic and idempotent',()=>{let r=patch(source);assert.equal(patch(r),r);assert.match(r,/s\.provenance_origin/);assert.match(r,/based_on_missing_inputs/);assert.match(r,/s\.consciousness_assumed, s\.oxygen_support_assumed, s\.spo2_scale_assumed/);assert.match(r,/news2_input_provenance/)});
test('B10 API patch refuses unrelated or modified route',()=>{assert.throws(()=>patch(source.replace('AS based_on_assumed_inputs','AS uncertain')))});

const vm=require('node:vm');
test('B10 patch generates syntactically valid route with all SQL interpolation variables declared',()=>{
  const r=patch(source);
  assert.doesNotMatch(r,/\\\$\{/);
  for(const name of ['individualFlags','basedOn','missing','origin','snapJoin']) assert.ok(r.includes('${'+name+'}'),name);
  // Compile route fragment as function while leaving dependencies as globals.
  assert.doesNotThrow(()=>new vm.Script(r));
});
test('B10 patch works against production-format full SELECT shape',()=>{
  const realistic=source.replace('SELECT n.observation_id,','SELECT n.observation_id, n.observation_time, n.total_news2_score, n.risk_level,\n              n.respiratory_score, n.spo2_score, n.oxygen_score, n.systolic_bp_score,\n              n.heart_rate_score, n.temperature_score, n.consciousness_score,');
  const r=patch(realistic);
  assert.match(r,/n.consciousness_score/);
  assert.match(r,/input_provenance_origin/);
  assert.doesNotThrow(()=>new vm.Script(r));
});
