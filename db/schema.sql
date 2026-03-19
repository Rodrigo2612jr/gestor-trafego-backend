-- Gestor de Tráfego AI — Supabase Schema
-- Cole este SQL no Supabase SQL Editor e execute

CREATE TABLE IF NOT EXISTS db_records (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(table_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_db_records_table ON db_records(table_name);

-- Disable RLS (backend handles auth via JWT)
ALTER TABLE db_records DISABLE ROW LEVEL SECURITY;
