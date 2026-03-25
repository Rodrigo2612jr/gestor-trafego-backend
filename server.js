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

// ─── Páginas legais (retornam 200 garantido para validação da Meta) ───
app.get("/privacidade", (_req, res) => {
  res.status(200).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Política de Privacidade — Gestor Leo IA</title><style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#222;line-height:1.7}h1{font-size:24px}h2{font-size:18px;margin-top:32px}</style></head><body><h1>Política de Privacidade</h1><p>Última atualização: março de 2026</p><p>O Gestor Leo IA é uma ferramenta de gestão de tráfego pago que se conecta à API de Marketing da Meta para criar e gerenciar campanhas publicitárias.</p><h2>Dados coletados</h2><p>O aplicativo acessa dados da sua conta de anúncios do Meta Ads exclusivamente para exibição e gerenciamento interno. Nenhum dado é compartilhado com terceiros.</p><h2>Uso dos dados</h2><p>Os dados são usados apenas para criação e gerenciamento de campanhas, exibição de métricas e geração de relatórios internos.</p><h2>Armazenamento</h2><p>Tokens de acesso são armazenados de forma segura e usados exclusivamente para autenticação com a API da Meta.</p><h2>Contato</h2><p>contato@emporiopascoto.com.br</p></body></html>`);
});

app.get("/exclusao-dados", (_req, res) => {
  res.status(200).send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Exclusão de Dados — Gestor Leo IA</title><style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#222;line-height:1.7}h1{font-size:24px}</style></head><body><h1>Exclusão de Dados</h1><p>Para solicitar a exclusão dos seus dados do Gestor Leo IA, entre em contato pelo e-mail abaixo. Seus dados serão removidos em até 30 dias.</p><p><strong>E-mail:</strong> contato@emporiopascoto.com.br</p></body></html>`);
});

// Callback de exclusão de dados exigido pela Meta (GET e POST)
app.all("/exclusao-dados/callback", (_req, res) => {
  const confirmationCode = `del_${Date.now()}`;
  res.status(200).json({ url: "https://gestor-trafego-backend.vercel.app/exclusao-dados", confirmation_code: confirmationCode });
});

// ─── Version / deploy info ───
const _versionInfo = (() => { try { return require("./version.json"); } catch { return { sha: "local", message: "" }; } })();
app.get("/api/version", (_req, res) => {
  res.json({ sha: _versionInfo.sha, message: _versionInfo.message });
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
app.use("/api/debug-adset", authMiddleware, require("./routes/debug-adset"));
app.use("/api/debug-ad", authMiddleware, require("./routes/debug-ad"));

// ─── App data (single request carrega tudo) ───
app.get("/api/app-data", authMiddleware, (req, res) => {
  const { findAll } = require("./db/database");
  const uid = req.userId;
  const connRows = findAll("connections", r => r.user_id === uid);
  const connections = {};
  for (const r of connRows) {
    connections[r.platform] = { connected: !!r.connected, account: r.account_name, lastSync: r.last_sync, status: r.status };
  }
  const campaigns  = findAll("campaigns",  r => r.user_id === uid);
  const adsets     = findAll("adsets",     r => r.user_id === uid);
  const ads        = findAll("ads",        r => r.user_id === uid);
  const creatives  = findAll("creatives",  r => r.user_id === uid);
  const audiences  = findAll("audiences",  r => r.user_id === uid);
  const keywords   = findAll("keywords",   r => r.user_id === uid);
  const alerts     = findAll("alerts",     r => r.user_id === uid && !r.resolved);
  res.json({ connections, campaigns, adsets, ads, creatives, audiences, keywords, alerts });
});

// ─── Adsets list ───
app.get("/api/adsets", authMiddleware, (req, res) => {
  const { findAll } = require("./db/database");
  const adsets = findAll("adsets", r => r.user_id === req.userId);
  const result = adsets.map(a => ({
    id: a.id,
    name: a.name,
    campaign_id: a.campaign_id,
    meta_adset_id: a.external_id?.startsWith("meta_") ? a.external_id.replace("meta_", "") : null,
    status: a.status,
  }));
  res.json(result);
});

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
