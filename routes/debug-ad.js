const express = require("express");
const { getToken } = require("../services/meta-auth");
const { findOne } = require("../db/database");

const router = express.Router();
const API = "https://graph.facebook.com/v21.0";

function getAdAccountId(userId) {
  const tok = findOne("oauth_tokens", t => t.user_id === userId && t.platform === "meta");
  return tok?.ad_account_id || process.env.META_AD_ACCOUNT_ID || null;
}

async function getPageId(token) {
  if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID.trim();
  try {
    const res = await fetch(`${API}/me/accounts?fields=id,name&limit=5&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.data?.[0]?.id) return data.data[0].id;
  } catch { }
  return null;
}

// GET /api/debug-ad?meta_adset_id=XXX&creative_id=9&url=https://emporiopascoto.com.br
// Testa criação de 1 anúncio mínimo e retorna cada passo com resposta completa da Meta
router.get("/", async (req, res) => {
  const { meta_adset_id, creative_id, url } = req.query;
  if (!meta_adset_id) return res.status(400).json({ error: "Passe ?meta_adset_id=..." });

  const token = getToken(req.userId);
  if (!token) return res.status(401).json({ error: "Meta não conectado" });

  const adAccountId = getAdAccountId(req.userId);
  const steps = {};

  // 1. Page ID
  const pageId = await getPageId(token);
  steps.pageId = pageId;

  // 2. Upload imagem (se creative_id passado)
  let imageHash = null;
  if (creative_id) {
    const creative = findOne("creatives", c => c.id === Number(creative_id));
    steps.creative = creative ? { id: creative.id, name: creative.name, has_url: !!creative.image_url, has_b64: !!creative.image_b64 } : null;

    if (creative) {
      let imageSource = null;
      if (creative.image_url?.startsWith("https://")) imageSource = creative.image_url;
      else if (creative.image_url?.startsWith("data:")) imageSource = creative.image_url;
      else if (creative.image_b64) imageSource = `data:image/png;base64,${creative.image_b64}`;

      if (imageSource) {
        const uploadUrl = `${API}/act_${adAccountId}/adimages?access_token=${encodeURIComponent(token)}`;
        let uploadRes;
        if (imageSource.startsWith("https://")) {
          const params = new URLSearchParams({ url: imageSource });
          uploadRes = await fetch(uploadUrl, { method: "POST", body: params });
        } else {
          const base64 = imageSource.replace(/^data:[^;]+;base64,/, "");
          const mimeMatch = imageSource.match(/^data:([^;]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
          const formData = new FormData();
          formData.append("filename", new Blob([Buffer.from(base64, "base64")], { type: mimeType }), "ad_image.jpg");
          uploadRes = await fetch(uploadUrl, { method: "POST", body: formData });
        }
        const uploadData = await uploadRes.json();
        steps.imageUpload = uploadData;
        imageHash = Object.values(uploadData.images || {})[0]?.hash || null;
        steps.imageHash = imageHash;
      }
    }
  }

  // 3. Tentar criar criativo mínimo
  const destUrl = url || "https://emporiopascoto.com.br";
  const linkData = {
    link: destUrl,
    message: "Teste de anúncio",
    name: "Teste headline",
    call_to_action: { type: "LEARN_MORE", value: { link: destUrl } },
  };
  if (imageHash) linkData.image_hash = imageHash;

  const creativePayload = {
    name: "DEBUG_TEST_creative",
    object_story_spec: { page_id: pageId, link_data: linkData },
  };
  steps.creativePayload = creativePayload;

  const creativeRes = await fetch(
    `${API}/act_${adAccountId}/adcreatives?access_token=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creativePayload) }
  );
  const creativeData = await creativeRes.json();
  steps.creativeResponse = creativeData;

  // 4. Se criativo criado, criar anúncio e depois deletar tudo
  if (creativeData.id) {
    const adRes = await fetch(
      `${API}/act_${adAccountId}/ads?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "DEBUG_TEST_ad", adset_id: meta_adset_id, creative: { creative_id: creativeData.id }, status: "PAUSED" }) }
    );
    const adData = await adRes.json();
    steps.adResponse = adData;

    // Deletar ad e criativo de teste
    if (adData.id) {
      await fetch(`${API}/${adData.id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    }
    await fetch(`${API}/${creativeData.id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    steps.cleanup = "deletado";
    steps.success = !!adData.id;
  } else {
    steps.success = false;
  }

  res.json(steps);
});

module.exports = router;
