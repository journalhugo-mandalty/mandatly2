import { NextRequest, NextResponse } from "next/server";

// Enrichment chain priority:
// 1. Sirene — SCI/company registered at this address → dirigeant
// 2. Vision IA — Street View + Claude reads letterbox (if GOOGLE_STREETVIEW_KEY set)
// 3. Cadastre IGN — parcel data (always, for context)

function cleanName(nom: string, prenoms: string): string {
  const n = (nom || "").replace(/\s*\([^)]+\)/g, "").trim();
  const p = (prenoms || "").split(" ")[0] || "";
  return [n, p].filter(Boolean).join(" ");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const adresse = searchParams.get("adresse") || "";

  if (!lat || !lng) return NextResponse.json({ error: "lat/lng requis" }, { status: 400 });

  // Run Cadastre + Sirene in parallel
  const [cadastreRes, sireneRes] = await Promise.allSettled([
    fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng}&lat=${lat}&_limit=3`, {
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(adresse)}&size=8`, {
      signal: AbortSignal.timeout(6000),
    }),
  ]);

  // Parse cadastre
  let parcelles: any[] = [];
  if (cadastreRes.status === "fulfilled" && cadastreRes.value.ok) {
    const d = await cadastreRes.value.json();
    parcelles = (d.features || []).map((f: any) => ({
      section: f.properties?.section,
      numero: f.properties?.numero,
      contenance: f.properties?.contenance,
      code_insee: f.properties?.code_insee,
      prefixe: f.properties?.prefixe,
    }));
  }

  // Parse Sirene
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

    // Priority order: SCI > SARL/SAS (likely property holders) > first result
    const sci = results.find(e => {
      const n = (e.nom_complet || e.nom_raison_sociale || "").toUpperCase();
      return n.includes("SCI") || n.includes("SARL") || n.includes("SAS") || n.includes("SASU") || n.includes("FONCIERE");
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

  // Fallback: Street View + Claude Vision (if key is set and no name found yet)
  let visionNom = "";
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  if (!proprietaire_nom && googleKey) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const visionRes = await fetch(`${baseUrl}/api/vision?lat=${lat}&lng=${lng}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (visionRes.ok) {
        const vd = await visionRes.json();
        if (vd.nom) { visionNom = vd.nom; proprietaire_source = "vision-ia"; }
      }
    } catch {}
  }

  if (!proprietaire_nom && visionNom) proprietaire_nom = visionNom;
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
