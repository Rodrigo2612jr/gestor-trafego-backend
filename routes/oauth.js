const express = require("express");
const jwt = require("jsonwebtoken");
const googleAuth = require("../services/google-auth");
const metaAuth = require("../services/meta-auth");
const { update, findOne } = require("../db/database");
const { syncAll } = require("../services/sync");

const router = express.Router();

// ─── Google OAuth ───
router.get("/google/auth-url", require("../middleware/auth"), (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(400).json({ error: "GOOGLE_CLIENT_ID não configurado. Adicione no .env" });
  const state = jwt.sign({ userId: req.userId }, process.env.JWT_SECRET, { expiresIn: "10m" });
  res.json({ url: googleAuth.getAuthUrl(state) });
});

router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Parâmetros inválidos");

    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const tokens = await googleAuth.exchangeCode(code);

    const info = await googleAuth.getUserInfo(tokens.access_token);

    // Verify user has Google Ads access — try to list accessible customers
    let hasAdsAccount = false;
    let adsAccountName = info.email || "Google Ads";
    try {
      const custRes = await fetch("https://googleads.googleapis.com/v18/customers:listAccessibleCustomers", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
        },
      });
      if (custRes.ok) {
        const custData = await custRes.json();
        if (custData.resourceNames && custData.resourceNames.length > 0) {
          hasAdsAccount = true;
          adsAccountName = `${info.email} (${custData.resourceNames.length} conta(s))`;
        }
      }
    } catch (e) {
      console.error("Google Ads account check error:", e.message);
    }

    if (!hasAdsAccount) {
      // If no developer token configured, we can't verify — inform user
      if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
        const errMsg = "GOOGLE_ADS_DEVELOPER_TOKEN não configurado no servidor. Configure no .env para verificar conta Google Ads.";
        return res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"google",error:"${errMsg}"},"*");window.close();</script><p>Erro: ${errMsg}</p></body></html>`);
      }
      const errMsg = `Nenhuma conta Google Ads encontrada para ${info.email}. Verifique se esta conta do Google tem acesso a uma conta Google Ads.`;
      return res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"google",error:"${errMsg}"},"*");window.close();</script><p>Erro: ${errMsg}</p></body></html>`);
    }

    // Save tokens only after verification
    googleAuth.saveTokens(userId, "google", tokens);
    const now = new Date().toISOString();

    update("connections", c => c.user_id === userId && c.platform === "google", () => ({
      connected: true, status: "connected", last_sync: now, account_name: adsAccountName,
    }));
    update("connections", c => c.user_id === userId && c.platform === "analytics", () => ({
      connected: true, status: "connected", last_sync: now, account_name: info.email || "Analytics",
    }));
    update("connections", c => c.user_id === userId && c.platform === "tagmanager", () => ({
      connected: true, status: "connected", last_sync: now, account_name: info.email || "Tag Manager",
    }));

    syncAll(userId).catch(err => console.error("Initial Google sync error:", err));

    res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_success",platform:"google"},"*");window.close();</script><p>Conectado com sucesso! Pode fechar esta janela.</p></body></html>`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    const safeMsg = (err.message || "Erro desconhecido").replace(/"/g, "'");
    res.status(500).send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"google",error:"${safeMsg}"},"*");window.close();</script><p>Erro: ${safeMsg}</p></body></html>`);
  }
});

// ─── Meta OAuth ───
router.get("/meta/auth-url", require("../middleware/auth"), (req, res) => {
  if (!process.env.META_APP_ID) return res.status(400).json({ error: "META_APP_ID não configurado. Adicione no .env" });
  const state = jwt.sign({ userId: req.userId }, process.env.JWT_SECRET, { expiresIn: "10m" });
  res.json({ url: metaAuth.getAuthUrl(state) });
});

router.get("/meta/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Parâmetros inválidos");

    const { userId } = jwt.verify(state, process.env.JWT_SECRET);
    const shortTokenData = await metaAuth.exchangeCode(code);
    const longTokenData = await metaAuth.getLongLivedToken(shortTokenData.access_token);

    const info = await metaAuth.getUserInfo(longTokenData.access_token);

    // Verify user has a Meta Ad Account
    let hasAdAccount = false;
    let adAccountName = info.name || "Meta Ads";
    try {
      const adRes = await fetch(
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&access_token=${encodeURIComponent(longTokenData.access_token)}`
      );
      if (adRes.ok) {
        const adData = await adRes.json();
        const activeAccounts = (adData.data || []).filter(a => a.account_status === 1); // 1 = ACTIVE
        if (activeAccounts.length > 0) {
          hasAdAccount = true;
          adAccountName = `${info.name} (${activeAccounts.length} conta(s) ativa(s))`;
          // Auto-set the first ad account ID if not configured
          if (!process.env.META_AD_ACCOUNT_ID && activeAccounts[0]?.id) {
            process.env.META_AD_ACCOUNT_ID = activeAccounts[0].id.replace("act_", "");
          }
        } else if ((adData.data || []).length > 0) {
          // Has accounts but none active
          const errMsg = `Encontradas ${adData.data.length} conta(s) Meta Ads, mas nenhuma está ativa. Verifique o status das suas contas de anúncio no Business Manager.`;
          return res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"meta",error:"${errMsg}"},"*");window.close();</script><p>Erro: ${errMsg}</p></body></html>`);
        }
      }
    } catch (e) {
      console.error("Meta Ad Account check error:", e.message);
    }

    if (!hasAdAccount) {
      const errMsg = `Nenhuma conta de anúncio Meta Ads encontrada para ${info.name || "esta conta"}. Verifique se você tem acesso a uma conta de anúncio no Facebook Business Manager.`;
      return res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"meta",error:"${errMsg}"},"*");window.close();</script><p>Erro: ${errMsg}</p></body></html>`);
    }

    // Save tokens only after verification
    metaAuth.saveTokens(userId, longTokenData);
    const now = new Date().toISOString();

    update("connections", c => c.user_id === userId && c.platform === "meta", () => ({
      connected: true, status: "connected", last_sync: now, account_name: adAccountName,
    }));
    update("connections", c => c.user_id === userId && c.platform === "pixel", () => ({
      connected: true, status: "connected", last_sync: now, account_name: "Pixel Meta",
    }));

    syncAll(userId).catch(err => console.error("Initial Meta sync error:", err));

    res.send(`<html><body><script>window.opener?.postMessage({type:"oauth_success",platform:"meta"},"*");window.close();</script><p>Conectado com sucesso! Pode fechar esta janela.</p></body></html>`);
  } catch (err) {
    console.error("Meta OAuth callback error:", err);
    const safeMsg = (err.message || "Erro desconhecido").replace(/"/g, "'");
    res.status(500).send(`<html><body><script>window.opener?.postMessage({type:"oauth_error",platform:"meta",error:"${safeMsg}"},"*");window.close();</script><p>Erro: ${safeMsg}</p></body></html>`);
  }
});

// ─── Manual sync ───
router.post("/sync", require("../middleware/auth"), async (req, res) => {
  try {
    const results = await syncAll(req.userId);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
