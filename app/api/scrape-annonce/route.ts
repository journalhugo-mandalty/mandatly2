import { NextRequest, NextResponse } from "next/server";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractJsonLd(html: string): any | null {
  const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const item of arr) {
        if (item["@type"] === "Product" || item["@type"] === "Offer" || item["@type"] === "RealEstateListing" || item.name || item.description) {
          return item;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

function extractImgUrls(html: string): string[] {
  const urls: string[] = [];
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    if (
      src.startsWith("http") &&
      !src.includes("logo") && !src.includes("icon") && !src.includes("avatar") &&
      !src.includes("tracking") && !src.includes("pixel") &&
      (src.match(/\.(jpg|jpeg|png|webp)/i) || src.includes("photo") || src.includes("image") || src.includes("media"))
    ) {
      urls.push(src);
    }
  }
  // Also check srcset
  const srcsetRe = /srcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    const parts = m[1].split(",").map(p => p.trim().split(" ")[0]);
    for (const p of parts) {
      if (p.startsWith("http") && p.match(/\.(jpg|jpeg|png|webp)/i)) urls.push(p);
    }
  }
  return [...new Set(urls)].slice(0, 10);
}

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({}));
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL requise" }, { status: 400 });
  }

  const scrapflyKey = process.env.SCRAPFLY_API_KEY;
  if (!scrapflyKey) {
    return NextResponse.json({ error: "SCRAPFLY_API_KEY non configurée" }, { status: 500 });
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY non configurée" }, { status: 500 });
  }

  // ── 1. Scrapfly — rendu JS + protection anti-bot ────────────────────────
  let html = "";
  try {
    const scrapeRes = await fetch(
      `https://api.scrapfly.io/scrape?key=${scrapflyKey}&url=${encodeURIComponent(url)}&render_js=true&asp=true&country=fr&timeout=30000`,
      { signal: AbortSignal.timeout(35000) }
    );
    if (!scrapeRes.ok) {
      const errBody = await scrapeRes.text().catch(() => "");
      return NextResponse.json({ error: `Scrapfly erreur ${scrapeRes.status}: ${errBody.slice(0, 200)}` }, { status: 502 });
    }
    const scrapeData = await scrapeRes.json();
    html = scrapeData.result?.content || "";
    if (!html) return NextResponse.json({ error: "Page vide — site peut-être protégé" }, { status: 422 });
  } catch (e: any) {
    return NextResponse.json({ error: "Scrapfly timeout ou réseau" }, { status: 504 });
  }

  // ── 2. Extraction rapide : JSON-LD + images ──────────────────────────────
  const jsonLd = extractJsonLd(html);
  const imgUrls = extractImgUrls(html);

  // ── 3. Claude Haiku — extraction structurée ──────────────────────────────
  const text = stripHtml(html).slice(0, 18000);

  const prompt = `Tu es un extracteur de données immobilières. Analyse ce contenu d'annonce immobilière française et retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication).

${jsonLd ? `Données structurées JSON-LD trouvées : ${JSON.stringify(jsonLd).slice(0, 2000)}\n\n` : ""}Texte de la page :
${text}

Retourne ce JSON :
{
  "titre": "titre exact de l'annonce",
  "ville": "nom de la ville (ex: Bordeaux)",
  "cp": "code postal 5 chiffres",
  "type": "Maison" ou "Appartement",
  "surface": nombre entier en m²,
  "terrain": nombre entier en m² (0 si pas de terrain),
  "prix": nombre entier en euros (0 si inconnu),
  "nb_pieces": nombre entier (0 si inconnu),
  "description": "texte complet de la description, max 800 caractères",
  "adresse_indicative": "adresse ou quartier si mentionné, sinon vide",
  "indices_localisation": "tout indice de localisation : rue, quartier, proximité école/commerces/gare"
}`;

  try {
    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!cr.ok) return NextResponse.json({ error: "Claude extraction échouée" }, { status: 500 });
    const cd = await cr.json();
    const raw = (cd.content?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const extracted = JSON.parse(raw);
    return NextResponse.json({ ...extracted, photos: imgUrls });
  } catch {
    return NextResponse.json({ error: "Extraction échouée — le site est peut-être trop protégé" }, { status: 422 });
  }
}
