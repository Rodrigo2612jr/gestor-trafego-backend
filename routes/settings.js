const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const ENV_PATH = path.join(__dirname, "..", ".env");

// Keys that can be configured via UI (never expose JWT_SECRET, PORT, etc.)
const ALLOWED_KEYS = [
  "OPENAI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_AD_ACCOUNT_ID",
];

function parseEnv() {
  const content = fs.readFileSync(ENV_PATH, "utf-8");
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

function writeEnv(envMap) {
  const content = fs.readFileSync(ENV_PATH, "utf-8");
  const lines = content.split("\n");
  const updatedLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in envMap) {
      return `${key}=${envMap[key]}`;
    }
    return line;
  });
  fs.writeFileSync(ENV_PATH, updatedLines.join("\n"), "utf-8");
}

// GET — return current config (masked)
router.get("/credentials", (req, res) => {
  const env = parseEnv();
  const result = {};
  for (const key of ALLOWED_KEYS) {
    const val = env[key] || "";
    result[key] = {
      configured: val.length > 0,
      masked: val.length > 8 ? val.slice(0, 4) + "•".repeat(val.length - 8) + val.slice(-4) : val.length > 0 ? "••••" : "",
    };
  }
  res.json(result);
});

// PUT — update credentials
router.put("/credentials", (req, res) => {
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (key in req.body && typeof req.body[key] === "string") {
      const val = req.body[key].trim();
      // Only update if a new value is provided (not empty, not the masked placeholder)
      if (val && !val.includes("•")) {
        updates[key] = val;
        // Also update process.env so changes take effect without restart
        process.env[key] = val;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nenhuma credencial para atualizar" });
  }

  writeEnv(updates);

  // Reset OpenAI client so it picks up the new key
  if (updates.OPENAI_API_KEY) {
    try { require("../services/openai").resetClient(); } catch {}
  }

  const result = {};
  const env = parseEnv();
  for (const key of ALLOWED_KEYS) {
    const val = env[key] || "";
    result[key] = {
      configured: val.length > 0,
      masked: val.length > 8 ? val.slice(0, 4) + "•".repeat(val.length - 8) + val.slice(-4) : val.length > 0 ? "••••" : "",
    };
  }

  res.json({ message: `${Object.keys(updates).length} credencial(is) atualizada(s)`, credentials: result, updated: Object.keys(updates) });
});

// GET — test if OpenAI key works
router.get("/test-openai", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ ok: false, error: "OPENAI_API_KEY não configurada" });
  }
  try {
    const OpenAI = require("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.models.list();
    const models = [];
    for await (const m of r) {
      models.push(m.id);
      if (models.length >= 3) break;
    }
    res.json({ ok: true, models: models.length });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
