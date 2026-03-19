const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { generateImage, generateAdCopy } = require("../services/openai");
const { insert, findAll } = require("../db/database");

const router = express.Router();

// ─── Multer config for image uploads ───
const uploadDir = path.join(__dirname, "..", "data", "uploads", "images");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Formato de imagem não suportado"));
    }
  },
});

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

// ─── Upload user images ───
router.post("/upload", upload.array("images", 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Nenhuma imagem enviada" });

  const creatives = req.files.map(file => {
    const name = req.body.name || file.originalname.replace(/\.[^.]+$/, "");
    return insert("creatives", {
      user_id: req.userId,
      name,
      type: "image",
      channel: req.body.channel || "meta",
      status: "ready",
      image_url: `/api/images/file/${file.filename}`,
      ai_generated: false,
      created_at: new Date().toISOString(),
    });
  });

  res.status(201).json(creatives.length === 1 ? { creative: creatives[0] } : { creatives });
});

// ─── Serve uploaded image files ───
router.get("/file/:filename", (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Imagem não encontrada" });
  res.sendFile(filePath);
});

module.exports = router;
