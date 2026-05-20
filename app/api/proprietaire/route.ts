import { NextRequest, NextResponse } from "next/server";

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
  let proprietaire_nom = "";
  let civilite = "";
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
        nom: dg.nom,
        prenoms: dg.prenoms,
      })),
    }));

    // Priority: SCI or company with dirigeant
    const sci = results.find((e: any) => {
      const nom = (e.nom_complet || e.nom_raison_sociale || "").toUpperCase();
      return nom.includes("SCI") || nom.includes("SARL") || nom.includes("SAS") || nom.includes("SASU");
    });

    const target = sci || results[0];
    if (target) {
      const dirigeants: any[] = target.dirigeants || [];
      if (dirigeants.length > 0) {
        const dg = dirigeants[0];
        const prenom = (dg.prenoms || "").split(" ")[0] || "";
        proprietaire_nom = [dg.nom, prenom].filter(Boolean).join(" ");
        civilite = prenom ? "M." : "";
        proprietaire_source = sci ? "sci+dirigeant" : "sirene+dirigeant";
      } else {
        proprietaire_nom = target.nom_complet || target.nom_raison_sociale || "";
        civilite = "";
        proprietaire_source = sci ? "sci" : "sirene";
      }
    }
  }

  // Fallback to cadastre signal if Sirene gave nothing
  if (!proprietaire_nom && parcelles.length > 0) {
    proprietaire_source = "cadastre";
  }

  const deepLink = parcelles[0]
    ? `https://www.cadastre.gouv.fr/cadastre/publicDisplay?f=1&codeDep=${parcelles[0].code_insee?.slice(0,2)}&codeDir=${parcelles[0].code_insee?.slice(0,2)}&codeCommune=${parcelles[0].code_insee}&section=${parcelles[0].section}&numero=${parcelles[0].numero}`
    : null;

  return NextResponse.json({ parcelles, entreprises, deepLink, proprietaire_nom, civilite, proprietaire_source });
}
