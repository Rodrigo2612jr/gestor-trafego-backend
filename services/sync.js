// Data sync orchestrator — pulls real data from connected platforms
const { findAll, findOne, insert, update, remove } = require("../db/database");
const googleAds = require("./google-ads");
const metaAds = require("./meta-ads");

async function syncAll(userId) {
  const results = { google: null, meta: null, errors: [] };

  const googleConn = findOne("connections", c => c.user_id === userId && c.platform === "google" && c.connected === true);
  const metaConn = findOne("connections", c => c.user_id === userId && c.platform === "meta" && c.connected === true);

  if (googleConn) {
    try {
      const campaigns = await googleAds.fetchCampaigns(userId);
      if (campaigns.length > 0) {
        mergeCampaigns(userId, campaigns, "Google");
        const keywords = await googleAds.fetchKeywords(userId);
        if (keywords.length > 0) mergeKeywords(userId, keywords);
        update("connections", c => c.id === googleConn.id, () => ({ last_sync: new Date().toISOString() }));
        results.google = { campaigns: campaigns.length, keywords: keywords.length };
      }
    } catch (err) {
      console.error("Google sync error:", err.message);
      results.errors.push(`Google: ${err.message}`);
    }
  }

  if (metaConn) {
    try {
      const campaigns = await metaAds.fetchCampaigns(userId);
      if (campaigns.length > 0) {
        mergeCampaigns(userId, campaigns, "Meta");
        const audiences = await metaAds.fetchAudiences(userId);
        if (audiences.length > 0) mergeAudiences(userId, audiences);
        update("connections", c => c.id === metaConn.id, () => ({ last_sync: new Date().toISOString() }));
        results.meta = { campaigns: campaigns.length, audiences: audiences.length };
      }
    } catch (err) {
      console.error("Meta sync error:", err.message);
      results.errors.push(`Meta: ${err.message}`);
    }
  }

  insert("sync_logs", { user_id: userId, results, synced_at: new Date().toISOString() });
  return results;
}

function mergeCampaigns(userId, incoming, channel) {
  for (const camp of incoming) {
    const existing = findOne("campaigns", c => c.user_id === userId && c.external_id === camp.external_id);
    if (existing) {
      update("campaigns", c => c.id === existing.id, () => ({
        name: camp.name, status: camp.status, budget: camp.budget, spend: camp.spend,
        conv: camp.conv, cpa: camp.cpa, roas: camp.roas, ctr: camp.ctr,
        impressions: camp.impressions, clicks: camp.clicks,
        cost_value: camp.cost_value, conv_value: camp.conv_value,
      }));
    } else {
      insert("campaigns", { user_id: userId, ...camp, objective: camp.objective || "" });
    }
  }
}

function mergeKeywords(userId, incoming) {
  for (const kw of incoming) {
    const existing = findOne("keywords", k => k.user_id === userId && k.keyword === kw.keyword);
    if (existing) {
      update("keywords", k => k.id === existing.id, () => ({
        cpc: kw.cpc, volume: kw.volume, quality: kw.quality, conv: kw.conv,
      }));
    } else {
      insert("keywords", { user_id: userId, campaign_id: null, ...kw });
    }
  }
}

function mergeAudiences(userId, incoming) {
  for (const aud of incoming) {
    const existing = findOne("audiences", a => a.user_id === userId && a.external_id === aud.external_id);
    if (existing) {
      update("audiences", a => a.id === existing.id, () => ({
        name: aud.name, size: aud.size, status: aud.status,
      }));
    } else {
      insert("audiences", { user_id: userId, ...aud, perf: "—" });
    }
  }
}

module.exports = { syncAll };
