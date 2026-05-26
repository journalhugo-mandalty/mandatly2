import { NextRequest, NextResponse } from "next/server";

// Dataset mis à jour juillet 2021 → ID correct
const DATASET = "meg-83tjwtg8dyz4vv7h1dqe";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const commune = searchParams.get("commune") || "";
  const insee = searchParams.get("insee") || "";
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!commune && !insee) {
    return NextResponse.json({ error: "commune ou insee requis" }, { status: 400 });
  }

  try {
    // Prefer INSEE code for exact match; fall back to commune name
    const qParam = insee
      ? `q_fields=code_insee_ban&q=${encodeURIComponent(insee)}`
      : `q_fields=nom_commune_ban&q=${encodeURIComponent(commune.toUpperCase())}`;

    // Fetch 200 most recent DPEs — recency is the primary signal
    const url =
      `https://data.ademe.fr/data-fair/api/v1/datasets/${DATASET}/lines` +
      `?size=200&${qParam}` +
      `&sort=-date_reception_dpe` +
      `&select=adresse_ban,etiquette_dpe,etiquette_ges,date_reception_dpe,_geopoint,surface_habitable_logement,nom_commune_ban,code_insee_ban,type_batiment,nom_residence`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json({ prospects: [], total: 0 });
    }

    const data = await res.json();
    const results: any[] = data.results || [];

    const now = new Date();
    const prospects = results
      .filter((d: any) => d._geopoint && d.date_reception_dpe)
      .map((d: any) => {
        const parts = String(d._geopoint).split(",");
        const dpeLat = parseFloat(parts[0]);
        const dpeLng = parseFloat(parts[1]);
        if (isNaN(dpeLat) || isNaN(dpeLng)) return null;

        const dateReception = new Date(d.date_reception_dpe);
        const ageJours = Math.floor((now.getTime() - dateReception.getTime()) / (1000 * 60 * 60 * 24));
        const classe = d.etiquette_dpe || "D";

        // RECENCE = signal principal : un DPE récent = vente imminente (DPE obligatoire avant vente)
        // < 30j : quasi certain en vente prochainement
        // < 90j : très probable
        // < 180j : probable (6 mois = fenêtre de mise en vente)
        // > 1 an : signal faible, sauf si F/G (obligation légale)
        const sRecence = ageJours < 30 ? 60 : ageJours < 90 ? 52 : ageJours < 180 ? 42 : ageJours < 365 ? 18 : 5;

        // CLASSE = signal secondaire : F/G = obligation de rénover ou vendre (loi Climat 2025-2028)
        const sClasse = classe === "G" ? 30 : classe === "F" ? 25 : classe === "E" ? 10 : 5;

        const score = Math.min(100, sRecence + sClasse);

        // Exclure les DPE trop anciens sans obligation légale (> 1 an et classe A/B/C/D)
        if (ageJours > 365 && !["F","G"].includes(classe)) return null;

        const adresse = d.adresse_ban || "Adresse inconnue";
        const rawId = (adresse + d.date_reception_dpe).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);

        const signalLabel = ageJours < 30 ? "Vente imminente" : ageJours < 90 ? "Vente très probable" : ageJours < 180 ? "Vente probable" : (classe === "G" || classe === "F") ? "Obligation légale" : "";
        const ageLabel = ageJours < 7 ? `il y a ${ageJours}j` : ageJours < 30 ? `il y a ${ageJours}j` : ageJours < 60 ? `il y a ${Math.round(ageJours/7)} sem.` : ageJours < 365 ? `il y a ${Math.round(ageJours/30)} mois` : `${dateReception.toLocaleDateString("fr-FR")}`;

        return {
          id: `dpe-${rawId}`,
          adresse,
          ville: d.nom_commune_ban || commune,
          score,
          source: "DPE",
          status: score >= 60 ? "À contacter" : "À surveiller",
          notes: `DPE ${classe} · ${ageLabel}${signalLabel ? " · " + signalLabel : ""} · ${d.surface_habitable_logement || "?"}m²${d.type_batiment ? " · " + d.type_batiment : ""}`,
          lat: dpeLat,
          lng: dpeLng,
          classe_dpe: classe,
          date_dpe: d.date_reception_dpe,
          age_jours: ageJours,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 80);

    return NextResponse.json({ prospects, total: prospects.length });
  } catch (e: any) {
    return NextResponse.json({ prospects: [], total: 0, error: e.message });
  }
}
