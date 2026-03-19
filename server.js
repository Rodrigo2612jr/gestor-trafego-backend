require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authMiddleware = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

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

// ─── 404 ───
app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// ─── Error handler ───
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`\n🚀 Gestor de Tráfego AI — Backend`);
  console.log(`   Rodando em http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);

  // Start autonomous scheduler (campaign monitoring, alerts, daily reports)
  const { startScheduler } = require("./services/scheduler");
  startScheduler();
});
