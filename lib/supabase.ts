import { createClient as createBrowserClient } from "@/utils/supabase/client";

export const SUPABASE_SETUP_SQL = `
CREATE TABLE IF NOT EXISTS user_data (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  mandats       jsonb DEFAULT '[]',
  acheteurs     jsonb DEFAULT '[]',
  rdvs          jsonb DEFAULT '[]',
  transacs      jsonb DEFAULT '[]',
  courriers     jsonb DEFAULT '[]',
  agent         jsonb DEFAULT '{}',
  radar_villes  jsonb DEFAULT '[]',
  crm_statuses  jsonb DEFAULT '{}',
  prosp_crm     jsonb DEFAULT '{}',
  sent_count    integer DEFAULT 0,
  mandats_prosp integer DEFAULT 0,
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own data" ON user_data
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
`.trim();

export type UserData = {
  mandats: any[];
  acheteurs: any[];
  rdvs: any[];
  transacs: any[];
  courriers: any[];
  agent: Record<string, any>;
  radar_villes: string[];
  crm_statuses: Record<string, any>;
  prosp_crm: Record<string, any>;
  sent_count: number;
  mandats_prosp: number;
};

export const DEFAULT_USER_DATA: UserData = {
  mandats: [], acheteurs: [], rdvs: [], transacs: [], courriers: [],
  agent: {}, radar_villes: [], crm_statuses: {}, prosp_crm: {},
  sent_count: 0, mandats_prosp: 0,
};

export async function loadUserData(): Promise<UserData | null> {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("user_data").select("*").eq("user_id", user.id).single();
  if (!data) return null;
  return data as unknown as UserData;
}

export async function saveUserData(payload: Partial<UserData>): Promise<void> {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_data").upsert(
    { user_id: user.id, ...payload, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

export async function signOut(): Promise<void> {
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
}
