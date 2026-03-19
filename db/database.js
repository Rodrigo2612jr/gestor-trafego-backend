const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

// Vercel has read-only filesystem except /tmp
const DB_PATH = process.env.VERCEL
  ? "/tmp/db.json"
  : path.join(__dirname, "..", "data", "db.json");

const defaultData = {
  _autoId: { users: 0, connections: 0, campaigns: 0, creatives: 0, audiences: 0, keywords: 0, alerts: 0, chat_messages: 0, reports: 0, oauth_tokens: 0, settings: 0, sync_logs: 0 },
  users: [],
  connections: [],
  campaigns: [],
  creatives: [],
  audiences: [],
  keywords: [],
  alerts: [],
  chat_messages: [],
  reports: [],
  oauth_tokens: [],
  settings: [],
  sync_logs: [],
};

let data = null;

function load() {
  if (data) return data;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } else {
    data = JSON.parse(JSON.stringify(defaultData));
    save();
  }
  ensureDefaultUser();
  return data;
}

// Cria admin padrão se não existir nenhum usuário (Render apaga db.json nos restarts)
function ensureDefaultUser() {
  if (data.users.length === 0) {
    const email = process.env.ADMIN_EMAIL || "admin@gestor.com";
    const pass = process.env.ADMIN_PASSWORD || "123456";
    const hash = bcrypt.hashSync(pass, 10);
    data._autoId.users = (data._autoId.users || 0) + 1;
    const user = { id: data._autoId.users, name: "Admin", email, password: hash, phone: "", role: "admin", company: "", avatar: "", created_at: new Date().toISOString() };
    data.users.push(user);
    const platforms = ["google", "meta", "analytics", "tagmanager", "crm", "webhook", "pixel", "api"];
    for (const p of platforms) {
      data._autoId.connections = (data._autoId.connections || 0) + 1;
      data.connections.push({ id: data._autoId.connections, user_id: user.id, platform: p, connected: false, account_name: null, last_sync: null, status: "disconnected", created_at: new Date().toISOString() });
    }
    save();
    console.log(`✅ Usuário admin criado: ${email}`);
  }
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function getDb() {
  return load();
}

// Insert a record into a table, auto-incrementing id
function insert(table, record) {
  const db = load();
  db._autoId[table] = (db._autoId[table] || 0) + 1;
  const row = { id: db._autoId[table], ...record, created_at: new Date().toISOString() };
  db[table].push(row);
  save();
  return row;
}

// Find all records matching a filter function
function findAll(table, filterFn = () => true) {
  const db = load();
  return (db[table] || []).filter(filterFn);
}

// Find one record
function findOne(table, filterFn) {
  const db = load();
  return (db[table] || []).find(filterFn) || null;
}

// Update records matching filter. Returns number of changes.
function update(table, filterFn, updater) {
  const db = load();
  let changes = 0;
  for (let i = 0; i < db[table].length; i++) {
    if (filterFn(db[table][i])) {
      db[table][i] = { ...db[table][i], ...updater(db[table][i]) };
      changes++;
    }
  }
  if (changes > 0) save();
  return changes;
}

// Delete records matching filter. Returns number of deletions.
function remove(table, filterFn) {
  const db = load();
  const before = db[table].length;
  db[table] = db[table].filter(r => !filterFn(r));
  const removed = before - db[table].length;
  if (removed > 0) save();
  return removed;
}

module.exports = { getDb, insert, findAll, findOne, update, remove, save };
