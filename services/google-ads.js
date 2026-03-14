// Google Ads API service — fetches real campaign data
const { getValidToken } = require("./google-auth");

const API_VERSION = "v18";
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

async function fetchCampaigns(userId) {
  const token = await getValidToken(userId, "google");
  if (!token) return [];
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) return [];

  const query = `
    SELECT
      campaign.id, campaign.name, campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.cost_micros, metrics.conversions, metrics.cost_per_conversion,
      metrics.clicks, metrics.impressions, metrics.ctr,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    console.error("Google Ads API error:", await res.text());
    return [];
  }

  const data = await res.json();
  const results = [];
  for (const batch of data) {
    for (const row of batch.results || []) {
      const c = row.campaign || {};
      const m = row.metrics || {};
      const b = row.campaignBudget || {};
      const costBrl = (m.costMicros || 0) / 1e6;
      const conv = Math.round(m.conversions || 0);
      const convValue = m.conversionsValue || 0;
      const roas = costBrl > 0 ? (convValue / costBrl) : 0;
      const cpa = conv > 0 ? costBrl / conv : 0;
      const budgetBrl = (b.amountMicros || 0) / 1e6;

      const statusMap = { ENABLED: "Ativa", PAUSED: "Pausada", REMOVED: "Removida" };
      results.push({
        external_id: `google_${c.id}`,
        name: c.name || "Sem nome",
        channel: "Google",
        status: statusMap[c.status] || c.status,
        budget: `R$ ${budgetBrl.toFixed(0)}/dia`,
        spend: `R$ ${costBrl.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`,
        conv,
        cpa: `R$ ${cpa.toFixed(2)}`,
        roas: `${roas.toFixed(1)}x`,
        ctr: `${((m.ctr || 0) * 100).toFixed(1)}%`,
        impressions: m.impressions || 0,
        clicks: m.clicks || 0,
        cost_value: costBrl,
        conv_value: convValue,
      });
    }
  }
  return results;
}

async function fetchKeywords(userId) {
  const token = await getValidToken(userId, "google");
  if (!token) return [];
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) return [];

  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      metrics.average_cpc, metrics.search_impression_share,
      metrics.conversions, metrics.clicks, metrics.impressions
    FROM keyword_view
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY metrics.conversions DESC
    LIMIT 50
  `;

  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  const results = [];
  for (const batch of data) {
    for (const row of batch.results || []) {
      const kw = row.adGroupCriterion?.keyword || {};
      const m = row.metrics || {};
      const q = row.adGroupCriterion?.qualityInfo || {};
      results.push({
        keyword: kw.text,
        intent: kw.matchType === "EXACT" ? "Compra" : kw.matchType === "PHRASE" ? "Pesquisa" : "Navegação",
        cpc: `R$ ${((m.averageCpc || 0) / 1e6).toFixed(2)}`,
        volume: (m.impressions || 0).toLocaleString("pt-BR"),
        quality: q.qualityScore || 0,
        conv: Math.round(m.conversions || 0),
      });
    }
  }
  return results;
}

module.exports = { fetchCampaigns, fetchKeywords };
