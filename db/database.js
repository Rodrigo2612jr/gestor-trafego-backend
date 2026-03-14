const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

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
  return data;
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
