const path = require("path");
require("dotenv").config({
  path: path.resolve(
    process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")
  ),
  override: true,
});
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const staysRoutes = require("./routes/stays");
const authRoutes = require("./routes/auth");
const emergencyCasesRoutes = require("./routes/emergencyCases");
const clinicalContextRoutes = require("./routes/clinicalContext");
const clinicalSummaryRoutes = require("./routes/clinicalSummary");
const decisionSupportRoutes = require("./routes/decisionSupport");
const preErRoutes = require("./routes/preEr"); // <-- Added Pre-ER routes

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT current_database() AS database_name");
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
app.use("/api/emergency-cases", preErRoutes); // <-- Mounted Pre-ER routes
app.use("/api/clinical-context", clinicalContextRoutes);
app.use("/api/clinical-summary", clinicalSummaryRoutes);
app.use("/api/decision-support", decisionSupportRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
