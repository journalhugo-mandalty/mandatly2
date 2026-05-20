import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key);
  return _client;
}

export const SUPABASE_SETUP_SQL = `
-- Run once in your Supabase SQL editor:
CREATE TABLE IF NOT EXISTS user_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  mandats jsonb DEFAULT '[]',
  acheteurs jsonb DEFAULT '[]',
  rdvs jsonb DEFAULT '[]',
  transacs jsonb DEFAULT '[]',
  courriers jsonb DEFAULT '[]',
  agent jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own data" ON user_data FOR ALL USING (auth.uid() = user_id);
`.trim();
