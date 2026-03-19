// Meta Marketing API service — fetches real campaign data
const { getToken } = require("./meta-auth");
const { findOne } = require("../db/database");

const API = "https://graph.facebook.com/v21.0";

function getAdAccountId(userId) {
  const tok = findOne("oauth_tokens", t => t.user_id === userId && t.platform === "meta");
  return tok?.ad_account_id || process.env.META_AD_ACCOUNT_ID || null;
}

async function fetchCampaigns(userId) {
  const token = getToken(userId);
  if (!token) return [];
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) return [];

  const fields = "id,name,status,daily_budget,lifetime_budget,objective";
  const insightFields = "spend,actions,cost_per_action_type,ctr,impressions,clicks,action_values";

  // Get campaigns
  const campRes = await fetch(
    `${API}/act_${adAccountId}/campaigns?fields=${fields}&limit=50&access_token=${encodeURIComponent(token)}`
  );
  if (!campRes.ok) {
    console.error("Meta Campaigns API error:", await campRes.text());
    return [];
  }
  const campData = await campRes.json();

  // Get insights for each campaign (last 30 days)
  const results = [];
  for (const camp of campData.data || []) {
    let metrics = {};
    try {
      const insRes = await fetch(
        `${API}/${camp.id}/insights?fields=${insightFields}&date_preset=last_30d&access_token=${encodeURIComponent(token)}`
      );
      if (insRes.ok) {
        const insData = await insRes.json();
        metrics = insData.data?.[0] || {};
      }
    } catch { /* continue without metrics */ }

    const spend = parseFloat(metrics.spend || 0);
    const conversions = (metrics.actions || []).find(a => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value || 0;
    const conv = Number(conversions);
    const convValue = (metrics.action_values || []).find(a => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value || 0;
    const roas = spend > 0 ? (Number(convValue) / spend) : 0;
    const cpa = conv > 0 ? spend / conv : 0;
    const budget = camp.daily_budget ? `R$ ${(camp.daily_budget / 100).toFixed(0)}/dia` : camp.lifetime_budget ? `R$ ${(camp.lifetime_budget / 100).toFixed(0)} total` : "—";

    const statusMap = { ACTIVE: "Ativa", PAUSED: "Pausada", DELETED: "Removida", ARCHIVED: "Arquivada" };

    results.push({
      external_id: `meta_${camp.id}`,
      name: camp.name,
      channel: "Meta",
      status: statusMap[camp.status] || camp.status,
      budget,
      spend: `R$ ${spend.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`,
      conv,
      cpa: `R$ ${cpa.toFixed(2)}`,
      roas: `${roas.toFixed(1)}x`,
      ctr: `${(parseFloat(metrics.ctr || 0)).toFixed(1)}%`,
      impressions: parseInt(metrics.impressions || 0),
      clicks: parseInt(metrics.clicks || 0),
      cost_value: spend,
      conv_value: Number(convValue),
      objective: camp.objective || "",
    });
  }
  return results;
}

async function fetchAudiences(userId) {
  const token = getToken(userId);
  if (!token) return [];
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) return [];

  const res = await fetch(
    `${API}/act_${adAccountId}/customaudiences?fields=id,name,subtype,approximate_count,delivery_status&limit=50&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) return [];
  const data = await res.json();

  return (data.data || []).map(a => ({
    external_id: `meta_aud_${a.id}`,
    name: a.name,
    type: a.subtype || "Custom",
    size: (a.approximate_count || 0).toLocaleString("pt-BR"),
    status: a.delivery_status?.code === 200 ? "Ativo" : "Inativo",
    channel: "Meta",
  }));
}

module.exports = { fetchCampaigns, fetchAudiences };
