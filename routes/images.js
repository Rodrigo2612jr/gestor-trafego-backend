const express = require("express");
const { generateImage, generateAdCopy } = require("../services/openai");
const { insert, findAll } = require("../db/database");

const router = express.Router();

// ─── Generate image with DALL-E 3 ───
router.post("/generate", async (req, res) => {
  const { prompt, size } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt não fornecido" });

  try {
    const result = await generateImage(prompt, size || "1024x1024");

    // Save the generated image as a creative
    const creative = insert("creatives", {
      user_id: req.userId,
      name: `AI: ${prompt.substring(0, 60)}`,
      type: "image",
      channel: "meta",
      status: "ready",
      image_url: result.url,
      revised_prompt: result.revised_prompt,
      ai_generated: true,
      created_at: new Date().toISOString(),
    });

    res.json({ creative, image_url: result.url, revised_prompt: result.revised_prompt });
  } catch (err) {
    console.error("Image generation error:", err.message);
    res.status(500).json({ error: "Erro ao gerar imagem: " + err.message });
  }
});

// ─── Generate ad copy with GPT-4o ───
router.post("/adcopy", async (req, res) => {
  const { product, objective, channel, audience, tone } = req.body;
  if (!product || !objective) {
    return res.status(400).json({ error: "Produto e objetivo são obrigatórios" });
  }

  try {
    const copy = await generateAdCopy({ product, objective, channel, audience, tone });
    res.json(copy);
  } catch (err) {
    console.error("Ad copy error:", err.message);
    res.status(500).json({ error: "Erro ao gerar copy: " + err.message });
  }
});

// ─── List AI-generated creatives ───
router.get("/creatives", (req, res) => {
  const creatives = findAll("creatives", c => c.user_id === req.userId && c.ai_generated === true);
  res.json(creatives);
});

module.exports = router;
