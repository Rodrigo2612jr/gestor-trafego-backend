const express = require("express");
const { findAll, findOne, update, remove: dbRemove, insert, awaitUpsert } = require("../db/database");

const router = express.Router();

// Platforms that need OAuth for real data sync
const OAUTH_PLATFORMS = ["google", "meta", "analytics", "tagmanager", "pixel"];

router.get("/", (req, res) => {
  const rows = findAll("connections", r => r.user_id === req.userId);
  const map = {};
  for (const r of rows) {
    map[r.platform] = { connected: !!r.connected, account: r.account_name, lastSync: r.last_sync, status: r.status, needsOAuth: OAUTH_PLATFORMS.includes(r.platform) };
  }
  res.json(map);
});

router.post("/:platform/connect", (req, res) => {
  const { platform } = req.params;

  // OAuth platforms MUST use the OAuth flow (/oauth/google/auth-url or /oauth/meta/auth-url)
  if (OAUTH_PLATFORMS.includes(platform)) {
    return res.status(400).json({
      error: `Para conectar ${platform === "google" ? "Google Ads" : platform === "meta" ? "Meta Ads" : platform}, use o fluxo OAuth. Clique em Conectar para abrir a janela de autorização.`,
      needsOAuth: true,
      oauthPlatform: ["analytics", "tagmanager"].includes(platform) ? "google" : platform,
    });
  }

  // Non-OAuth platforms (crm, webhook, api) — simple connect
  const now = new Date().toISOString();
  const accountName = req.body.account_name || `Conta ${platform}`;
  const changes = update("connections", r => r.user_id === req.userId && r.platform === platform, () => ({
    connected: true, status: "connected", last_sync: now, account_name: accountName,
  }));
  if (!changes) return res.status(404).json({ error: "Plataforma não encontrada" });

  res.json({ connected: true, account: accountName, lastSync: now, status: "connected" });
});

// Meta: conectar via token direto (sem OAuth)
const { syncAll } = require("../services/sync");
router.post("/meta/connect-token", async (req, res) => {
  const { access_token, ad_account_id } = req.body;
  if (!access_token) return res.status(400).json({ error: "access_token é obrigatório" });

  // Valida o token com a API do Meta
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(access_token)}`);
    const info = await r.json();
    if (info.error) return res.status(400).json({ error: "Token inválido: " + info.error.message });

    const now = new Date().toISOString();
    const accountName = info.name || "Meta Ads";

    // Salva ad_account_id no token para persistir entre requests
    const cleanAccountId = ad_account_id ? ad_account_id.replace("act_", "") : null;

    // Salva o token
    const { findOne, insert, update: dbUpdate } = require("../db/database");
    const existing = findOne("oauth_tokens", t => t.user_id === req.userId && t.platform === "meta");
    if (existing) {
      dbUpdate("oauth_tokens", t => t.id === existing.id, () => ({ access_token, expires_at: Date.now() + 5184000000, ad_account_id: cleanAccountId }));
    } else {
      insert("oauth_tokens", { user_id: req.userId, platform: "meta", access_token, refresh_token: null, expires_at: Date.now() + 5184000000, scope: "ads_management,ads_read", ad_account_id: cleanAccountId });
    }

    update("connections", r => r.user_id === req.userId && r.platform === "meta", () => ({
      connected: true, status: "connected", last_sync: now, account_name: accountName,
    }));

    // Aguarda confirmação do Supabase antes de responder
    const conn = findOne("connections", r => r.user_id === req.userId && r.platform === "meta");
    if (conn) await awaitUpsert("connections", conn);

    // Dispara sync em background para buscar campanhas do Meta
    syncAll(req.userId).catch(err => console.error("Meta sync error:", err.message));

    res.json({ connected: true, account: accountName, lastSync: now, status: "connected" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao validar token: " + err.message });
  }
});

router.post("/:platform/disconnect", (req, res) => {
  const { platform } = req.params;
  update("connections", r => r.user_id === req.userId && r.platform === platform, () => ({
    connected: false, status: "disconnected", last_sync: null, account_name: null,
  }));
  // Remove OAuth tokens if exists
  dbRemove("oauth_tokens", t => t.user_id === req.userId && t.platform === platform);
  res.json({ connected: false, account: null, lastSync: null, status: "disconnected" });
});

module.exports = router;
