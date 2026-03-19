const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { findAll, insert, findOne } = require("../db/database");
const { textToSpeech, speechToText, chatCompletion } = require("../services/openai");

const router = express.Router();

// Configure multer for audio uploads
const uploadDir = process.env.VERCEL
  ? "/tmp/uploads"
  : path.join(__dirname, "..", "data", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `voice_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max (Whisper limit)
  fileFilter: (_req, file, cb) => {
    const allowed = [".webm", ".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mpeg", ".mpga"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Formato de áudio não suportado"));
    }
  },
});

// ─── Speech-to-Text: Upload audio → get transcription ───
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo de áudio enviado" });

  try {
    const transcript = await speechToText(req.file.path);
    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});
    res.json({ text: transcript });
  } catch (err) {
    console.error("STT error:", err.message);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Erro ao transcrever áudio: " + err.message });
  }
});

// ─── Text-to-Speech: Send text → get audio back ───
router.post("/speak", async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: "Texto não fornecido" });

  try {
    const audioBuffer = await textToSpeech(text, voice || "coral");
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).json({ error: "Erro ao gerar áudio: " + err.message });
  }
});

// ─── Full voice chat: Upload audio → AI response → audio back ───
router.post("/chat", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo de áudio enviado" });

  try {
    // 1. Transcribe the audio
    const userText = await speechToText(req.file.path);
    fs.unlink(req.file.path, () => {});

    if (!userText.trim()) {
      return res.status(400).json({ error: "Não consegui entender o áudio" });
    }

    // 2. Save user message
    insert("chat_messages", { user_id: req.userId, role: "user", text: userText.trim() });

    // 3. Get AI response with context
    const user = findOne("users", u => u.id === req.userId) || {};
    const connections = findAll("connections", r => r.user_id === req.userId && r.connected === true);
    const campaigns = findAll("campaigns", r => r.user_id === req.userId);
    const alerts = findAll("alerts", r => r.user_id === req.userId);

    const campaignSummary = campaigns.slice(0, 10).map(c =>
      `• ${c.name} (${c.channel}) — Status: ${c.status} | ROAS: ${c.roas} | CPA: ${c.cpa}`
    ).join("\n");

    const userData = {
      name: user.name,
      company: user.company,
      campaignCount: campaigns.length,
      googleConnected: connections.some(c => c.platform === "google"),
      metaConnected: connections.some(c => c.platform === "meta"),
      campaignSummary,
      alertsSummary: alerts.slice(0, 3).map(a => `• [${a.severity}] ${a.title}`).join("\n"),
    };

    const history = findAll("chat_messages", r => r.user_id === req.userId);
    history.sort((a, b) => a.id - b.id);
    const recentHistory = history.slice(-20).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    const aiText = await chatCompletion(recentHistory, userData);
    insert("chat_messages", { user_id: req.userId, role: "assistant", text: aiText });

    // 4. Convert AI response to speech
    const audioBuffer = await textToSpeech(aiText, "coral");

    // 5. Return both text and audio
    res.json({
      userText,
      aiText,
      audio: audioBuffer.toString("base64"),
    });
  } catch (err) {
    console.error("Voice chat error:", err.message);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Erro no chat por voz: " + err.message });
  }
});

module.exports = router;
