const express = require("express");
const { findAll, insert, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = findAll("keywords", r => r.user_id === req.userId);
  rows.sort((a, b) => (b.conv || 0) - (a.conv || 0));
  res.json(rows);
});

router.post("/", (req, res) => {
  const { keyword, intent, cpc, volume, quality, campaign_id } = req.body;
  if (!keyword) return res.status(400).json({ error: "Palavra-chave é obrigatória" });
  const kw = insert("keywords", {
    user_id: req.userId, keyword, intent: intent || "Pesquisa", cpc: cpc || "R$ 0.00",
    volume: volume || "0", quality: quality || 5, conv: 0, campaign_id: campaign_id || null,
  });
  res.status(201).json(kw);
});

router.delete("/:id", (req, res) => {
  const removed = remove("keywords", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Palavra-chave não encontrada" });
  res.json({ success: true });
});

module.exports = router;
