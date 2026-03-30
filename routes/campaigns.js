const express = require("express");
const { findAll, findOne, insert, update, remove } = require("../db/database");

const router = express.Router();
const API = "https://graph.facebook.com/v22.0";

// ─── GET /api/campaigns — lista campanhas em TEMPO REAL da Meta ───
// Query params: ?status=ACTIVE|PAUSED|ALL (padrão: ALL)
router.get("/", async (req, res) => {
  const statusFilter = (req.query.status || "ALL").toUpperCase();

  // Tenta buscar da Meta em tempo real
  const tok = findOne("oauth_tokens", t => t.user_id === req.userId && t.platform === "meta");
  if (!tok?.access_token || !tok?.ad_account_id) {
    // Sem Meta conectado — retorna do DB local
    let rows = findAll("campaigns", r => r.user_id === req.userId);
    if (statusFilter !== "ALL") {
      const statusMap = { ACTIVE: "Ativa", PAUSED: "Pausada" };
      rows = rows.filter(r => r.status === statusMap[statusFilter] || r.status === statusFilter);
    }
    return res.json(rows.reverse());
  }

  try {
    // Busca campanhas + métricas reais da Meta em paralelo
    const fields = "id,name,status,objective,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,buying_type,special_ad_categories";
    const insightFields = "campaign_id,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,reach,frequency";

    let statusParam = "";
    if (statusFilter === "ACTIVE") statusParam = `&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]`;
    else if (statusFilter === "PAUSED") statusParam = `&filtering=[{"field":"effective_status","operator":"IN","value":["PAUSED"]}]`;

    const [campRes, insightsRes] = await Promise.all([
      fetch(`${API}/act_${tok.ad_account_id}/campaigns?fields=${fields}&limit=200${statusParam}&access_token=${encodeURIComponent(tok.access_token)}`),
      fetch(`${API}/act_${tok.ad_account_id}/insights?fields=${insightFields}&level=campaign&date_preset=last_30d&limit=200&access_token=${encodeURIComponent(tok.access_token)}`),
    ]);

    const campData = campRes.ok ? (await campRes.json()).data || [] : [];
    const insightsData = insightsRes.ok ? (await insightsRes.json()).data || [] : [];

    // Cria mapa de insights por campaign_id
    const insightsMap = {};
    for (const row of insightsData) {
      const actions = row.actions || [];
      const actionValues = row.action_values || [];
      const costPerAction = row.cost_per_action_type || [];
      const leadTypes = ["offsite_conversion.fb_pixel_lead", "lead", "onsite_conversion.lead_grouped"];
      const purchaseTypes = ["offsite_conversion.fb_pixel_purchase", "purchase"];
      const leads = actions.find(a => leadTypes.includes(a.action_type));
      const purchases = actions.find(a => purchaseTypes.includes(a.action_type));
      const purchaseValue = actionValues.find(a => purchaseTypes.includes(a.action_type));
      const cplObj = costPerAction.find(a => leadTypes.includes(a.action_type));
      const spend = parseFloat(row.spend || 0);
      const leadCount = leads ? parseInt(leads.value) : 0;
      const purchaseCount = purchases ? parseInt(purchases.value) : 0;
      const revenue = purchaseValue ? parseFloat(purchaseValue.value) : 0;
      insightsMap[row.campaign_id] = {
        spend, impressions: parseInt(row.impressions || 0), clicks: parseInt(row.clicks || 0),
        ctr: parseFloat(row.ctr || 0), cpc: parseFloat(row.cpc || 0), cpm: parseFloat(row.cpm || 0),
        reach: parseInt(row.reach || 0), frequency: parseFloat(row.frequency || 0),
        leads: leadCount, purchases: purchaseCount, revenue,
        cpl: cplObj ? parseFloat(cplObj.value) : (leadCount > 0 ? spend / leadCount : 0),
        roas: spend > 0 ? revenue / spend : 0,
      };
    }

    // Monta resposta com dados reais
    const campaigns = campData.map(c => {
      const m = insightsMap[c.id] || {};
      return {
        meta_campaign_id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective || "",
        daily_budget: c.daily_budget ? `R$ ${(parseInt(c.daily_budget) / 100).toFixed(2)}` : null,
        lifetime_budget: c.lifetime_budget ? `R$ ${(parseInt(c.lifetime_budget) / 100).toFixed(2)}` : null,
        budget_remaining: c.budget_remaining ? `R$ ${(parseInt(c.budget_remaining) / 100).toFixed(2)}` : null,
        buying_type: c.buying_type,
        special_ad_categories: c.special_ad_categories || [],
        created_time: c.created_time,
        updated_time: c.updated_time,
        // Métricas últimos 30 dias
        spend: m.spend ? `R$ ${m.spend.toFixed(2)}` : "R$ 0,00",
        spend_raw: m.spend || 0,
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        ctr: m.ctr ? `${m.ctr.toFixed(2)}%` : "0.00%",
        cpc: m.cpc ? `R$ ${m.cpc.toFixed(2)}` : "R$ 0,00",
        cpm: m.cpm ? `R$ ${m.cpm.toFixed(2)}` : "R$ 0,00",
        reach: m.reach || 0,
        frequency: m.frequency ? m.frequency.toFixed(2) : "0.00",
        leads: m.leads || 0,
        cpl: m.cpl > 0 ? `R$ ${m.cpl.toFixed(2)}` : "—",
        purchases: m.purchases || 0,
        revenue: m.revenue > 0 ? `R$ ${m.revenue.toFixed(2)}` : "—",
        roas: m.roas > 0 ? `${m.roas.toFixed(1)}x` : "—",
        channel: "Meta",
        source: "live", // indica que veio em tempo real da API
      };
    });

    res.json(campaigns);
  } catch (err) {
    console.error("[Campaigns] Erro ao buscar da Meta, fallback para DB local:", err.message);
    // Fallback para DB local
    let rows = findAll("campaigns", r => r.user_id === req.userId);
    if (statusFilter !== "ALL") {
      const statusMap = { ACTIVE: "Ativa", PAUSED: "Pausada" };
      rows = rows.filter(r => r.status === statusMap[statusFilter] || r.status === statusFilter);
    }
    res.json(rows.reverse());
  }
});

router.get("/:id", (req, res) => {
  const row = findOne("campaigns", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!row) return res.status(404).json({ error: "Campanha não encontrada" });
  res.json(row);
});

router.post("/", (req, res) => {
  const { name, channel, status, budget, objective } = req.body;
  if (!name || !channel) return res.status(400).json({ error: "Nome e canal são obrigatórios" });
  const campaign = insert("campaigns", {
    user_id: req.userId, name, channel, status: status || "Ativa",
    budget: budget || "R$ 0", spend: "R$ 0", conv: 0, cpa: "R$ 0", roas: "0.0x", ctr: "0.00%", objective: objective || "",
  });
  res.status(201).json(campaign);
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = findOne("campaigns", r => r.id === id && r.user_id === req.userId);
  if (!existing) return res.status(404).json({ error: "Campanha não encontrada" });
  const { name, status, budget, spend, conv, cpa, roas, ctr } = req.body;
  update("campaigns", r => r.id === id, (r) => ({
    name: name ?? r.name, status: status ?? r.status, budget: budget ?? r.budget,
    spend: spend ?? r.spend, conv: conv ?? r.conv, cpa: cpa ?? r.cpa, roas: roas ?? r.roas, ctr: ctr ?? r.ctr,
  }));
  res.json(findOne("campaigns", r => r.id === id));
});

router.delete("/:id", (req, res) => {
  const removed = remove("campaigns", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Campanha não encontrada" });
  res.json({ success: true });
});

module.exports = router;
