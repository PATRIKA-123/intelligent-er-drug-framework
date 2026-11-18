const path = require("path");
require("dotenv").config({
  path: path.resolve(
    process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")
  ),
  // Hosting-provider / CI environment variables must take precedence over .env.
  override: false,
});

// B18: fail before importing routes or opening a listening socket if startup
// credentials/configuration are missing or clearly unsafe.
const { validateStartupEnvironment } = require("./config/validateEnvironment");
try {
  validateStartupEnvironment(process.env);
} catch (error) {
  console.error(`Startup configuration error: ${error.message}`);
  process.exit(1);
}

const express = require("express");
const cors = require("cors");
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT current_database() AS database_name");
    console.log("HEALTH CHECK DATABASE:", result.rows[0].database_name);
    res.json({
      status: "ok",
      message: "Backend is running",
      ...(process.env.PRE_ER_TEST_DATABASE_NAME
        ? { database_name: result.rows[0].database_name }
        : {}),
    });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
