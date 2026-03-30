const express = require("express");
const { findAll, findOne } = require("../db/database");

const router = express.Router();

const PERIOD_MAP = { "today": "today", "yesterday": "yesterday", "7d": "last_7d", "14d": "last_14d", "30d": "last_30d", "90d": "last_90d" };
const API = "https://graph.facebook.com/v22.0";

// Mapa de período atual → período anterior para cálculo de change %
const PREV_PERIOD_MAP = {
  today: "yesterday", yesterday: "last_3d", last_7d: "last_14d",
  last_14d: "last_30d", last_30d: "last_90d", last_90d: "last_90d",
};

function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[^0-9,.-]/g, "").replace(".", "").replace(",", ".")) || 0;
}

// Helper para extrair leads/purchases de actions
function extractActions(actions = [], actionValues = [], costPerAction = []) {
  const leadTypes = ["offsite_conversion.fb_pixel_lead", "lead", "onsite_conversion.lead_grouped"];
  const purchaseTypes = ["offsite_conversion.fb_pixel_purchase", "purchase"];

  const leadAction = actions.find(a => leadTypes.includes(a.action_type));
  const purchaseAction = actions.find(a => purchaseTypes.includes(a.action_type));
  const purchaseValueAction = actionValues.find(a => purchaseTypes.includes(a.action_type));
  const cplAction = costPerAction.find(a => leadTypes.includes(a.action_type));

  return {
    leads: leadAction ? parseInt(leadAction.value) : 0,
    purchases: purchaseAction ? parseInt(purchaseAction.value) : 0,
    revenue: purchaseValueAction ? parseFloat(purchaseValueAction.value) : 0,
    cpl: cplAction ? parseFloat(cplAction.value) : 0,
  };
}

async function fetchMetaInsights(token, adAccountId, datePreset, { campaignId, statusFilter } = {}) {
  try {
    const fields = "spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,reach,frequency";

    // Se filtra por campanha específica, busca insights só dessa campanha
    let summaryFilter = "";
    let dailyFilter = "";
    let campInsightsFilter = "";
    if (campaignId) {
      const filter = `&filtering=[{"field":"campaign.id","operator":"IN","value":["${campaignId}"]}]`;
      summaryFilter = filter;
      dailyFilter = filter;
      campInsightsFilter = filter;
    }

    // Filtro por status para a lista de campanhas
    let campStatusFilter = "";
    if (statusFilter && statusFilter !== "ALL") {
      campStatusFilter = `&filtering=[{"field":"effective_status","operator":"IN","value":["${statusFilter}"]}]`;
    }

    const [summaryRes, dailyRes, campRes, campInsightsRes] = await Promise.all([
      fetch(`${API}/act_${adAccountId}/insights?fields=${fields}&date_preset=${datePreset}${summaryFilter}&access_token=${encodeURIComponent(token)}`),
      fetch(`${API}/act_${adAccountId}/insights?fields=spend,impressions,clicks,actions,action_values&date_preset=${datePreset}&time_increment=1${dailyFilter}&access_token=${encodeURIComponent(token)}`),
      fetch(`${API}/act_${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget&limit=200${campStatusFilter}&access_token=${encodeURIComponent(token)}`),
      fetch(`${API}/act_${adAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,reach,frequency&level=campaign&date_preset=${datePreset}${campInsightsFilter}&limit=50&access_token=${encodeURIComponent(token)}`),
    ]);
    const summary = summaryRes.ok ? (await summaryRes.json()).data?.[0] || {} : {};
    const daily = dailyRes.ok ? (await dailyRes.json()).data || [] : [];
    const campData = campRes.ok ? (await campRes.json()).data || [] : [];
    const campInsights = campInsightsRes.ok ? (await campInsightsRes.json()).data || [] : [];
    const activeCampaigns = campData.filter(c => c.effective_status === "ACTIVE").length;
    const pausedCampaigns = campData.filter(c => c.effective_status !== "ACTIVE").length;
    return { summary, daily, activeCampaigns, pausedCampaigns, totalCampaigns: campData.length, campInsights, campaignsList: campData };
  } catch { return { summary: {}, daily: [], activeCampaigns: 0, pausedCampaigns: 0, totalCampaigns: 0, campInsights: [], campaignsList: [] }; }
}

async function fetchMetaPreviousPeriod(token, adAccountId, datePreset) {
  const prevPreset = PREV_PERIOD_MAP[datePreset] || "last_30d";
  try {
    const fields = "spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,cost_per_action_type,reach,frequency";
    const res = await fetch(`${API}/act_${adAccountId}/insights?fields=${fields}&date_preset=${prevPreset}&access_token=${encodeURIComponent(token)}`);
    return res.ok ? (await res.json()).data?.[0] || {} : {};
  } catch { return {}; }
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return 0;
  return Math.round((current - previous) / Math.abs(previous) * 100);
}

// Query params suportados:
//   period: today|7d|14d|30d|90d (padrão: 30d)
//   campaign_id: Meta Campaign ID para filtrar (ex: 120218406...)
//   status: ACTIVE|PAUSED|ALL (padrão: ALL)
router.get("/", async (req, res) => {
  const period = req.query.period || "30d";
  const datePreset = PERIOD_MAP[period] || "last_30d";
  const campaignId = req.query.campaign_id || null;
  const statusFilter = (req.query.status || "ALL").toUpperCase();

  const allConnections = findAll("connections", r => r.user_id === req.userId);
  const connections = {};
  for (const r of allConnections) connections[r.platform] = r;

  const hasMeta = connections.meta?.connected;
  const hasGoogle = connections.google?.connected;
  const campaigns = findAll("campaigns", r => r.user_id === req.userId);

  const emptyKpis = [
    { label: "Investimento Total", value: "R$ 0", change: 0 },
    { label: "Leads", value: "0", change: 0 },
    { label: "Custo por Lead", value: "R$ 0,00", change: 0 },
    { label: "CTR Médio", value: "0.0%", change: 0 },
    { label: "Impressões", value: "0", change: 0 },
    { label: "Campanhas Ativas", value: "0", change: 0 },
    { label: "CPC Médio", value: "R$ 0,00", change: 0 },
    { label: "CPM Médio", value: "R$ 0,00", change: 0 },
    { label: "Alcance", value: "0", change: 0 },
    { label: "Frequência", value: "0", change: 0 },
    { label: "CPA Médio", value: "R$ 0,00", change: 0 },
    { label: "ROAS Médio", value: "0.0x", change: 0 },
  ];

  if (!hasMeta && !hasGoogle) {
    return res.json({
      kpis: emptyKpis,
      chartData: [], pieData: [], funnelData: [], topCampaigns: [],
      insights: [{ type: "info", text: "Conecte Meta Ads ou Google Ads para ver dados reais.", priority: "Alta" }],
    });
  }

  // Fetch live Meta insights for selected period + previous period for comparison
  let meta = { summary: {}, daily: [], activeCampaigns: 0, pausedCampaigns: 0, totalCampaigns: 0, campInsights: [], campaignsList: [] };
  let metaPrev = {};
  if (hasMeta) {
    const tok = findOne("oauth_tokens", t => t.user_id === req.userId && t.platform === "meta");
    if (tok?.access_token && tok?.ad_account_id) {
      [meta, metaPrev] = await Promise.all([
        fetchMetaInsights(tok.access_token, tok.ad_account_id, datePreset, { campaignId, statusFilter }),
        fetchMetaPreviousPeriod(tok.access_token, tok.ad_account_id, datePreset),
      ]);
    }
  }

  // Parse current period metrics
  const metaSpend = parseFloat(meta.summary.spend || 0);
  const metaImpressions = parseInt(meta.summary.impressions || 0);
  const metaClicks = parseInt(meta.summary.clicks || 0);
  const metaCtr = parseFloat(meta.summary.ctr || 0);
  const metaCpc = parseFloat(meta.summary.cpc || 0);
  const metaCpm = parseFloat(meta.summary.cpm || 0);
  const metaReach = parseInt(meta.summary.reach || 0);
  const metaFrequency = parseFloat(meta.summary.frequency || 0);
  const currentActions = extractActions(meta.summary.actions, meta.summary.action_values, meta.summary.cost_per_action_type);

  // Parse previous period metrics
  const prevSpend = parseFloat(metaPrev.spend || 0);
  const prevImpressions = parseInt(metaPrev.impressions || 0);
  const prevClicks = parseInt(metaPrev.clicks || 0);
  const prevCtr = parseFloat(metaPrev.ctr || 0);
  const prevCpc = parseFloat(metaPrev.cpc || 0);
  const prevCpm = parseFloat(metaPrev.cpm || 0);
  const prevReach = parseInt(metaPrev.reach || 0);
  const prevFrequency = parseFloat(metaPrev.frequency || 0);
  const prevActions = extractActions(metaPrev.actions, metaPrev.action_values, metaPrev.cost_per_action_type);

  const metaCPL = currentActions.cpl > 0 ? currentActions.cpl : (currentActions.leads > 0 ? metaSpend / currentActions.leads : 0);
  const prevCPL = prevActions.cpl > 0 ? prevActions.cpl : (prevActions.leads > 0 ? prevSpend / prevActions.leads : 0);

  const googleCampaigns = campaigns.filter(c => c.channel === "Google");
  const googleSpend = googleCampaigns.reduce((s, c) => s + parseMoney(c.spend), 0);
  const googleConv = googleCampaigns.reduce((s, c) => s + (c.conv || 0), 0);

  const totalSpend = metaSpend + googleSpend;
  const totalConv = currentActions.purchases + googleConv;
  const totalConvValue = currentActions.revenue;
  const roas = totalSpend > 0 ? totalConvValue / totalSpend : 0;
  const prevRoas = prevSpend > 0 ? prevActions.revenue / prevSpend : 0;
  const cpa = totalConv > 0 ? totalSpend / totalConv : 0;
  const prevCpa = (prevActions.purchases + googleConv) > 0 ? (prevSpend + googleSpend) / (prevActions.purchases + googleConv) : 0;

  // Chart data from daily Meta insights (with leads/day)
  const chartData = meta.daily.map(d => {
    const dayActions = extractActions(d.actions, d.action_values);
    return {
      day: d.date_start?.slice(5) || d.date_start,
      meta: parseFloat(d.spend || 0),
      google: 0,
      impressions: parseInt(d.impressions || 0),
      clicks: parseInt(d.clicks || 0),
      leads: dayActions.leads,
      purchases: dayActions.purchases,
    };
  });

  const pieData = [];
  if (googleSpend > 0) pieData.push({ name: "Google Ads", value: Math.round(googleSpend), color: "#6366f1" });
  if (metaSpend > 0) pieData.push({ name: "Meta Ads", value: Math.round(metaSpend), color: "#22d3ee" });

  // Top campaigns by spend with full metrics
  const topCampaigns = meta.campInsights.map(row => {
    const rowActions = extractActions(row.actions, row.action_values, row.cost_per_action_type);
    const spend = parseFloat(row.spend || 0);
    const campRoas = spend > 0 ? rowActions.revenue / spend : 0;
    return {
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      spend: `R$ ${spend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      spend_raw: spend,
      impressions: parseInt(row.impressions || 0),
      clicks: parseInt(row.clicks || 0),
      ctr: `${parseFloat(row.ctr || 0).toFixed(2)}%`,
      cpc: `R$ ${parseFloat(row.cpc || 0).toFixed(2)}`,
      cpm: `R$ ${parseFloat(row.cpm || 0).toFixed(2)}`,
      reach: parseInt(row.reach || 0),
      frequency: parseFloat(row.frequency || 0).toFixed(2),
      leads: rowActions.leads,
      cpl: rowActions.cpl > 0 ? `R$ ${rowActions.cpl.toFixed(2)}` : (rowActions.leads > 0 ? `R$ ${(spend / rowActions.leads).toFixed(2)}` : "—"),
      purchases: rowActions.purchases,
      revenue: rowActions.revenue > 0 ? `R$ ${rowActions.revenue.toFixed(2)}` : "—",
      roas: campRoas > 0 ? `${campRoas.toFixed(1)}x` : "—",
    };
  }).sort((a, b) => b.spend_raw - a.spend_raw);

  // Insights inteligentes
  const insights = [];
  if (roas > 3) insights.push({ type: "success", text: `ROAS de ${roas.toFixed(1)}x no período — acima da meta. Escale as melhores campanhas.`, priority: "Alta" });
  else if (roas > 0 && roas < 2) insights.push({ type: "warning", text: `ROAS de ${roas.toFixed(1)}x abaixo do ideal. Revise segmentação e criativos.`, priority: "Alta" });

  if (metaClicks > 0 && metaCtr < 1) insights.push({ type: "warning", text: `CTR médio de ${metaCtr.toFixed(2)}% está baixo. Teste novos criativos.`, priority: "Alta" });
  else if (metaCtr > 3) insights.push({ type: "success", text: `CTR de ${metaCtr.toFixed(2)}% está excelente — criativos performando bem.`, priority: "Baixa" });

  if (metaFrequency > 3.5) insights.push({ type: "warning", text: `Frequência de ${metaFrequency.toFixed(1)} — público saturado. Renove criativos ou expanda audiência.`, priority: "Alta" });

  if (metaCpm > 50) insights.push({ type: "warning", text: `CPM de R$ ${metaCpm.toFixed(2)} está alto. Considere testar novos públicos ou posicionamentos.`, priority: "Alta" });
  else if (metaCpm > 0 && metaCpm < 20) insights.push({ type: "success", text: `CPM de R$ ${metaCpm.toFixed(2)} está saudável para o nicho.`, priority: "Baixa" });

  if (currentActions.leads > 0 && metaCPL > 25) insights.push({ type: "warning", text: `CPL de R$ ${metaCPL.toFixed(2)} está alto. Otimize a landing page ou teste novos ângulos.`, priority: "Alta" });

  if (pctChange(metaSpend, prevSpend) > 30 && roas < 2) insights.push({ type: "warning", text: `Gasto aumentou ${pctChange(metaSpend, prevSpend)}% vs período anterior, mas ROAS não acompanhou. Revise alocação.`, priority: "Alta" });

  if (totalSpend > 0) insights.push({ type: "info", text: `Gasto no período: R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — ${meta.daily.length} dias de dados. ${meta.activeCampaigns} campanhas ativas, ${meta.pausedCampaigns} pausadas.`, priority: "Baixa" });

  // Top performer insight
  if (topCampaigns.length > 0 && topCampaigns[0].spend_raw > 0) {
    const top = topCampaigns[0];
    insights.push({ type: "info", text: `Maior investimento: "${top.campaign_name}" com ${top.spend} (${top.leads > 0 ? top.leads + " leads" : top.clicks + " cliques"}).`, priority: "Baixa" });
  }

  const funnelData = metaImpressions > 0 ? [
    { stage: "Alcance", rate: "—", google: 0, meta: metaReach },
    { stage: "Impressões", rate: "100%", google: 0, meta: metaImpressions },
    { stage: "Cliques", rate: `${metaCtr.toFixed(1)}%`, google: 0, meta: metaClicks },
    { stage: "Leads", rate: metaClicks > 0 ? `${(currentActions.leads / metaClicks * 100).toFixed(1)}%` : "0%", google: 0, meta: currentActions.leads },
    { stage: "Compras", rate: currentActions.leads > 0 ? `${(currentActions.purchases / currentActions.leads * 100).toFixed(1)}%` : (metaClicks > 0 ? `${(currentActions.purchases / metaClicks * 100).toFixed(1)}%` : "0%"), google: 0, meta: currentActions.purchases },
  ] : [];

  res.json({
    kpis: [
      { label: "Investimento Total", value: `R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, change: pctChange(totalSpend, prevSpend + googleSpend) },
      { label: "Leads", value: currentActions.leads.toLocaleString("pt-BR"), change: pctChange(currentActions.leads, prevActions.leads) },
      { label: "Custo por Lead", value: metaCPL > 0 ? `R$ ${metaCPL.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$ 0,00", change: pctChange(metaCPL, prevCPL) * -1 },
      { label: "CTR Médio", value: `${metaCtr.toFixed(2)}%`, change: pctChange(metaCtr, prevCtr) },
      { label: "Impressões", value: metaImpressions.toLocaleString("pt-BR"), change: pctChange(metaImpressions, prevImpressions) },
      { label: "Campanhas Ativas", value: meta.activeCampaigns.toString(), change: 0 },
      { label: "CPC Médio", value: `R$ ${metaCpc.toFixed(2)}`, change: pctChange(metaCpc, prevCpc) * -1 },
      { label: "CPM Médio", value: `R$ ${metaCpm.toFixed(2)}`, change: pctChange(metaCpm, prevCpm) * -1 },
      { label: "Alcance", value: metaReach.toLocaleString("pt-BR"), change: pctChange(metaReach, prevReach) },
      { label: "Frequência", value: metaFrequency.toFixed(2), change: pctChange(metaFrequency, prevFrequency) * -1 },
      { label: "CPA Médio", value: `R$ ${cpa.toFixed(2)}`, change: pctChange(cpa, prevCpa) * -1 },
      { label: "ROAS Médio", value: `${roas.toFixed(1)}x`, change: pctChange(roas, prevRoas) },
    ],
    chartData, pieData, insights, funnelData, topCampaigns, connected: true,
    // Filtros ativos
    filters: {
      period,
      campaign_id: campaignId,
      status: statusFilter,
    },
    // Lista de campanhas para dropdown de filtro no frontend
    campaignsList: meta.campaignsList.map(c => ({
      id: c.id,
      name: c.name,
      status: c.effective_status || c.status,
      objective: c.objective || "",
      daily_budget: c.daily_budget ? `R$ ${(parseInt(c.daily_budget) / 100).toFixed(2)}` : null,
    })),
    summary: {
      totalCampaigns: meta.totalCampaigns,
      activeCampaigns: meta.activeCampaigns,
      pausedCampaigns: meta.pausedCampaigns,
      totalLeads: currentActions.leads,
      totalPurchases: currentActions.purchases,
      totalRevenue: currentActions.revenue > 0 ? `R$ ${currentActions.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "R$ 0,00",
    },
  });
});

module.exports = router;
