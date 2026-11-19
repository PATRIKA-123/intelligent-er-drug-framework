const path = require("path");
require("dotenv").config({
  path: path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")),
  override: false,
});
const { validateStartupEnvironment } = require("./config/validateEnvironment");
try { validateStartupEnvironment(process.env); }
catch (error) {
  console.error(`Startup configuration error: ${error.message}`);
  process.exit(1);
}
const express = require("express");
const cors = require("cors");
const { ALLOWED_METHODS, ALLOWED_HEADERS, parseAllowedOrigins,
  isOriginAllowed, applyApiSecurityHeaders } = require("./config/httpSecurity");
const { apiErrorContract, apiErrorHandler } = require("./middleware/apiErrorContract");
const pool = require("./db");
const staysRoutes = require("./routes/stays");
const authRoutes = require("./routes/auth");
const emergencyCasesRoutes = require("./routes/emergencyCases");
const clinicalContextRoutes = require("./routes/clinicalContext");
const clinicalSummaryRoutes = require("./routes/clinicalSummary");
const decisionSupportRoutes = require("./routes/decisionSupport");
const preErRoutes = require("./routes/preEr");
const clinicalPermissionsRoutes = require("./routes/clinicalPermissions");
const postErRoutes = require("./routes/postEr");
const doctorsRoutes = require("./routes/doctors");
let allowedOrigins;
try { allowedOrigins = parseAllowedOrigins(process.env); }
catch (error) {
  console.error(`Startup configuration error: ${error.message}`);
  process.exit(1);
}
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(applyApiSecurityHeaders);
app.use((req, res, next) => {
  if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
    return res.status(403).json({ error: "Origin not allowed", code: "FORBIDDEN" });
  }
  next();
});
app.use(cors({
  origin(origin, callback) { callback(null, origin && allowedOrigins.has(origin) ? origin : false); },
  methods: ALLOWED_METHODS,
  allowedHeaders: ALLOWED_HEADERS,
  credentials: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "128kb" }));
app.use(apiErrorContract);
app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT current_database() AS database_name");
    res.json({ status: "ok", message: "Backend is running",
      ...(process.env.PRE_ER_TEST_DATABASE_NAME ? { database_name: result.rows[0].database_name } : {}) });
  } catch (err) {
    console.error("Health check failed:", err.message);
    res.status(503).json({ status: "error", message: "Database is unavailable" });
  }
});
app.use("/api/stays", staysRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/emergency-cases", emergencyCasesRoutes);
app.use("/api/emergency-cases", preErRoutes);
app.use("/api/clinical-context", clinicalContextRoutes);
app.use("/api/clinical-summary", clinicalSummaryRoutes);
app.use("/api/decision-support", decisionSupportRoutes);
app.use("/api/clinical-permissions", clinicalPermissionsRoutes);
app.use("/api/post-er", postErRoutes);
app.use("/api/doctors", doctorsRoutes);
app.use((req, res) => res.status(404).json({ error: "API endpoint not found", code: "NOT_FOUND" }));
app.use(apiErrorHandler);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
