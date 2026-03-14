const express = require("express");
const { findAll, insert, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(findAll("reports", r => r.user_id === req.userId).reverse());
});

router.post("/", (req, res) => {
  const { title, type } = req.body;
  if (!title) return res.status(400).json({ error: "Título é obrigatório" });
  const campaigns = findAll("campaigns", r => r.user_id === req.userId);
  const report = insert("reports", {
    user_id: req.userId, title, type: type || "geral",
    data: JSON.stringify({ campaigns, generatedAt: new Date().toISOString() }),
  });
  res.status(201).json(report);
});

router.delete("/:id", (req, res) => {
  const removed = remove("reports", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Relatório não encontrado" });
  res.json({ success: true });
});

module.exports = router;
