"use server";
import { redirect } from "next/navigation";

export async function login(email: string, password: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return "Variables Supabase manquantes dans Vercel";
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) return data.error_description || data.msg || data.error || "Erreur connexion";
  redirect("/");
}

export async function signup(email: string, password: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return "Variables Supabase manquantes dans Vercel";
  const endpoint = `${url}/auth/v1/signup`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) return `URL utilisée: ${endpoint.slice(0, 50)}... | ${res.status} — ${data.code || data.error || JSON.stringify(data)}`;
  redirect("/");
}
