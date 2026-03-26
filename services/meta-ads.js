// Meta Marketing API service — fetches real campaign data
const { getToken } = require("./meta-auth");
const { findOne } = require("../db/database");

const API = "https://graph.facebook.com/v21.0";

function getAdAccountId(userId) {
  const tok = findOne("oauth_tokens", t => t.user_id === userId && t.platform === "meta");
  return tok?.ad_account_id || process.env.META_AD_ACCOUNT_ID || null;
}

// Busca o Page ID e Instagram Actor ID da conta do usuário na Meta
async function getPageId(token) {
  if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID.trim();
  try {
    const res = await fetch(`${API}/me/accounts?fields=id,name&limit=5&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.data?.[0]?.id) {
      console.log("[Meta Ad] Usando page_id auto-detectado:", data.data[0].id, data.data[0].name);
      return data.data[0].id;
    }
  } catch (e) {
    console.error("[Meta Ad] Erro ao buscar page_id:", e.message);
  }
  return null;
}

// Busca o Instagram Business Account ID vinculado à página
async function getInstagramActorId(token, pageId) {
  if (process.env.META_INSTAGRAM_ACTOR_ID) return process.env.META_INSTAGRAM_ACTOR_ID.trim();
  if (!pageId) return null;
  try {
    const res = await fetch(`${API}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.instagram_business_account?.id) {
      console.log("[Meta Ad] Instagram actor ID auto-detectado:", data.instagram_business_account.id);
      return data.instagram_business_account.id;
    }
  } catch (e) {
    console.error("[Meta Ad] Erro ao buscar instagram_actor_id:", e.message);
  }
  return null;
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

// ─── Map objective string to Meta API objective ───
function mapObjective(objective = "") {
  const o = objective.toLowerCase();
  if (o.includes("lead") || o.includes("capturaç")) return "OUTCOME_LEADS";
  if (o.includes("venda") || o.includes("convers")) return "OUTCOME_SALES";
  if (o.includes("tráfego") || o.includes("trafego") || o.includes("traffic")) return "OUTCOME_TRAFFIC";
  if (o.includes("reconhec") || o.includes("awareness") || o.includes("alcance")) return "OUTCOME_AWARENESS";
  if (o.includes("engaj") || o.includes("engag")) return "OUTCOME_ENGAGEMENT";
  if (o.includes("formulário") || o.includes("form")) return "OUTCOME_LEADS";
  if (o.includes("app")) return "OUTCOME_APP_PROMOTION";
  return "OUTCOME_TRAFFIC"; // default seguro
}

// ─── Map optimization goal to Meta billing event ───
const GOAL_MAP = {
  CONVERSIONS:      { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
  TRAFFIC:          { optimization_goal: "LINK_CLICKS",         billing_event: "LINK_CLICKS" },
  REACH:            { optimization_goal: "REACH",               billing_event: "IMPRESSIONS" },
  LEAD_GENERATION:  { optimization_goal: "LEAD_GENERATION",     billing_event: "IMPRESSIONS" },
  ENGAGEMENT:       { optimization_goal: "POST_ENGAGEMENT",     billing_event: "IMPRESSIONS" },
};

// ─── Busca IDs reais de interesses na Meta API ───
async function resolveInterestIds(token, interestNames) {
  const resolved = [];
  for (const name of interestNames) {
    try {
      const res = await fetch(
        `${API}/search?type=adinterest&q=${encodeURIComponent(name)}&limit=1&access_token=${encodeURIComponent(token)}`
      );
      const data = await res.json();
      if (data.data?.[0]?.id) {
        resolved.push({ id: data.data[0].id, name: data.data[0].name });
      }
    } catch { /* pula interesse que não resolver */ }
  }
  return resolved;
}

// Mapa de nomes de países → código ISO (evita buscar "Brasil" e achar "Assis Brasil, Acre")
const COUNTRY_NAME_TO_CODE = {
  "brasil": "BR", "brazil": "BR",
  "argentina": "AR", "mexico": "MX", "méxico": "MX",
  "portugal": "PT", "colombia": "CO", "colômbia": "CO",
  "chile": "CL", "peru": "PE", "uruguai": "UY", "paraguai": "PY",
  "estados unidos": "US", "usa": "US", "eua": "US",
};

// ─── Resolve nomes de cidades/estados para chaves geo da Meta ───
async function resolveGeoLocations(token, locationNames) {
  const cities = [];
  const regions = [];
  const countries = [];
  for (const name of locationNames) {
    const lower = name.toLowerCase().trim();
    if (COUNTRY_NAME_TO_CODE[lower]) {
      countries.push(COUNTRY_NAME_TO_CODE[lower]);
      continue;
    }
    try {
      const res = await fetch(
        `${API}/search?type=adgeolocation&q=${encodeURIComponent(name)}&location_types=%5B%22city%22%2C%22region%22%5D&limit=3&access_token=${encodeURIComponent(token)}`
      );
      const data = await res.json();
      if (data.data?.[0]) {
        const loc = data.data[0];
        if (loc.type === "city") cities.push({ key: loc.key });
        else if (loc.type === "region") regions.push({ key: loc.key });
      }
    } catch { /* pula localização que não resolver */ }
  }
  return { cities, regions, countries };
}

// ─── Faz upload de imagem para Meta e retorna hash/url ───
// imageSource: "https://..." URL ou "data:image/...;base64,..." string
async function uploadImageToMeta(token, adAccountId, imageSource) {
  const apiUrl = `${API}/act_${adAccountId}/adimages?access_token=${encodeURIComponent(token)}`;

  let res;
  if (imageSource.startsWith("https://")) {
    // Opção 1: upload por URL — Meta baixa a imagem diretamente (mais simples e confiável)
    const params = new URLSearchParams({ url: imageSource });
    res = await fetch(apiUrl, { method: "POST", body: params });
  } else {
    // Opção 2: upload binário — converte base64 para buffer e envia como arquivo
    const base64 = imageSource.replace(/^data:[^;]+;base64,/, "");
    const mimeMatch = imageSource.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const imageBuffer = Buffer.from(base64, "base64");
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: mimeType });
    formData.append("filename", blob, "ad_image.jpg"); // campo "filename" conforme docs Meta
    res = await fetch(apiUrl, { method: "POST", body: formData });
  }

  const data = await res.json();
  if (data.error) throw new Error(`Upload imagem (code ${data.error.code}): ${data.error.message}`);
  const images = data.images || {};
  const result = Object.values(images)[0] || null;
  if (!result?.hash) throw new Error("Meta não retornou hash após upload — resposta: " + JSON.stringify(data));
  console.log("[Meta Ad] Upload imagem ok, hash:", result.hash, "| size:", result.width, "x", result.height);
  return result; // { hash, url, width, height }
}

// ─── Create Ad Set in Meta ───
async function createAdSet(userId, { meta_campaign_id, name, daily_budget, optimization_goal, age_min, age_max, genders, interests, locations, status, placement }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) throw new Error("ID da conta de anúncio Meta não encontrado");

  // Busca campanha na Meta para pegar objetivo real e verificar CBO
  let campaignHasBudget = false;
  let campaignObjective = null;
  try {
    const campRes = await fetch(
      `${API}/${meta_campaign_id}?fields=daily_budget,lifetime_budget,objective&access_token=${encodeURIComponent(token)}`
    );
    const campData = await campRes.json();
    campaignHasBudget = !!(campData.daily_budget || campData.lifetime_budget);
    campaignObjective = campData.objective || null;
    console.log("[Meta AdSet] Campanha objetivo:", campaignObjective, "| CBO:", campaignHasBudget);
  } catch { /* assume sem CBO */ }

  // Mapeia objetivo real da campanha → optimization_goal correto
  const OBJECTIVE_TO_GOAL = {
    OUTCOME_LEADS:      { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
    OUTCOME_SALES:      { optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS" },
    OUTCOME_TRAFFIC:    { optimization_goal: "LINK_CLICKS",         billing_event: "LINK_CLICKS" },
    OUTCOME_AWARENESS:  { optimization_goal: "REACH",               billing_event: "IMPRESSIONS" },
    OUTCOME_ENGAGEMENT: { optimization_goal: "POST_ENGAGEMENT",     billing_event: "IMPRESSIONS" },
    OUTCOME_APP_PROMOTION: { optimization_goal: "APP_INSTALLS",     billing_event: "IMPRESSIONS" },
  };

  const goal = (campaignObjective && OBJECTIVE_TO_GOAL[campaignObjective])
    ? OBJECTIVE_TO_GOAL[campaignObjective]
    : (GOAL_MAP[optimization_goal] || GOAL_MAP.CONVERSIONS);
  const genderArr = genders === "male" ? [1] : genders === "female" ? [2] : [1, 2];

  // Resolve localizações geográficas
  let geoLocations = { countries: ["BR"] };
  if (locations && locations.length > 0) {
    const { cities, regions, countries } = await resolveGeoLocations(token, locations);
    if (cities.length > 0 || regions.length > 0 || countries.length > 0) {
      geoLocations = {};
      if (countries.length > 0) geoLocations.countries = countries;
      if (cities.length > 0) geoLocations.cities = cities;
      if (regions.length > 0) geoLocations.regions = regions;
    }
  }

  // Posicionamentos por placement
  const PLACEMENTS = {
    feed:         { fb: ["feed"],              ig: ["stream"] },
    stories:      { fb: ["story"],             ig: ["story"] },
    feed_stories: { fb: ["feed", "story"],     ig: ["stream", "story"] },
    reels:        { fb: ["reels"],             ig: ["reels"] },
    all:          { fb: ["feed", "story", "reels"], ig: ["stream", "story", "reels"] },
  };
  const pos = PLACEMENTS[placement] || PLACEMENTS.feed_stories; // padrão: feed + stories

  const targeting = {
    age_min: age_min || 18,
    age_max: age_max || 65,
    genders: genderArr,
    geo_locations: geoLocations,
    targeting_automation: { advantage_audience: 0 }, // obrigatório nessa conta Meta
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: pos.fb,
    instagram_positions: pos.ig,
  };

  // Resolve interest names → IDs reais da Meta
  if (interests && interests.length > 0) {
    const resolvedInterests = await resolveInterestIds(token, interests);
    if (resolvedInterests.length > 0) {
      targeting.flexible_spec = [{ interests: resolvedInterests }];
    }
  }

  const body = {
    name,
    campaign_id: meta_campaign_id,
    optimization_goal: goal.optimization_goal,
    billing_event: goal.billing_event,
    targeting,
    status: status === "Ativa" ? "ACTIVE" : "PAUSED",
  };

  // promoted_object e destination_type por objetivo
  const pixelId = process.env.META_PIXEL_ID?.trim() || null;
  if (campaignObjective === "OUTCOME_LEADS") {
    body.destination_type = "WEBSITE"; // obrigatório também no adset
    if (pixelId) {
      body.promoted_object = { pixel_id: pixelId, custom_event_type: "LEAD" };
    } else {
      const pageId = await getPageId(token);
      if (pageId) body.promoted_object = { page_id: pageId };
    }
  } else if (campaignObjective === "OUTCOME_SALES") {
    body.destination_type = "WEBSITE";
    if (pixelId) {
      body.promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };
    }
  }

  // Só manda daily_budget no adset se a campanha NÃO tiver CBO
  if (!campaignHasBudget) {
    body.daily_budget = Math.round((daily_budget || 50) * 100);
  }

  console.log("[Meta AdSet] Payload:", JSON.stringify(body, null, 2));

  async function postAdSet(payload) {
    const r = await fetch(
      `${API}/act_${adAccountId}/adsets?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    return r.json();
  }

  let data = await postAdSet(body);
  let pixelError = null;

  // Se falhou e temos pixel no promoted_object
  if (data.error && body.promoted_object?.pixel_id) {
    pixelError = `code ${data.error.code}/${data.error.error_subcode || "?"}: ${data.error.error_user_msg || data.error.message}`;
    console.warn("[Meta AdSet] Pixel falhou:", pixelError);

    // Para OUTCOME_LEADS, Meta exige pixel_id no promoted_object — lança erro direto
    if (campaignObjective === "OUTCOME_LEADS") {
      const e = data.error;
      throw new Error(`Meta AdSet pixel rejeitado (code ${e.code}/${e.error_subcode || "?"}): ${e.error_user_msg || e.message} | pixel_id enviado: ${body.promoted_object.pixel_id}`);
    }

    // Para outros objetivos → fallback com page_id
    console.warn("[Meta AdSet] Tentando com page_id");
    delete body.promoted_object;
    const pageIdFallback = await getPageId(token);
    if (pageIdFallback) body.promoted_object = { page_id: pageIdFallback };
    data = await postAdSet(body);
  }

  // Se ainda falhou com page_id → tenta sem promoted_object SOMENTE se não for OUTCOME_LEADS
  // OUTCOME_LEADS EXIGE promoted_object; removê-lo causa erro 1815430
  if (data.error && body.promoted_object && campaignObjective !== "OUTCOME_LEADS") {
    console.warn("[Meta AdSet] promoted_object rejeitado — tentando sem ele");
    delete body.promoted_object;
    data = await postAdSet(body);
  }

  // Se optimization_goal incompatível → tenta LINK_CLICKS (somente para não-LEADS)
  if (data.error && campaignObjective !== "OUTCOME_LEADS" && (JSON.stringify(data.error).includes("2490408") || JSON.stringify(data.error).includes("1885760") || data.error.message?.includes("meta de desempenho") || data.error.message?.includes("performance goal"))) {
    console.warn("[Meta AdSet] Optimization goal incompat. — retentando com LINK_CLICKS");
    body.optimization_goal = "LINK_CLICKS";
    body.billing_event = "LINK_CLICKS";
    delete body.promoted_object;
    delete body.destination_type;
    data = await postAdSet(body);
  }

  if (data.error) {
    const e = data.error;
    console.error("[Meta AdSet] Erro completo:", JSON.stringify(e, null, 2));
    const blame = e.blame_field_specs?.map(b => b.join(".")).join(", ") || "";
    const userMsg = e.error_user_msg || e.error_user_title || "";
    throw new Error(`Meta AdSet erro (code ${e.code}/${e.error_subcode}${blame ? ` campo: ${blame}` : ""}): ${userMsg || e.message}`);
  }

  return { ...data, pixel_warning: pixelError };
}

// ─── Create Ad in Meta ───
async function createAd(userId, { meta_adset_id, name, headline, primary_text, cta, destination_url, creative_id }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) throw new Error("ID da conta de anúncio Meta não encontrado");

  // Busca page_id real da conta do usuário
  const pageId = await getPageId(token);
  if (!pageId) throw new Error("Nenhuma página Facebook encontrada na conta. Configure META_PAGE_ID.");

  // Busca imagem do criativo e faz upload para Meta (sempre via hash)
  let imageHash = null;
  if (creative_id) {
    const creative = findOne("creatives", c => c.id === Number(creative_id));
    if (creative) {
      let imageSource = null;

      if (creative.image_url?.startsWith("https://")) {
        imageSource = creative.image_url; // Meta baixa direto da URL (mais confiável)
      } else if (creative.image_url?.startsWith("data:")) {
        imageSource = creative.image_url;
      } else if (creative.image_b64) {
        imageSource = `data:image/png;base64,${creative.image_b64}`;
      }

      if (imageSource) {
        const uploaded = await uploadImageToMeta(token, adAccountId, imageSource);
        imageHash = uploaded.hash;
      }
    }
  }

  const ctaType = cta || "LEARN_MORE";
  const link = destination_url;
  if (!link) throw new Error("destination_url é obrigatório para criar anúncio no Meta");

  const linkData = {
    link,
    message: primary_text || "",
    name: headline || name,
    call_to_action: { type: ctaType, value: { link } },
  };
  if (!imageHash) throw new Error("Nenhuma imagem disponível para o criativo. Forneça um creative_id com imagem válida.");
  linkData.image_hash = imageHash;

  const instagramActorId = await getInstagramActorId(token, pageId);

  const objectStorySpec = {
    page_id: pageId,
    link_data: linkData,
  };
  // instagram_user_id removido — placements do adset já garantem entrega no Instagram

  // 1. Criar criativo no Meta
  const creativePayload = { name: `Creative: ${name}`, object_story_spec: objectStorySpec };
  console.log("[Meta Ad] page_id:", pageId, "| instagram_actor_id:", instagramActorId || "não encontrado", "| image_hash:", imageHash);
  const creativeRes = await fetch(
    `${API}/act_${adAccountId}/adcreatives?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creativePayload) }
  );
  const creativeData = await creativeRes.json();
  if (creativeData.error) {
    const e = creativeData.error;
    const blame = e.blame_field_specs?.map(b => b.join(".")).join(", ") || "";
    const userMsg = e.error_user_msg || e.error_user_title || "";
    const details = [
      `code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}`,
      blame ? `campo: ${blame}` : "",
      userMsg ? `detalhe: ${userMsg}` : "",
    ].filter(Boolean).join(" | ");
    console.error("[Meta Ad] Erro criativo completo:", JSON.stringify(e, null, 2));
    console.error("[Meta Ad] Payload enviado:", JSON.stringify(creativePayload, null, 2));
    throw new Error(`Meta criativo erro (${details}): ${e.message}`);
  }

  // 2. Criar anúncio usando o criativo
  const adRes = await fetch(
    `${API}/act_${adAccountId}/ads?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, adset_id: meta_adset_id, creative: { creative_id: creativeData.id }, status: "PAUSED" }) }
  );
  const adData = await adRes.json();
  if (adData.error) {
    const ae = adData.error;
    const blame = ae.blame_field_specs?.map(b => b.join(".")).join(", ") || "";
    const userMsg = ae.error_user_msg || ae.error_user_title || "";
    const details = [
      `code ${ae.code}${ae.error_subcode ? `/${ae.error_subcode}` : ""}`,
      blame ? `campo: ${blame}` : "",
      userMsg ? `detalhe: ${userMsg}` : "",
    ].filter(Boolean).join(" | ");
    console.error("[Meta Ad] Erro anúncio completo:", JSON.stringify(ae, null, 2));
    console.error("[Meta Ad] adset_id usado:", meta_adset_id, "| creative_id usado:", creativeData.id);
    throw new Error(`Meta anúncio erro (${details}): ${ae.message}`);
  }

  return { id: adData.id, meta_creative_id: creativeData.id };
}

// ─── Update Ad creative (CTA, headline, text, URL) ───
async function updateAd(userId, { meta_ad_id, cta, headline, primary_text, destination_url }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) throw new Error("ID da conta de anúncio Meta não encontrado");

  // Busca o criativo atual do anúncio
  const adRes = await fetch(`${API}/${meta_ad_id}?fields=creative&access_token=${encodeURIComponent(token)}`);
  const adData = await adRes.json();
  if (adData.error) throw new Error(`Erro ao buscar anúncio: ${adData.error.message}`);

  const currentCreativeId = adData.creative?.id;
  if (!currentCreativeId) throw new Error("Criativo do anúncio não encontrado");

  // Busca detalhes do criativo atual
  const creativeRes = await fetch(`${API}/${currentCreativeId}?fields=object_story_spec&access_token=${encodeURIComponent(token)}`);
  const creativeData = await creativeRes.json();
  if (creativeData.error) throw new Error(`Erro ao buscar criativo: ${creativeData.error.message}`);

  const spec = creativeData.object_story_spec || {};
  const linkData = { ...(spec.link_data || {}) };

  if (cta) linkData.call_to_action = { type: cta, value: { link: destination_url || linkData.link } };
  if (headline) linkData.name = headline;
  if (primary_text) linkData.message = primary_text;
  if (destination_url) { linkData.link = destination_url; if (linkData.call_to_action?.value) linkData.call_to_action.value.link = destination_url; }

  const newCreativeRes = await fetch(
    `${API}/act_${adAccountId}/adcreatives?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Updated Creative`, object_story_spec: { ...spec, link_data: linkData } }) }
  );
  const newCreative = await newCreativeRes.json();
  if (newCreative.error) throw new Error(`Erro ao criar criativo atualizado: ${newCreative.error.message}`);

  // Atualiza o anúncio com o novo criativo
  const updateRes = await fetch(
    `${API}/${meta_ad_id}?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creative: { creative_id: newCreative.id } }) }
  );
  const updateData = await updateRes.json();
  if (updateData.error) throw new Error(`Erro ao atualizar anúncio: ${updateData.error.message}`);

  return { success: true, meta_ad_id, new_creative_id: newCreative.id };
}

// ─── Create campaign in Meta Ads Manager ───
async function createCampaign(userId, { name, objective, status, budget }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) throw new Error("ID da conta de anúncio Meta não encontrado");

  const metaStatus = status === "Ativa" ? "ACTIVE" : "PAUSED";
  const metaObjective = mapObjective(objective);

  // Parse budget string like "R$ 100/dia" → 10000 (cents)
  let dailyBudgetCents = null;
  if (budget) {
    const match = budget.replace(/\./g, "").match(/[\d,]+/);
    if (match) {
      const value = parseFloat(match[0].replace(",", "."));
      if (!isNaN(value)) dailyBudgetCents = Math.round(value * 100);
    }
  }

  const body = {
    name,
    objective: metaObjective,
    status: metaStatus,
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: !dailyBudgetCents, // true = ABO, false = CBO
    bid_strategy: "LOWEST_COST_WITHOUT_CAP", // obrigatório em ambos ABO e CBO
  };
  // OUTCOME_LEADS para landing page precisa de destination_type no nível da campanha
  if (metaObjective === "OUTCOME_LEADS") {
    body.destination_type = "WEBSITE";
  }
  if (dailyBudgetCents) {
    body.daily_budget = dailyBudgetCents;
  }

  const res = await fetch(
    `${API}/act_${adAccountId}/campaigns?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();
  if (data.error) {
    const e = data.error;
    console.error("[Meta Campaign] Erro completo:", JSON.stringify(e, null, 2));
    console.error("[Meta Campaign] Payload enviado:", JSON.stringify(body, null, 2));
    const blame = e.blame_field_specs?.map(b => b.join(".")).join(", ") || "";
    const userMsg = e.error_user_msg || e.error_user_title || "";
    throw new Error(`Meta campanha erro (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}${blame ? ` campo: ${blame}` : ""}${userMsg ? ` | ${userMsg}` : ""}): ${e.message}`);
  }
  return data; // { id: "campaign_id" }
}

// ─── Pause/activate campaign in Meta ───
async function updateCampaignStatus(userId, metaCampaignId, status) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");

  const metaStatus = status === "Ativa" ? "ACTIVE" : "PAUSED";
  const res = await fetch(
    `${API}/${metaCampaignId}?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: metaStatus }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ─── Update AdSet in Meta (ex: adicionar promoted_object/pixel) ───
async function updateAdSet(userId, { meta_adset_id, pixel_id, custom_event_type, destination_type }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");

  const body = {};
  if (pixel_id) {
    body.promoted_object = { pixel_id, custom_event_type: custom_event_type || "LEAD" };
  }
  if (destination_type) body.destination_type = destination_type;

  console.log("[Meta AdSet Update] Payload:", JSON.stringify(body, null, 2));

  async function patchAdSet(payload) {
    const r = await fetch(
      `${API}/${meta_adset_id}?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    return r.json();
  }

  let data = await patchAdSet(body);

  // Se pixel falhou, tenta com page_id
  if (data.error && data.error.message?.includes("promoted_object[pixel_id]")) {
    console.warn("[Meta AdSet Update] Pixel inválido — tentando com page_id");
    delete body.promoted_object;
    const pageIdFallback = await getPageId(token);
    if (pageIdFallback) body.promoted_object = { page_id: pageIdFallback };
    data = await patchAdSet(body);
  }

  if (data.error) throw new Error(`Meta erro ao atualizar adset: ${data.error.message}`);
  return { success: true, meta_adset_id };
}

// ─── List Pixels from Meta ad account ───
async function listPixelsFromMeta(userId) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");
  const adAccountId = getAdAccountId(userId);
  if (!adAccountId) throw new Error("ID da conta de anúncio Meta não encontrado");

  const res = await fetch(
    `${API}/act_${adAccountId}/adspixels?fields=id,name,creation_time&access_token=${encodeURIComponent(token)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(`Meta erro ao buscar pixels: ${data.error.message}`);
  return (data.data || []).map(p => ({ pixel_id: p.id, name: p.name || "sem nome" }));
}

// ─── List AdSets from Meta API for a campaign ───
async function listAdSetsFromMeta(userId, { meta_campaign_id }) {
  const token = getToken(userId);
  if (!token) throw new Error("Meta não está conectado");

  // Se for ID interno curto (ex: "86"), busca o MetaID no banco
  let realMetaId = meta_campaign_id;
  if (meta_campaign_id && String(meta_campaign_id).length < 10) {
    const db = require("../db/database");
    const camp = db.findOne("campaigns", c => c.id === parseInt(meta_campaign_id));
    if (camp?.external_id?.startsWith("meta_")) realMetaId = camp.external_id.replace("meta_", "");
    else throw new Error(`MetaCampaignID não encontrado para campanha interna ${meta_campaign_id} — verifique se ela foi publicada no Meta`);
  }

  const res = await fetch(`${API}/${realMetaId}/adsets?fields=id,name,status,daily_budget,optimization_goal,billing_event,destination_type,promoted_object,targeting&access_token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (data.error) throw new Error(`Meta erro: ${data.error.message}`);
  return (data.data || []).map(a => ({
    meta_adset_id: a.id,
    name: a.name,
    status: a.status,
    daily_budget: a.daily_budget,
    optimization_goal: a.optimization_goal,
    billing_event: a.billing_event,
    destination_type: a.destination_type,
    promoted_object: a.promoted_object,
  }));
}

module.exports = { fetchCampaigns, fetchAudiences, createCampaign, updateCampaignStatus, createAdSet, updateAdSet, createAd, updateAd, listAdSetsFromMeta, listPixelsFromMeta };
