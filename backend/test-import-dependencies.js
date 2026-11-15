// B07: the CSV importer (scripts/importData.js) must be able to load every
// package it needs after a normal "npm install" in backend/.
// No database needed.   Run:  node test-import-dependencies.js
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

let failed = 0, total = 0;
function check(name, ok) {
  total++;
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name);
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const importer = fs.readFileSync(path.join(__dirname, "../scripts/importData.js"), "utf8");
const fromBackend = createRequire(path.join(__dirname, "package.json"));

for (const name of ["csv-parser", "dotenv", "pg"]) {
  check(`${name} is declared in backend/package.json dependencies`, Boolean(pkg.dependencies && pkg.dependencies[name]));
  let resolvable = true;
  try { fromBackend.resolve(name); } catch (_) { resolvable = false; }
  check(`${name} resolves from backend/node_modules`, resolvable);
  check(`importer loads ${name} through the backend package (no bare require)`,
    !new RegExp(`(^|[^.\\w])require\\(["']${name}["']\\)`).test(importer));
}

check('npm script "import:data" exists and points at the importer',
  Boolean(pkg.scripts && /scripts\/importData\.js/.test(pkg.scripts["import:data"] || "")));

console.log(`\n${failed} FAILED / ${total} CHECKS`);
process.exit(failed ? 1 : 0);
