const express = require("express");
const { getToken } = require("../services/meta-auth");
const { findOne } = require("../db/database");

const router = express.Router();
const API = "https://graph.facebook.com/v21.0";

// GET /api/debug-adset?meta_campaign_id=120242621707460323
// Mostra info da campanha e tenta criar adset mínimo, retornando resposta completa da Meta
router.get("/", async (req, res) => {
  const { meta_campaign_id } = req.query;
  if (!meta_campaign_id) return res.status(400).json({ error: "Passe ?meta_campaign_id=..." });

  const token = getToken(req.userId);
  if (!token) return res.status(401).json({ error: "Meta não conectado" });

  const tok = findOne("oauth_tokens", t => t.user_id === req.userId && t.platform === "meta");
  const adAccountId = tok?.ad_account_id;
  if (!adAccountId) return res.status(400).json({ error: "ad_account_id não encontrado" });

  // 1. Busca info da campanha
  const campRes = await fetch(
    `${API}/${meta_campaign_id}?fields=id,name,objective,daily_budget,lifetime_budget,status&access_token=${encodeURIComponent(token)}`
  );
  const campaign = await campRes.json();

  // 2. Monta payload mínimo baseado no objetivo real
  const OBJECTIVE_TO_GOAL = {
    OUTCOME_LEADS:      { optimization_goal: "LEAD_GENERATION",     billing_event: "IMPRESSIONS", destination_type: "WEBSITE" },
    OUTCOME_SALES:      { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", destination_type: null },
    OUTCOME_TRAFFIC:    { optimization_goal: "LINK_CLICKS",         billing_event: "LINK_CLICKS", destination_type: null },
    OUTCOME_AWARENESS:  { optimization_goal: "REACH",               billing_event: "IMPRESSIONS", destination_type: null },
    OUTCOME_ENGAGEMENT: { optimization_goal: "POST_ENGAGEMENT",     billing_event: "IMPRESSIONS", destination_type: null },
  };

  const goal = OBJECTIVE_TO_GOAL[campaign.objective] || OBJECTIVE_TO_GOAL.OUTCOME_LEADS;
  const hasCBO = !!(campaign.daily_budget || campaign.lifetime_budget);

  const payload = {
    name: "[TESTE] Adset Diagnóstico",
    campaign_id: meta_campaign_id,
    optimization_goal: goal.optimization_goal,
    billing_event: goal.billing_event,
    targeting: {
      age_min: 25,
      age_max: 54,
      genders: [1, 2],
      geo_locations: { countries: ["BR"] },
    },
    status: "PAUSED",
  };

  if (goal.destination_type) payload.destination_type = goal.destination_type;
  if (!hasCBO) payload.daily_budget = 5000; // R$50/dia em centavos

  // 3. Tenta criar na Meta
  const adsetRes = await fetch(
    `${API}/act_${adAccountId}/adsets?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  const adsetResult = await adsetRes.json();

  // 4. Se criou, deleta imediatamente (só era teste)
  if (adsetResult.id) {
    await fetch(`${API}/${adsetResult.id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
  }

  res.json({
    campaign,
    hasCBO,
    payload_enviado: payload,
    resposta_meta: adsetResult,
    sucesso: !!adsetResult.id,
  });
});

module.exports = router;
