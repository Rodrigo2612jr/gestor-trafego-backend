require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authMiddleware = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

// ─── Ensure DB initialized on every request (critical for Vercel serverless) ───
const { initDatabase } = require("./db/database");
app.use(async (_req, _res, next) => {
  await initDatabase();
  next();
});

// ─── Health check ───
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Public routes ───
app.use("/api/auth", require("./routes/auth"));
app.use("/api/oauth", require("./routes/oauth"));

// ─── Protected routes (require JWT) ───
app.use("/api/connections", authMiddleware, require("./routes/connections"));
app.use("/api/campaigns", authMiddleware, require("./routes/campaigns"));
app.use("/api/creatives", authMiddleware, require("./routes/creatives"));
app.use("/api/audiences", authMiddleware, require("./routes/audiences"));
app.use("/api/keywords", authMiddleware, require("./routes/keywords"));
app.use("/api/alerts", authMiddleware, require("./routes/alerts"));
app.use("/api/dashboard", authMiddleware, require("./routes/dashboard"));
app.use("/api/chat", authMiddleware, require("./routes/chat"));
app.use("/api/reports", authMiddleware, require("./routes/reports"));
app.use("/api/voice", authMiddleware, require("./routes/voice"));
app.use("/api/images", authMiddleware, require("./routes/images"));
app.use("/api/settings", authMiddleware, require("./routes/settings"));

// ─── Sync endpoint ───
app.post("/api/sync", authMiddleware, async (req, res) => {
  try {
    const { syncAll } = require("./services/sync");
    const results = await syncAll(req.userId);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 404 ───
app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// ─── Error handler ───
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// ─── Cron endpoints (used by Vercel Cron Jobs in production) ───
app.get("/api/cron/monitor", async (_req, res) => {
  const { monitorCampaigns } = require("./services/scheduler");
  await monitorCampaigns();
  res.json({ ok: true });
});

app.get("/api/cron/daily-report", async (_req, res) => {
  const { generateDailyReport } = require("./services/scheduler");
  await generateDailyReport();
  res.json({ ok: true });
});

// ─── Start (local dev) ───
if (require.main === module) {
  const { initDatabase } = require("./db/database");
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Gestor de Tráfego AI — Backend`);
      console.log(`   Rodando em http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health\n`);

      const { startScheduler } = require("./services/scheduler");
      startScheduler();
    });
  });
}

module.exports = app;
