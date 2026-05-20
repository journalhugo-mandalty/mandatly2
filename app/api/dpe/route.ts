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

    const url =
      `https://data.ademe.fr/data-fair/api/v1/datasets/${DATASET}/lines` +
      `?size=100&${qParam}` +
      `&sort=date_reception_dpe:-1` +
      `&select=adresse_ban,etiquette_dpe,date_reception_dpe,_geopoint,surface_habitable_logement,nom_commune_ban`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
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

        // DPE F/G récent = signal de vente fort (contrainte loi Climat)
        const sClasse = ["F", "G"].includes(classe) ? 40 : ["D", "E"].includes(classe) ? 20 : 10;
        const sRecence = ageJours < 60 ? 40 : ageJours < 180 ? 30 : ageJours < 365 ? 20 : 10;
        const score = Math.min(100, sClasse + sRecence + 10);

        const adresse = d.adresse_ban || "Adresse inconnue";
        const rawId = adresse.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);

        return {
          id: `dpe-${rawId}`,
          adresse,
          ville: d.nom_commune_ban || commune,
          score,
          source: "DPE",
          status: score >= 65 ? "À contacter" : "À surveiller",
          notes: `DPE ${classe} · ${dateReception.toLocaleDateString("fr-FR")} · ${d.surface_habitable_logement || "?"}m²`,
          lat: dpeLat,
          lng: dpeLng,
          classe_dpe: classe,
          date_dpe: d.date_reception_dpe,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 60);

    return NextResponse.json({ prospects, total: prospects.length });
  } catch (e: any) {
    return NextResponse.json({ prospects: [], total: 0, error: e.message });
  }
}
