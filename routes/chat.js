const express = require("express");
const { findAll, insert, remove, findOne } = require("../db/database");
const { chatCompletion, generateImage, generateAdCopy } = require("../services/openai");

const router = express.Router();

router.get("/", (req, res) => {
  const messages = findAll("chat_messages", r => r.user_id === req.userId);
  messages.sort((a, b) => (a.id - b.id));
  res.json(messages.slice(-100).map(m => ({ id: m.id, role: m.role, text: m.text, images: m.images, created_at: m.created_at })));
});

// ─── Execute tool calls from Leo ───
async function executeToolCall(toolCall, userId) {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  switch (name) {
    case "create_campaign": {
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
      });
      return JSON.stringify({ success: true, campaign_id: campaign.id, name: campaign.name, message: `Campanha "${campaign.name}" criada com sucesso no sistema!` });
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

  const campaignSummary = campaigns.slice(0, 10).map(c =>
    `• ${c.name} (${c.channel}) — Status: ${c.status} | ROAS: ${c.roas} | CPA: ${c.cpa} | CTR: ${c.ctr} | Budget: ${c.budget} | Gasto: ${c.spend} | Conv: ${c.conv}`
  ).join("\n");

  const alertsSummary = alerts.slice(0, 5).map(a =>
    `• [${a.severity}] ${a.title} — ${a.desc || a.description || ""}`
  ).join("\n");

  const userData = {
    name: user.name,
    company: user.company,
    campaignCount: campaigns.length,
    googleConnected: connections.some(c => c.platform === "google"),
    metaConnected: connections.some(c => c.platform === "meta"),
    campaignSummary,
    alertsSummary,
  };

  // Build conversation history (last 20 messages for context)
  const history = findAll("chat_messages", r => r.user_id === req.userId);
  history.sort((a, b) => a.id - b.id);
  const recentHistory = history.slice(-20).map(m => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));

  try {
    let response = await chatCompletion(recentHistory, userData);
    let message = response.choices[0].message;
    const conversationMessages = [
      { role: "system", content: "" }, // placeholder, chatCompletion handles system
      ...recentHistory,
      message,
    ];

    let collectedImages = [];
    let iterations = 0;
    const MAX_ITERATIONS = 5;

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

        // If an image was generated, collect the URL
        if (toolCall.function.name === "generate_creative") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.success) {
              // Fetch the actual image URL from the creative
              const creatives = findAll("creatives", c => c.user_id === req.userId && c.ai_generated === true);
              const latest = creatives.sort((a, b) => b.id - a.id)[0];
              if (latest && latest.image_url) {
                collectedImages.push(latest.image_url);
              }
            }
          } catch {}
        }
      }

      // Send tool results back to get Leo's final response
      const OpenAI = require("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const followUp = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          ...conversationMessages,
          ...toolResults,
        ],
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
