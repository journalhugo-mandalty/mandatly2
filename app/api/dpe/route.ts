import { NextRequest, NextResponse } from "next/server";

// Proxy ADEME DPE API — recent DPEs are strong selling signals
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const commune = searchParams.get("commune") || "";
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!commune && (!lat || !lng)) {
    return NextResponse.json({ error: "commune ou lat/lng requis" }, { status: 400 });
  }

  try {
    // Query DPE by commune name — recent DPEs (< 12 months) = imminent sale signal
    const qs = commune
      ? `commune_(Brut):"${commune.toUpperCase()}"`
      : "";
    const geoFilter = lat && lng ? `&geo_distance_filter=${lat},${lng},3000` : "";
    const qsParam = qs ? `&qs=${encodeURIComponent(qs)}` : "";

    const url = `https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines?size=100${qsParam}${geoFilter}&select=N°DPE,adresse_ban,date_réception_DPE,etiquette_DPE,type_bâtiment,surface_habitable_logement,coordonnée_ban&sort=date_réception_DPE:-1`;

    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ prospects: [], total: 0 });
    }

    const data = await res.json();
    const results: any[] = data.results || [];

    const now = new Date();
    const prospects = results
      .filter((d: any) => d.coordonnée_ban && d.date_réception_DPE)
      .map((d: any) => {
        const coords = String(d.coordonnée_ban).split(",");
        const dpeLat = parseFloat(coords[0]);
        const dpeLng = parseFloat(coords[1]);
        if (!dpeLat || !dpeLng) return null;

        const dateReception = new Date(d.date_réception_DPE);
        const ageJours = Math.floor((now.getTime() - dateReception.getTime()) / (1000 * 60 * 60 * 24));

        // DPE scoring: recent + bad class = strong sell signal
        const classe = d.etiquette_DPE || "D";
        const sClasse = ["F","G"].includes(classe) ? 35 : ["D","E"].includes(classe) ? 20 : 10;
        const sRecence = ageJours < 60 ? 40 : ageJours < 180 ? 30 : ageJours < 365 ? 20 : 10;
        const score = Math.min(100, sClasse + sRecence + 15);

        const adresse = d.adresse_ban || "Adresse inconnue";
        const rawId = adresse.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);

        return {
          id: `dpe-${rawId}`,
          adresse,
          ville: commune,
          score,
          source: "DPE",
          status: score >= 65 ? "À contacter" : "À surveiller",
          notes: `DPE ${classe} · reçu le ${dateReception.toLocaleDateString("fr-FR")} · ${d.surface_habitable_logement || "?"}m²`,
          lat: dpeLat,
          lng: dpeLng,
          classe_dpe: classe,
          date_dpe: d.date_réception_DPE,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 50);

    return NextResponse.json({ prospects, total: prospects.length });
  } catch (e: any) {
    return NextResponse.json({ prospects: [], total: 0, error: e.message });
  }
}
