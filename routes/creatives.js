const express = require("express");
const { findAll, findOne, insert, update, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(findAll("creatives", r => r.user_id === req.userId).reverse());
});

router.post("/", (req, res) => {
  const { name, format, channel, campaign_id } = req.body;
  if (!name) return res.status(400).json({ error: "Nome é obrigatório" });
  const creative = insert("creatives", {
    user_id: req.userId, name, format: format || "Imagem", channel: channel || "Google",
    campaign_id: campaign_id || null, status: "Ativo", thumb: "🎨", asset_url: "",
  });
  res.status(201).json(creative);
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, status, format, channel } = req.body;
  const changes = update("creatives", r => r.id === id && r.user_id === req.userId, (r) => ({
    name: name ?? r.name, status: status ?? r.status, format: format ?? r.format, channel: channel ?? r.channel,
  }));
  if (!changes) return res.status(404).json({ error: "Criativo não encontrado" });
  res.json(findOne("creatives", r => r.id === id));
});

router.delete("/:id", (req, res) => {
  const removed = remove("creatives", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Criativo não encontrado" });
  res.json({ success: true });
});

module.exports = router;
