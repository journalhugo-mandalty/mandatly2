"use client";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError("Email ou mot de passe incorrect"); setLoading(false); return; }
      router.push("/");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      router.push("/");
      router.refresh();
    }
  };

  const C = {
    bg: "#070D14", surface: "#0D1520", card: "#111C2A",
    border: "rgba(255,255,255,0.08)", text: "#F0EBE1",
    muted: "rgba(240,235,225,0.45)", gold: "#C4A35A",
    accent: "#C4A35A", red: "#EF4444", green: "#10B981",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-body, system-ui)" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontFamily: "var(--font-display, Georgia)", fontSize: 36, fontWeight: 400, color: C.text, fontStyle: "italic", letterSpacing: "-0.01em" }}>Mandatly</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>CRM Immobilier — Agent IA</div>
        </div>

        {/* Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "32px 28px" }}>

          {/* Tabs */}
          <div style={{ display: "flex", background: C.surface, borderRadius: 10, padding: 3, gap: 3, marginBottom: 28 }}>
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", background: mode === m ? C.gold : "transparent", color: mode === m ? "#080808" : C.muted }}>
                {m === "login" ? "Se connecter" : "Créer un compte"}
              </button>
            ))}
          </div>

          <form onSubmit={handle}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"
                placeholder="vous@agence.fr"
                style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", outline: "none" }}
                onFocus={e => e.target.style.borderColor = C.gold}
                onBlur={e => e.target.style.borderColor = C.border} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "signup" ? "Minimum 6 caractères" : "••••••••"}
                style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", outline: "none" }}
                onFocus={e => e.target.style.borderColor = C.gold}
                onBlur={e => e.target.style.borderColor = C.border} />
            </div>

            {error && <div style={{ background: `${C.red}18`, border: `1px solid ${C.red}40`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.red, marginBottom: 16 }}>{error}</div>}
            {success && <div style={{ background: `${C.green}18`, border: `1px solid ${C.green}40`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.green, marginBottom: 16 }}>{success}</div>}

            <button type="submit" disabled={loading}
              style={{ width: "100%", background: loading ? "rgba(196,163,90,0.4)" : C.gold, color: "#080808", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
              {loading ? "..." : mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: C.muted }}>
          Vos données sont chiffrées et isolées par compte.
        </div>
      </div>
    </div>
  );
}
