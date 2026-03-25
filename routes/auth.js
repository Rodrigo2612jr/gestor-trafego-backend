const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { findOne, insert, update, findAll } = require("../db/database");

const router = express.Router();

router.post("/register", (req, res) => {
  const { name, email, password, company } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Nome, email e senha são obrigatórios" });

  const existing = findOne("users", u => u.email === email);
  if (existing) return res.status(409).json({ error: "Email já cadastrado" });

  const hash = bcrypt.hashSync(password, 10);
  const user = insert("users", { name, email, password: hash, phone: "", role: "", company: company || "", avatar: "" });

  const platforms = ["google", "meta", "analytics", "tagmanager", "crm", "webhook", "pixel", "api"];
  for (const p of platforms) {
    insert("connections", { user_id: user.id, platform: p, connected: false, account_name: null, last_sync: null, status: "disconnected" });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ token, user: { id: user.id, name, email, company: company || "" } });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email e senha são obrigatórios" });

  const user = findOne("users", u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: "Credenciais inválidas" });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, company: user.company, avatar: user.avatar } });
});

const authMiddleware = require("../middleware/auth");

router.get("/me", authMiddleware, (req, res) => {
  const user = findOne("users", u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
  const { password, ...safe } = user;
  res.json(safe);
});

router.put("/me", authMiddleware, (req, res) => {
  const { name, phone, role, company, website_url } = req.body;
  update("users", u => u.id === req.userId, (u) => ({
    name: name ?? u.name, phone: phone ?? u.phone, role: role ?? u.role, company: company ?? u.company,
    website_url: website_url ?? u.website_url,
  }));
  const user = findOne("users", u => u.id === req.userId);
  const { password, ...safe } = user;
  res.json(safe);
});

module.exports = router;
