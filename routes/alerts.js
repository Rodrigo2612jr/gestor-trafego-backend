const express = require("express");
const { findAll, insert, update, remove } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = findAll("alerts", r => r.user_id === req.userId).reverse();
  res.json(rows.map(r => ({ id: r.id, title: r.title, desc: r.description, severity: r.severity, action: r.action, read: !!r.read, created_at: r.created_at })));
});

router.post("/", (req, res) => {
  const { title, description, severity, action } = req.body;
  if (!title) return res.status(400).json({ error: "Título é obrigatório" });
  const alert = insert("alerts", { user_id: req.userId, title, description: description || "", severity: severity || "warning", action: action || "Ver detalhes", read: false });
  res.status(201).json({ id: alert.id, title: alert.title, desc: alert.description, severity: alert.severity, action: alert.action });
});

router.put("/:id/read", (req, res) => {
  update("alerts", r => r.id === Number(req.params.id) && r.user_id === req.userId, () => ({ read: true }));
  res.json({ success: true });
});

router.delete("/:id", (req, res) => {
  const removed = remove("alerts", r => r.id === Number(req.params.id) && r.user_id === req.userId);
  if (!removed) return res.status(404).json({ error: "Alerta não encontrado" });
  res.json({ success: true });
});

module.exports = router;
