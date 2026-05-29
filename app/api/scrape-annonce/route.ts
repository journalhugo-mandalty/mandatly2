import { NextRequest, NextResponse } from "next/server";

// Tente d'extraire la ville depuis le slug d'URL (seloger, leboncoin, pap, bienici...)
function cityFromUrl(url: string): { ville: string; cp: string } {
  try {
    const u = new URL(url);
    const path = u.pathname + u.hostname;
    // Patterns : /bordeaux-33/ ou /33000-bordeaux ou /vente/maison/bordeaux_33/
    const cpCity = path.match(/[/_-](\d{5})[/_-]([a-z-]+)/i);
    if (cpCity) return { cp: cpCity[1], ville: cpCity[2].replace(/-/g, " ") };
    const cityDept = path.match(/[/_]([a-z-]{4,})-(\d{2,3})[/_]/i);
    if (cityDept) return { cp: cityDept[2].padEnd(5, "0"), ville: cityDept[1].replace(/-/g, " ") };
    const cityOnly = path.match(/\/(vente|achat|location)\/(?:maison|appartement)\/([a-z-]{4,})\//i);
    if (cityOnly) return { cp: "", ville: cityOnly[2].replace(/-/g, " ") };
  } catch {}
  return { ville: "", cp: "" };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { url, text } = body as { url?: string; text?: string };

  if (!url && !text) {
    return NextResponse.json({ error: "URL ou texte requis" }, { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY non configurée" }, { status: 500 });
  }

  let content = text || "";

  // ── Si URL fournie : tenter Jina, sinon extraire la ville du slug ────────
  if (url && !content) {
    let jinaOk = false;
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        headers: { "Accept": "text/markdown", "X-Return-Format": "markdown" },
        signal: AbortSignal.timeout(20000),
      });
      if (jinaRes.ok) {
        const md = await jinaRes.text();
        if (md && md.length > 200 && !md.includes("security verification") && !md.includes("CAPTCHA")) {
          content = md;
          jinaOk = true;
        }
      }
    } catch { /* Jina bloqué */ }

    if (!jinaOk) {
      // Fallback : extraire ce qu'on peut de l'URL et demander le texte
      const { ville, cp } = cityFromUrl(url);
      return NextResponse.json({
        partial: true,
        ville,
        cp,
        error_hint: "Ce site bloque la lecture automatique. Copiez-collez la description de l'annonce dans le champ texte.",
      });
    }
  }

  if (!content || content.length < 50) {
    return NextResponse.json({ error: "Contenu trop court pour extraire des données" }, { status: 422 });
  }

  // ── Claude Haiku — extraction structurée ─────────────────────────────────
  const prompt = `Tu es un extracteur de données immobilières françaises. Analyse ce texte d'annonce et retourne UNIQUEMENT un objet JSON valide, sans markdown ni explication.

Texte :
${content.slice(0, 20000)}

JSON :
{
  "titre": "titre de l'annonce",
  "ville": "commune (ex: Bordeaux)",
  "cp": "code postal 5 chiffres ou chaîne vide",
  "type": "Maison" ou "Appartement",
  "surface": nombre entier m² habitable,
  "terrain": nombre entier m² terrain (0 si aucun),
  "prix": nombre entier euros (0 si inconnu),
  "nb_pieces": nombre entier (0 si inconnu),
  "description": "description complète max 600 caractères",
  "adresse_indicative": "rue ou adresse si mentionnée sinon vide",
  "indices_localisation": "quartier, rues proches, écoles, gare, commerces, orientation — tout indice utile"
}`;

  try {
    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!cr.ok) return NextResponse.json({ error: "Extraction IA échouée" }, { status: 500 });
    const cd = await cr.json();
    const raw = (cd.content?.[0]?.text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/, "")
      .trim();
    const extracted = JSON.parse(raw);
    return NextResponse.json({ ...extracted, photos: [] });
  } catch {
    return NextResponse.json({ error: "Extraction échouée" }, { status: 422 });
  }
}
