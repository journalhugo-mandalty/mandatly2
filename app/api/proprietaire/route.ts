import { NextRequest, NextResponse } from "next/server";

// Combine IGN Cadastre + Sirene to identify property owner signals
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const adresse = searchParams.get("adresse") || "";

  if (!lat || !lng) return NextResponse.json({ error: "lat/lng requis" }, { status: 400 });

  const [cadastreRes, sireneRes] = await Promise.allSettled([
    fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng}&lat=${lat}&_limit=3`, {
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(adresse)}&size=5`, {
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
      prefixe: f.properties?.prefixe,
    }));
  }

  let entreprises: any[] = [];
  if (sireneRes.status === "fulfilled" && sireneRes.value.ok) {
    const d = await sireneRes.value.json();
    entreprises = (d.results || []).slice(0, 3).map((e: any) => ({
      nom: e.nom_complet || e.nom_raison_sociale,
      siren: e.siren,
      adresse: e.siege?.adresse,
      activite: e.siege?.activite_principale,
      ouvert: (e.nombre_etablissements_ouverts || 0) > 0,
    }));
  }

  // Generate cadastre.gouv.fr deep link if we have parcelle data
  const deepLink = parcelles[0]
    ? `https://www.cadastre.gouv.fr/cadastre/publicDisplay?f=1&codeDep=${parcelles[0].code_insee?.slice(0,2)}&codeDir=${parcelles[0].code_insee?.slice(0,2)}&codeCommune=${parcelles[0].code_insee}&section=${parcelles[0].section}&numero=${parcelles[0].numero}`
    : null;

  return NextResponse.json({ parcelles, entreprises, deepLink });
}
