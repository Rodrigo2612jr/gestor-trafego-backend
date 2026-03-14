const express = require("express");
const { findAll, findOne, update, remove: dbRemove, insert } = require("../db/database");

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
