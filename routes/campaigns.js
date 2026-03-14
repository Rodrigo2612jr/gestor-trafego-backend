const express = require("express");
const { findAll, findOne, insert, update, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = findAll("campaigns", r => r.user_id === req.userId);
  res.json(rows.reverse());
});

router.get("/:id", (req, res) => {
  const row = findOne("campaigns", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!row) return res.status(404).json({ error: "Campanha não encontrada" });
  res.json(row);
});

router.post("/", (req, res) => {
  const { name, channel, status, budget, objective } = req.body;
  if (!name || !channel) return res.status(400).json({ error: "Nome e canal são obrigatórios" });
  const campaign = insert("campaigns", {
    user_id: req.userId, name, channel, status: status || "Ativa",
    budget: budget || "R$ 0", spend: "R$ 0", conv: 0, cpa: "R$ 0", roas: "0.0x", ctr: "0.00%", objective: objective || "",
  });
  res.status(201).json(campaign);
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = findOne("campaigns", r => r.id === id && r.user_id === req.userId);
  if (!existing) return res.status(404).json({ error: "Campanha não encontrada" });
  const { name, status, budget, spend, conv, cpa, roas, ctr } = req.body;
  update("campaigns", r => r.id === id, (r) => ({
    name: name ?? r.name, status: status ?? r.status, budget: budget ?? r.budget,
    spend: spend ?? r.spend, conv: conv ?? r.conv, cpa: cpa ?? r.cpa, roas: roas ?? r.roas, ctr: ctr ?? r.ctr,
  }));
  res.json(findOne("campaigns", r => r.id === id));
});

router.delete("/:id", (req, res) => {
  const removed = remove("campaigns", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Campanha não encontrada" });
  res.json({ success: true });
});

module.exports = router;
