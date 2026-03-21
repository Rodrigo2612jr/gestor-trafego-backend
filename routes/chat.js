const express = require("express");
const { findAll, insert, remove, findOne, update } = require("../db/database");
const { chatCompletion, generateImage, generateAdCopy } = require("../services/openai");
const { createCampaign: metaCreateCampaign, updateCampaignStatus: metaUpdateStatus, createAdSet: metaCreateAdSet, createAd: metaCreateAd } = require("../services/meta-ads");

const router = express.Router();

router.get("/", (req, res) => {
  const messages = findAll("chat_messages", r => r.user_id === req.userId);
  messages.sort((a, b) => (a.id - b.id));
  res.json(messages.slice(-100).map(m => {
    let text;
    if (typeof m.text === "string") text = m.text;
    else if (typeof m.text?.choices?.[0]?.message?.content === "string") text = m.text.choices[0].message.content;
    else text = JSON.stringify(m.text) || "";
    return { id: m.id, role: m.role, text, images: m.images, created_at: m.created_at };
  }));
});

// ─── Execute tool calls from Leo ───
async function executeToolCall(toolCall, userId) {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  switch (name) {
    case "create_campaign": {
      let metaCampaignId = null;
      let metaError = null;

      // Try to create in Meta Ads Manager if it's a Meta campaign
      if ((args.channel || "").toLowerCase() === "meta") {
        try {
          const metaResult = await metaCreateCampaign(userId, {
            name: args.name,
            objective: args.objective,
            status: args.status || "Pausada",
            budget: args.budget,
          });
          metaCampaignId = metaResult.id;
        } catch (err) {
          metaError = err.message;
          console.error("[Leo] Meta campaign creation failed:", err.message);
        }
      }

      const campaign = insert("campaigns", {
        user_id: userId,
        name: args.name,
        channel: args.channel,
        status: args.status || "Rascunho",
        budget: args.budget,
        spend: "R$ 0",
        conv: 0,
        cpa: "R$ 0",
        roas: "0.0x",
        ctr: "0.00%",
        objective: args.objective,
        external_id: metaCampaignId ? `meta_${metaCampaignId}` : null,
      });

      const msg = metaCampaignId
        ? `Campanha "${campaign.name}" criada no Meta Ads Manager (ID: ${metaCampaignId}) e salva no sistema!`
        : metaError
          ? `Campanha "${campaign.name}" salva no sistema. Erro ao criar no Meta: ${metaError}`
          : `Campanha "${campaign.name}" criada no sistema!`;

      return JSON.stringify({ success: true, campaign_id: campaign.id, meta_campaign_id: metaCampaignId, name: campaign.name, message: msg });
    }

    case "generate_creative": {
      try {
        const result = await generateImage(args.prompt, args.size || "1024x1024");
        const creative = insert("creatives", {
          user_id: userId,
          name: `Leo: ${args.prompt.substring(0, 60)}`,
          type: "image",
          channel: "meta",
          status: "ready",
          image_url: result.url || null,
          image_b64: result.b64_json || null,
          revised_prompt: result.revised_prompt,
          ai_generated: true,
          created_at: new Date().toISOString(),
        });
        return JSON.stringify({ success: true, creative_id: creative.id, image_url: result.url || null, image_b64: result.b64_json ? `data:image/png;base64,${result.b64_json.substring(0, 50)}...` : null, message: "Criativo gerado com sucesso!" });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    }

    case "generate_ad_copy": {
      try {
        const copy = await generateAdCopy(args);
        return JSON.stringify({ success: true, copy, message: "Copies geradas!" });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    }

    case "pause_campaign": {
      const changed = update("campaigns",
        c => c.id === args.campaign_id && c.user_id === userId,
        () => ({ status: "Pausada" })
      );
      if (changed === 0) return JSON.stringify({ success: false, error: "Campanha não encontrada" });
      insert("alerts", {
        user_id: userId,
        campaign_id: args.campaign_id,
        type: "pausada_leo",
        severity: "warning",
        title: `Campanha pausada pelo Leo`,
        desc: args.reason,
        resolved: false,
      });
      // Sync pause to Meta if campaign has external_id
      const camp = findOne("campaigns", c => c.id === args.campaign_id && c.user_id === userId);
      if (camp?.external_id?.startsWith("meta_")) {
        const metaId = camp.external_id.replace("meta_", "");
        metaUpdateStatus(userId, metaId, "Pausada").catch(e => console.error("[Leo] Meta pause failed:", e.message));
      }
      return JSON.stringify({ success: true, message: `Campanha pausada. Motivo: ${args.reason}` });
    }

    case "activate_campaign": {
      const changed = update("campaigns",
        c => c.id === args.campaign_id && c.user_id === userId,
        () => ({ status: "Ativa", auto_paused: false })
      );
      if (changed === 0) return JSON.stringify({ success: false, error: "Campanha não encontrada" });
      // Sync activation to Meta if campaign has external_id
      const camp = findOne("campaigns", c => c.id === args.campaign_id && c.user_id === userId);
      if (camp?.external_id?.startsWith("meta_")) {
        const metaId = camp.external_id.replace("meta_", "");
        metaUpdateStatus(userId, metaId, "Ativa").catch(e => console.error("[Leo] Meta activate failed:", e.message));
      }
      return JSON.stringify({ success: true, message: "Campanha reativada com sucesso!" });
    }

    case "create_adset": {
      let metaAdsetId = null;
      let metaAdsetError = null;

      if (args.meta_campaign_id) {
        try {
          const result = await metaCreateAdSet(userId, args);
          metaAdsetId = result.id;
        } catch (err) {
          metaAdsetError = err.message;
          console.error("[Leo] Meta adset creation failed:", err.message);
        }
      }

      const adset = insert("adsets", {
        user_id: userId,
        campaign_id: args.campaign_id,
        name: args.name,
        daily_budget: args.daily_budget,
        optimization_goal: args.optimization_goal,
        age_min: args.age_min || 18,
        age_max: args.age_max || 65,
        genders: args.genders || "all",
        interests: args.interests || [],
        placement: args.placement || "feed, stories, reels",
        status: args.status || "Pausada",
        external_id: metaAdsetId ? `meta_${metaAdsetId}` : null,
      });

      const msg = metaAdsetId
        ? `Conjunto "${adset.name}" criado no Meta (ID: ${metaAdsetId})!`
        : metaAdsetError
          ? `Conjunto "${adset.name}" salvo no sistema. Meta: ${metaAdsetError}`
          : `Conjunto "${adset.name}" criado!`;

      return JSON.stringify({ success: true, adset_id: adset.id, meta_adset_id: metaAdsetId, name: adset.name, message: msg });
    }

    case "create_ad": {
      let metaAdId = null;

      if (args.meta_adset_id) {
        try {
          const result = await metaCreateAd(userId, args);
          metaAdId = result.id;
        } catch (err) {
          console.error("[Leo] Meta ad creation failed:", err.message);
        }
      }

      const destinationUrl = args.destination_url
        ? (args.utm ? `${args.destination_url}?${args.utm}` : args.destination_url)
        : null;

      const ad = insert("ads", {
        user_id: userId,
        adset_id: args.adset_id,
        name: args.name,
        headline: args.headline,
        primary_text: args.primary_text,
        description: args.description || "",
        cta: args.cta,
        destination_url: destinationUrl,
        creative_id: args.creative_id || null,
        format: args.format || "feed",
        status: "Pausado",
        external_id: metaAdId ? `meta_${metaAdId}` : null,
      });

      return JSON.stringify({ success: true, ad_id: ad.id, name: ad.name, message: `Anúncio "${ad.name}" criado!` });
    }

    case "create_alert": {
      const alert = insert("alerts", {
        user_id: userId,
        type: "leo_alert",
        severity: args.severity,
        title: args.title,
        desc: args.desc,
        resolved: false,
      });
      return JSON.stringify({ success: true, alert_id: alert.id, message: "Alerta criado!" });
    }

    default:
      return JSON.stringify({ error: "Tool não reconhecida" });
  }
}

router.post("/", async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Mensagem não pode estar vazia" });

  insert("chat_messages", { user_id: req.userId, role: "user", text: text.trim() });

  // Gather user context for the AI
  const user = findOne("users", u => u.id === req.userId) || {};
  const connections = findAll("connections", r => r.user_id === req.userId && r.connected === true);
  const campaigns = findAll("campaigns", r => r.user_id === req.userId);
  const alerts = findAll("alerts", r => r.user_id === req.userId);
  const creatives = findAll("creatives", r => r.user_id === req.userId);

  const campaignSummary = campaigns.slice(0, 10).map(c => {
    const metaId = c.external_id?.startsWith("meta_") ? c.external_id.replace("meta_", "") : null;
    return `• [ID:${c.id}${metaId ? ` | MetaID:${metaId}` : ""}] ${c.name} (${c.channel}) — Status: ${c.status} | ROAS: ${c.roas} | CPA: ${c.cpa} | CTR: ${c.ctr} | Budget: ${c.budget} | Gasto: ${c.spend} | Conv: ${c.conv}`;
  }).join("\n");

  const alertsSummary = alerts.slice(0, 5).map(a =>
    `• [${a.severity}] ${a.title} — ${a.desc || a.description || ""}`
  ).join("\n");

  const creativesSummary = creatives.slice(0, 15).map(c =>
    `• [ID:${c.id}] "${c.name}" | Formato: ${c.format || c.type || "Imagem"} | Canal: ${c.channel || "-"} | Status: ${c.status || "-"}${c.category ? ` | Categoria: ${c.category}` : ""}${c.ai_generated ? " | Gerado por IA" : ""}`
  ).join("\n");

  const userData = {
    name: user.name,
    company: user.company,
    campaignCount: campaigns.length,
    googleConnected: connections.some(c => c.platform === "google"),
    metaConnected: connections.some(c => c.platform === "meta"),
    campaignSummary,
    alertsSummary,
    creativesCount: creatives.length,
    creativesSummary,
  };

  // Build conversation history (last 20 messages for context)
  const history = findAll("chat_messages", r => r.user_id === req.userId);
  history.sort((a, b) => a.id - b.id);
  const recentHistory = history.slice(-20).map(m => {
    let content;
    if (typeof m.text === "string") content = m.text;
    else if (typeof m.text?.choices?.[0]?.message?.content === "string") content = m.text.choices[0].message.content;
    else content = JSON.stringify(m.text) || null;
    return { role: m.role === "user" ? "user" : "assistant", content };
  }).filter(m => typeof m.content === "string" && m.content.trim());

  // Inject visual context: include creative images so Leo can actually see them
  // Accept both base64 (data:) and external URLs (https://) — skip local /api/ paths
  const creativesWithImages = creatives
    .filter(c => c.image_url && (c.image_url.startsWith("data:") || c.image_url.startsWith("https://")))
    .slice(0, 8);

  console.log(`[Leo Vision] ${creativesWithImages.length} imagens enviadas de ${creatives.length} criativos totais`);

  let messagesForAI = recentHistory;
  if (creativesWithImages.length > 0) {
    const visionContext = {
      role: "user",
      content: [
        {
          type: "text",
          text: `[Contexto visual — criativos da biblioteca do usuário. ANALISE CADA IMAGEM REAL antes de opinar sobre qualidade, ângulo ou desempenho. NÃO INVENTE análise se não conseguir ver claramente.]\n${creativesWithImages.map((c, i) => `${i + 1}. ${c.name} (ID:${c.id})`).join("\n")}`,
        },
        ...creativesWithImages.map(c => ({
          type: "image_url",
          image_url: { url: c.image_url, detail: "high" },
        })),
      ],
    };
    // Insert vision context before the last user message
    messagesForAI = [
      ...recentHistory.slice(0, -1),
      visionContext,
      recentHistory[recentHistory.length - 1],
    ];
  }

  try {
    let response = await chatCompletion(messagesForAI, userData);
    let message = response.choices[0].message;
    const conversationMessages = [
      { role: "system", content: "" }, // placeholder, chatCompletion handles system
      ...messagesForAI,
      message,
    ];

    let collectedImages = [];
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    // Process tool calls in a loop
    while (message.tool_calls && message.tool_calls.length > 0 && iterations < MAX_ITERATIONS) {
      iterations++;
      const toolResults = [];

      for (const toolCall of message.tool_calls) {
        console.log(`[Leo Tool] ${toolCall.function.name}:`, toolCall.function.arguments);
        const result = await executeToolCall(toolCall, req.userId);
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });

        if (toolCall.function.name === "generate_creative") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.success) {
              const creatives = findAll("creatives", c => c.user_id === req.userId && c.ai_generated === true);
              const latest = creatives.sort((a, b) => b.id - a.id)[0];
              if (latest && latest.image_url) collectedImages.push(latest.image_url);
            }
          } catch {}
        }
      }

      // Send tool results back — PASSANDO tools para Leo poder continuar chamando
      const OpenAI = require("openai");
      const { LEO_TOOLS } = require("../services/openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const followUp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [...conversationMessages, ...toolResults],
        tools: LEO_TOOLS,
        max_completion_tokens: 4000,
        temperature: 0.7,
      });

      message = followUp.choices[0].message;
      conversationMessages.push(...toolResults, message);
    }

    const aiText = message.content || "Pronto, executei as ações! Confere aí nas páginas de Campanhas e Criativos.";
    const savedMsg = { user_id: req.userId, role: "assistant", text: aiText };
    if (collectedImages.length > 0) savedMsg.images = collectedImages;
    insert("chat_messages", savedMsg);

    const responsePayload = { role: "assistant", text: aiText };
    if (collectedImages.length > 0) responsePayload.images = collectedImages;
    res.json(responsePayload);

  } catch (err) {
    console.error("OpenAI chat error:", err.message);
    const fallback = "Erro ao processar: " + err.message;
    insert("chat_messages", { user_id: req.userId, role: "assistant", text: fallback });
    res.json({ role: "assistant", text: fallback });
  }
});

// Clear chat history
router.delete("/", (req, res) => {
  remove("chat_messages", r => r.user_id === req.userId);
  res.json({ success: true });
});

module.exports = router;
