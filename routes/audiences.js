const express = require("express");
const { findAll, insert, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(findAll("audiences", r => r.user_id === req.userId).reverse());
});

router.post("/", (req, res) => {
  const { name, type, channel } = req.body;
  if (!name) return res.status(400).json({ error: "Nome é obrigatório" });
  const audience = insert("audiences", {
    user_id: req.userId, name, type: type || "Personalizado", channel: channel || "Google",
    status: "Ativo", size: "0", perf: "—",
  });
  res.status(201).json(audience);
});

router.delete("/:id", (req, res) => {
  const removed = remove("audiences", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Público não encontrado" });
  res.json({ success: true });
});

module.exports = router;
