const fs = require("fs");
for (const f of fs.readdirSync("./routes")) {
  if (f.startsWith("auth.before")) continue;
  require("./routes/" + f);
  console.log("loaded", f);
}
console.log("ALL ROUTES LOAD");
process.exit(0);