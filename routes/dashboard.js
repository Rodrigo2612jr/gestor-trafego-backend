const express = require("express");
const { findAll, findOne } = require("../db/database");

const router = express.Router();

const PERIOD_MAP = { "today": "today", "7d": "last_7d", "14d": "last_14d", "30d": "last_30d", "90d": "last_90d" };

function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[^0-9,.-]/g, "").replace(".", "").replace(",", ".")) || 0;
}

async function fetchMetaInsights(token, adAccountId, datePreset) {
  const API = "https://graph.facebook.com/v21.0";
  try {
    const [summaryRes, dailyRes, campRes] = await Promise.all([
      fetch(`${API}/act_${adAccountId}/insights?fields=spend,impressions,clicks,ctr,actions,action_values,cost_per_action_type&date_preset=${datePreset}&access_token=${encodeURIComponent(token)}`),
      fetch(`${API}/act_${adAccountId}/insights?fields=spend,impressions,clicks,actions,action_values&date_preset=${datePreset}&time_increment=1&access_token=${encodeURIComponent(token)}`),
      fetch(`${API}/act_${adAccountId}/campaigns?fields=id,status&limit=200&access_token=${encodeURIComponent(token)}`),
    ]);
    const summary = summaryRes.ok ? (await summaryRes.json()).data?.[0] || {} : {};
    const daily = dailyRes.ok ? (await dailyRes.json()).data || [] : [];
    const campData = campRes.ok ? (await campRes.json()).data || [] : [];
    const activeCampaigns = campData.filter(c => c.status === "ACTIVE").length;
    return { summary, daily, activeCampaigns };
  } catch { return { summary: {}, daily: [], activeCampaigns: 0 }; }
}

router.get("/", async (req, res) => {
  const period = req.query.period || "30d";
  const datePreset = PERIOD_MAP[period] || "last_30d";

  const allConnections = findAll("connections", r => r.user_id === req.userId);
  const connections = {};
  for (const r of allConnections) connections[r.platform] = r;

  const hasMeta = connections.meta?.connected;
  const hasGoogle = connections.google?.connected;
  const campaigns = findAll("campaigns", r => r.user_id === req.userId);

  if (!hasMeta && !hasGoogle) {
    return res.json({
      kpis: [
        { label: "Investimento Total", value: "R$ 0", change: 0 },
        { label: "ROAS Médio", value: "0.0x", change: 0 },
        { label: "CPA Médio", value: "R$ 0,00", change: 0 },
        { label: "CTR Médio", value: "0.0%", change: 0 },
        { label: "Conversões", value: "0", change: 0 },
        { label: "Campanhas Ativas", value: "0", change: 0 },
        { label: "Impressões", value: "0", change: 0 },
        { label: "Receita Est.", value: "R$ 0", change: 0 },
      ],
      chartData: [], pieData: [], funnelData: [],
      insights: [{ type: "info", text: "Conecte Meta Ads ou Google Ads para ver dados reais.", priority: "Alta" }],
    });
  }

  // Fetch live Meta insights for selected period
  let metaSummary = {};
  let metaDaily = [];
  let metaActiveCampaigns = null;
  if (hasMeta) {
    const tok = findOne("oauth_tokens", t => t.user_id === req.userId && t.platform === "meta");
    if (tok?.access_token && tok?.ad_account_id) {
      const result = await fetchMetaInsights(tok.access_token, tok.ad_account_id, datePreset);
      metaSummary = result.summary;
      metaDaily = result.daily;
      metaActiveCampaigns = result.activeCampaigns;
    }
  }

  const metaSpend = parseFloat(metaSummary.spend || 0);
  const metaImpressions = parseInt(metaSummary.impressions || 0);
  const metaClicks = parseInt(metaSummary.clicks || 0);
  const metaCtr = parseFloat(metaSummary.ctr || 0);
  const actions = metaSummary.actions || [];
  const actionValues = metaSummary.action_values || [];
  const purchases = actions.find(a => a.action_type === "offsite_conversion.fb_pixel_purchase" || a.action_type === "purchase");
  const metaConv = purchases ? parseInt(purchases.value) : 0;
  const convValueObj = actionValues.find(a => a.action_type === "offsite_conversion.fb_pixel_purchase" || a.action_type === "purchase");
  const metaConvValue = convValueObj ? parseFloat(convValueObj.value) : 0;

  const googleCampaigns = campaigns.filter(c => c.channel === "Google");
  const googleSpend = googleCampaigns.reduce((s, c) => s + parseMoney(c.spend), 0);
  const googleConv = googleCampaigns.reduce((s, c) => s + (c.conv || 0), 0);

  const totalSpend = metaSpend + googleSpend;
  const totalConv = metaConv + googleConv;
  const totalConvValue = metaConvValue;
  const roas = totalSpend > 0 ? totalConvValue / totalSpend : 0;
  const cpa = totalConv > 0 ? totalSpend / totalConv : 0;
  const activeCampaigns = metaActiveCampaigns !== null ? metaActiveCampaigns : campaigns.filter(c => c.status === "Ativa" || c.status === "Escalando").length;

  // Chart data from daily Meta insights
  const chartData = metaDaily.map(d => ({
    day: d.date_start?.slice(5) || d.date_start,
    meta: parseFloat(d.spend || 0),
    google: 0,
  }));

  const pieData = [];
  if (googleSpend > 0) pieData.push({ name: "Google Ads", value: Math.round(googleSpend), color: "#6366f1" });
  if (metaSpend > 0) pieData.push({ name: "Meta Ads", value: Math.round(metaSpend), color: "#22d3ee" });

  const insights = [];
  if (roas > 3) insights.push({ type: "success", text: `ROAS de ${roas.toFixed(1)}x no período — acima da meta. Escale as melhores campanhas.`, priority: "Alta" });
  else if (roas > 0 && roas < 2) insights.push({ type: "warning", text: `ROAS de ${roas.toFixed(1)}x abaixo do ideal. Revise segmentação e criativos.`, priority: "Alta" });
  if (metaClicks > 0 && metaCtr < 1) insights.push({ type: "warning", text: `CTR médio de ${metaCtr.toFixed(2)}% está baixo. Teste novos criativos.`, priority: "Alta" });
  if (totalSpend > 0) insights.push({ type: "info", text: `Gasto no período: R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — ${metaDaily.length} dias de dados.`, priority: "Baixa" });

  const funnelData = metaImpressions > 0 ? [
    { stage: "Impressões", rate: "100%", google: 0, meta: metaImpressions },
    { stage: "Cliques", rate: `${metaCtr.toFixed(1)}%`, google: 0, meta: metaClicks },
    { stage: "Conversões", rate: metaClicks > 0 ? `${(metaConv / metaClicks * 100).toFixed(1)}%` : "0%", google: 0, meta: metaConv },
  ] : [];

  res.json({
    kpis: [
      { label: "Investimento Total", value: `R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, change: 0 },
      { label: "ROAS Médio", value: `${roas.toFixed(1)}x`, change: 0 },
      { label: "CPA Médio", value: `R$ ${cpa.toFixed(2)}`, change: 0 },
      { label: "CTR Médio", value: `${metaCtr.toFixed(2)}%`, change: 0 },
      { label: "Conversões", value: totalConv.toString(), change: 0 },
      { label: "Campanhas Ativas", value: activeCampaigns.toString(), change: 0 },
      { label: "Impressões", value: metaImpressions.toLocaleString("pt-BR"), change: 0 },
      { label: "Receita Est.", value: `R$ ${Math.round(metaConvValue).toLocaleString("pt-BR")}`, change: 0 },
    ],
    chartData, pieData, insights, funnelData, connected: true,
  });
});

module.exports = router;
