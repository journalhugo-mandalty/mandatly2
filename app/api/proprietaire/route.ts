import { NextRequest, NextResponse } from "next/server";

function cleanName(nom: string, prenoms: string): string {
  const n = (nom || "").replace(/\s*\([^)]+\)/g, "").trim();
  const p = (prenoms || "").split(" ")[0] || "";
  return [n, p].filter(Boolean).join(" ");
}

// Inline vision logic — avoids HTTP call between serverless functions
async function tryVision(lat: string, lng: string): Promise<string | null> {
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!googleKey || !anthropicKey) return null;

  try {
    const meta = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${googleKey}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!meta.ok) return null;
    const md = await meta.json();
    if (md.status !== "OK") return null;

    const imgRes = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&key=${googleKey}&fov=90&pitch=0`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!imgRes.ok) return null;
    const ct = imgRes.headers.get("content-type") || "image/jpeg";
    if (!ct.includes("image")) return null;

    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mediaType = ct.includes("png") ? "image/png" : "image/jpeg";

    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 80,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Vue de rue en France. Nom visible sur boîte aux lettres, interphone, portail ou plaque ? Si oui réponds UNIQUEMENT avec le nom (ex: DUPONT, Famille MARTIN, SCI LES ACACIAS). Sinon: AUCUN." }
          ]
        }]
      }),
    });
    if (!cr.ok) return null;
    const cd = await cr.json();
    const text = (cd.content?.[0]?.text || "").trim();
    if (!text || text === "AUCUN" || text.length < 2 || text.length > 80) return null;
    return text;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const adresse = searchParams.get("adresse") || "";

  if (!lat || !lng) return NextResponse.json({ error: "lat/lng requis" }, { status: 400 });

  // Sirene + Cadastre in parallel
  const [cadastreRes, sireneRes] = await Promise.allSettled([
    fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng}&lat=${lat}&_limit=3`, {
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(adresse)}&size=8`, {
      signal: AbortSignal.timeout(6000),
    }),
  ]);

  let parcelles: any[] = [];
  if (cadastreRes.status === "fulfilled" && cadastreRes.value.ok) {
    const d = await cadastreRes.value.json();
    parcelles = (d.features || []).map((f: any) => ({
      section: f.properties?.section,
      numero: f.properties?.numero,
      contenance: f.properties?.contenance,
      code_insee: f.properties?.code_insee,
    }));
  }

  let entreprises: any[] = [];
  let proprietaire_nom = "";
  let proprietaire_source = "inconnu";

  if (sireneRes.status === "fulfilled" && sireneRes.value.ok) {
    const d = await sireneRes.value.json();
    const results: any[] = d.results || [];

    entreprises = results.slice(0, 3).map((e: any) => ({
      nom: e.nom_complet || e.nom_raison_sociale,
      siren: e.siren,
      adresse: e.siege?.adresse,
      activite: e.siege?.activite_principale,
      ouvert: (e.nombre_etablissements_ouverts || 0) > 0,
      dirigeants: (e.dirigeants || []).slice(0, 2).map((dg: any) => ({
        nom: dg.nom, prenoms: dg.prenoms,
      })),
    }));

    // Priority: SCI/SARL/foncière > first result
    const sci = results.find(e => {
      const n = (e.nom_complet || e.nom_raison_sociale || "").toUpperCase();
      return n.includes("SCI") || n.includes("SARL") || n.includes("SAS") || n.includes("SASU") || n.includes("FONCIERE") || n.includes("IMMOB");
    });

    const target = sci || results[0];
    if (target) {
      const dgs: any[] = target.dirigeants || [];
      if (dgs.length > 0) {
        proprietaire_nom = cleanName(dgs[0].nom, dgs[0].prenoms);
        proprietaire_source = sci ? "sci+dirigeant" : "sirene+dirigeant";
      } else {
        proprietaire_nom = (target.nom_complet || target.nom_raison_sociale || "").split("(")[0].trim();
        proprietaire_source = sci ? "sci" : "sirene";
      }
    }
  }

  // Fallback: Street View + Claude Vision (inline, no HTTP hop)
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  if (!proprietaire_nom && googleKey) {
    const visionName = await tryVision(lat, lng);
    if (visionName) {
      proprietaire_nom = visionName;
      proprietaire_source = "vision-ia";
    }
  }

  if (!proprietaire_nom && parcelles.length > 0) proprietaire_source = "cadastre";

  const deepLink = parcelles[0]
    ? `https://www.cadastre.gouv.fr/cadastre/publicDisplay?f=1&codeDep=${parcelles[0].code_insee?.slice(0,2)}&codeDir=${parcelles[0].code_insee?.slice(0,2)}&codeCommune=${parcelles[0].code_insee}&section=${parcelles[0].section}&numero=${parcelles[0].numero}`
    : null;

  return NextResponse.json({
    parcelles, entreprises, deepLink,
    proprietaire_nom, proprietaire_source,
    vision_enabled: !!googleKey,
  });
}
