const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

// ─── Supabase (production) or JSON file (local dev) ───
const USE_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
let supabase = null;
if (USE_SUPABASE) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

const DB_PATH = process.env.VERCEL
  ? "/tmp/db.json"
  : path.join(__dirname, "..", "data", "db.json");

const defaultData = {
  _autoId: { users: 0, connections: 0, campaigns: 0, creatives: 0, audiences: 0, keywords: 0, alerts: 0, chat_messages: 0, reports: 0, oauth_tokens: 0, settings: 0, sync_logs: 0 },
  users: [], connections: [], campaigns: [], creatives: [], audiences: [],
  keywords: [], alerts: [], chat_messages: [], reports: [], oauth_tokens: [], settings: [], sync_logs: [],
};

let data = null;

// ─── Load from Supabase on startup ───
async function initDatabase() {
  if (USE_SUPABASE) {
    try {
      const { data: rows, error } = await supabase
        .from("db_records")
        .select("table_name, record_id, data")
        .order("record_id", { ascending: true });

      if (error) throw error;

      data = JSON.parse(JSON.stringify(defaultData));
      for (const row of (rows || [])) {
        const tbl = row.table_name;
        if (data[tbl]) {
          data[tbl].push(row.data);
          if (row.data.id > (data._autoId[tbl] || 0)) {
            data._autoId[tbl] = row.data.id;
          }
        }
      }
      console.log(`[DB] Supabase carregado — ${rows?.length || 0} registros`);
    } catch (err) {
      console.error("[DB] Erro Supabase, usando arquivo:", err.message);
      loadFromFile();
    }
  } else {
    loadFromFile();
  }

  ensureDefaultUser();
}

// ─── File fallback (local dev) ───
function loadFromFile() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } else {
    data = JSON.parse(JSON.stringify(defaultData));
    saveToFile();
  }
}

function saveToFile() {
  if (!USE_SUPABASE) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  }
}

// ─── Sync a single record to Supabase (fire and forget) ───
function syncUpsert(table, record) {
  if (!USE_SUPABASE || !supabase) return;
  supabase.from("db_records")
    .upsert({ table_name: table, record_id: record.id, data: record, updated_at: new Date().toISOString() },
             { onConflict: "table_name,record_id" })
    .then(({ error }) => { if (error) console.error("[DB Sync] upsert error:", error.message); });
}

function syncDelete(table, ids) {
  if (!USE_SUPABASE || !supabase || ids.length === 0) return;
  supabase.from("db_records")
    .delete()
    .eq("table_name", table)
    .in("record_id", ids)
    .then(({ error }) => { if (error) console.error("[DB Sync] delete error:", error.message); });
}

// ─── Ensure admin user exists ───
function ensureDefaultUser() {
  if (!data) return;
  if (data.users.length === 0) {
    const email = process.env.ADMIN_EMAIL || "admin@gestor.com";
    const pass = process.env.ADMIN_PASSWORD || "123456";
    const hash = bcrypt.hashSync(pass, 10);
    data._autoId.users = (data._autoId.users || 0) + 1;
    const user = { id: data._autoId.users, name: "Admin", email, password: hash, phone: "", role: "admin", company: "", avatar: "", created_at: new Date().toISOString() };
    data.users.push(user);
    syncUpsert("users", user);

    const platforms = ["google", "meta", "analytics", "tagmanager", "crm", "webhook", "pixel", "api"];
    for (const p of platforms) {
      data._autoId.connections = (data._autoId.connections || 0) + 1;
      const conn = { id: data._autoId.connections, user_id: user.id, platform: p, connected: false, account_name: null, last_sync: null, status: "disconnected", created_at: new Date().toISOString() };
      data.connections.push(conn);
      syncUpsert("connections", conn);
    }
    saveToFile();
    console.log(`✅ Usuário admin criado: ${email}`);
  }
}

// ─── Public API (synchronous — same interface as before) ───
function load() {
  if (!data) loadFromFile();
  return data;
}

function getDb() { return load(); }

function insert(table, record) {
  const db = load();
  db._autoId[table] = (db._autoId[table] || 0) + 1;
  const row = { id: db._autoId[table], ...record, created_at: new Date().toISOString() };
  db[table].push(row);
  syncUpsert(table, row);
  saveToFile();
  return row;
}

function findAll(table, filterFn = () => true) {
  const db = load();
  return (db[table] || []).filter(filterFn);
}

function findOne(table, filterFn) {
  const db = load();
  return (db[table] || []).find(filterFn) || null;
}

function update(table, filterFn, updater) {
  const db = load();
  let changes = 0;
  for (let i = 0; i < db[table].length; i++) {
    if (filterFn(db[table][i])) {
      db[table][i] = { ...db[table][i], ...updater(db[table][i]) };
      syncUpsert(table, db[table][i]);
      changes++;
    }
  }
  if (changes > 0) saveToFile();
  return changes;
}

function remove(table, filterFn) {
  const db = load();
  const before = db[table].length;
  const removed = db[table].filter(r => filterFn(r)).map(r => r.id);
  db[table] = db[table].filter(r => !filterFn(r));
  const count = before - db[table].length;
  if (count > 0) {
    syncDelete(table, removed);
    saveToFile();
  }
  return count;
}

function save() { saveToFile(); }

module.exports = { initDatabase, getDb, insert, findAll, findOne, update, remove, save };
