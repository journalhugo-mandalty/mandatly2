import { NextRequest, NextResponse } from "next/server";

function extractProprios(rawProprios: any[]) {
  const proprietaires: Array<{ nom: string; type: "particulier"|"societe"; siren?: string }> = [];
  for (const rp of rawProprios) {
    const pps: any[] = rp.personnes_physiques || [];
    if (pps.length > 0) {
      for (const pp of pps) {
        const nom = pp.nom_complet || [pp.prenoms, pp.nom_usage || pp.nom_patronymique].filter(Boolean).join(" ").trim();
        if (nom) proprietaires.push({ nom, type: "particulier" });
      }
    } else if (rp.nom_entreprise) {
      proprietaires.push({ nom: rp.nom_entreprise, type: "societe", siren: rp.siren || undefined });
    }
  }
  return proprietaires;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.PAPPERS_IMMO_API_KEY || "";
  if (!apiKey) return NextResponse.json({ error: "PAPPERS_IMMO_API_KEY manquante" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  if (!lat || !lng) return NextResponse.json({ error: "lat et lng requis" }, { status: 400 });

  try {
    const bases = "proprietaires,ventes,batiments,dpe,occupants,permis,coproprietes";
    const extras = "proprietaires.personnes_physiques";
    const url = `https://api-immobilier.pappers.fr/v1/parcelles?latitude=${lat}&longitude=${lng}&distance=20&bases=${bases}&champs_supplementaires=${extras}&par_page=1`;
    const r = await fetch(url, {
      headers: { "api-key": apiKey },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return NextResponse.json({ error: `Pappers erreur ${r.status}` }, { status: r.status });
    const data = await r.json();
    const p = data.resultats?.[0] ?? data;
    if (!p) return NextResponse.json({ error: "Aucune parcelle trouvée" }, { status: 404 });

    const proprietaires = extractProprios(p.proprietaires || []);

    const ventes = (p.ventes || [])
      .filter((v: any) => v.prix_vente > 0)
      .sort((a: any, b: any) => (b.date_vente || "").localeCompare(a.date_vente || ""))
      .slice(0, 5)
      .map((v: any) => ({
        date: v.date_vente_formatee || v.date_vente || "",
        prix: v.prix_vente || 0,
        type: v.nature_mutation || "",
        surface_bati: v.surface_bati || undefined,
        surface_terrain: v.surface_terrain || undefined,
      }));

    const batiments = (p.batiments || []).slice(0, 3).map((b: any) => ({
      surface: b.surface || undefined,
      annee_construction: b.annee_construction || undefined,
      nature: b.nature_batiment || undefined,
      usage: b.usage_batiment || undefined,
    }));

    const dpe = (p.dpe || []).slice(0, 2).map((d: any) => ({
      classe_bilan: d.classe_bilan_dpe || d.classe_bilan || "",
      classe_ges: d.classe_ges_dpe || d.classe_ges || undefined,
      date: d.date_etablissement_dpe_formatee || undefined,
    }));

    const permis = (p.permis || []).slice(0, 3).map((pm: any) => ({
      statut: pm.statut_permis || "",
      date: pm.date_autorisation_permis_formatee || undefined,
      nature: pm.nature_permis || undefined,
    }));

    const coproprietes = (p.coproprietes || []).slice(0, 2).map((c: any) => ({
      nom: c.nom_copropriete || undefined,
      nb_lots: c.nombre_lots || undefined,
    }));

    return NextResponse.json({
      proprietaires,
      ventes,
      batiments,
      dpe,
      permis,
      coproprietes,
      contenance: p.contenance || null,
      adresse: p.adresse || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
