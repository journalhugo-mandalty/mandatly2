import { NextRequest, NextResponse } from "next/server";

// CSV column indices (verified from geo-dvf header)
const COL = {
  date: 1, nature: 3, valeur: 4, num: 5, voie: 7,
  commune: 11, type_local: 30, surface: 31,
  lng: 38, lat: 39,
};

function parseCSV(text: string): any[] {
  const lines = text.split("\n");
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const c = line.split(",");
    if (c.length < 40) continue;
    const type = c[COL.type_local];
    if (type !== "Maison" && type !== "Appartement") continue;
    const lat = parseFloat(c[COL.lat]);
    const lng = parseFloat(c[COL.lng]);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;
    const valeur = parseFloat(c[COL.valeur]);
    if (!valeur || valeur < 20000) continue;
    rows.push({
      date_mutation: c[COL.date] || "",
      valeur_fonciere: valeur,
      adresse_numero: c[COL.num] || "",
      adresse_nom_voie: c[COL.voie] || "",
      nom_commune: c[COL.commune] || "",
      type_local: type,
      surface_reelle_bati: parseFloat(c[COL.surface]) || 0,
      longitude: lng,
      latitude: lat,
    });
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ville = searchParams.get("ville") || "";
  const mode = searchParams.get("mode") || "prospects";
  const typeEst = searchParams.get("type") || "Maison";
  const surfaceEst = parseFloat(searchParams.get("surface") || "100");

  try {
    const banRes = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ville)}&type=municipality&limit=1`
    );
    const banData = await banRes.json();
    if (!banData.features?.length) {
      return NextResponse.json({ error: "Ville introuvable" }, { status: 404 });
    }
    const [lng, lat] = banData.features[0].geometry.coordinates;
    const nomVille = banData.features[0].properties.city || ville;
    const inseeCode: string = banData.features[0].properties.citycode || "";
    const dept = inseeCode.slice(0, inseeCode.length === 5 ? 2 : 3);

    if (!inseeCode) {
      return NextResponse.json({ error: "Code INSEE introuvable" }, { status: 404 });
    }

    // Fetch CSVs — sweet spot first (7-15 ans = mûrs pour revendre), puis années récentes
    const curYear = new Date().getFullYear();
    // Sweet spot: acheté il y a 7-16 ans (geo-dvf commence en 2014)
    const sweetYears: number[] = [];
    for (let y = curYear - 7; y >= Math.max(2014, curYear - 16); y--) sweetYears.push(y);
    // Années récentes en fallback (signal DPE/contrainte loi Climat)
    const recentYears: number[] = [];
    for (let y = curYear; y > curYear - 7; y--) recentYears.push(y);
    const years = [...sweetYears, ...recentYears];

    let allTx: any[] = [];
    for (const year of years) {
      try {
        const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dept}/${inseeCode}.csv`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const text = await res.text();
        const rows = parseCSV(text);
        allTx.push(...rows);
        if (allTx.length >= 600 && mode === "prospects") break;
      } catch {}
    }

    // Estimation mode: return raw comparables
    if (mode === "estimation") {
      const cutoff = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000);
      const comps = allTx.filter(
        (t) =>
          t.type_local === typeEst &&
          t.surface_reelle_bati > 0 &&
          t.valeur_fonciere > 0 &&
          t.surface_reelle_bati >= surfaceEst * 0.5 &&
          t.surface_reelle_bati <= surfaceEst * 1.6 &&
          new Date(t.date_mutation) >= cutoff
      );
      return NextResponse.json({
        transactions: comps.slice(0, 60),
        lat: String(lat), lng: String(lng), ville: nomVille,
      });
    }

    // Prospects mode: dedup + collect raw data
    const seen = new Set<string>();
    const raw: any[] = [];
    const currentYear = new Date().getFullYear();

    for (const t of allTx) {
      const adresse = `${t.adresse_numero} ${t.adresse_nom_voie}`.trim() || "Adresse inconnue";
      const key = adresse.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key) || key.length < 3) continue;
      seen.add(key);

      const annee = parseInt(t.date_mutation?.slice(0, 4)) || currentYear;
      const surface = t.surface_reelle_bati || 0;
      const valeur = t.valeur_fonciere || 0;
      const prixM2 = surface > 0 ? Math.round(valeur / surface) : 0;
      // Exclure les transactions commerciales déguisées (prix/m² irréaliste ou valeur trop élevée)
      if (prixM2 > 20000 || valeur > 4000000) continue;
      const isMaison = t.type_local === "Maison";

      // Raw signal: composite of value signals for percentile scoring
      const rawSignal = valeur * 0.5 + surface * 800 + prixM2 * 60 + (isMaison ? 80000 : 0);
      const rawId = `${t.adresse_numero}${t.adresse_nom_voie}${t.date_mutation?.slice(0,7)||""}`;

      raw.push({
        id: "dvf-" + rawId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24),
        adresse,
        ville: t.nom_commune || nomVille,
        source: "DVF",
        notes: `Acquis ${annee} · ${surface||"?"}m²${prixM2>0?" · "+prixM2.toLocaleString("fr-FR")+"€/m²":""} · ${Math.round(valeur/1000)}k€`,
        lat: t.latitude,
        lng: t.longitude,
        anciennete: currentYear - annee,
        prix_achat: valeur,
        _signal: rawSignal,
      });
    }

    // Percentile scoring within the top 200 → scores spread 40-98
    raw.sort((a, b) => b._signal - a._signal);
    const slice200 = raw.slice(0, 200);
    const nSlice = slice200.length;
    const prospects = slice200.map((p, i) => {
      const percentile = nSlice > 1 ? 1 - i / (nSlice - 1) : 1;
      const score = Math.round(40 + percentile * 58); // range 40-98
      return { ...p, score, status: score >= 70 ? "À contacter" : "À surveiller", _signal: undefined };
    });

    const sorted = prospects.sort((a, b) => b.score - a.score).slice(0, 200);
    return NextResponse.json({
      prospects: sorted,
      total: sorted.length,
      lat: String(lat), lng: String(lng),
      ville: nomVille, insee: inseeCode,
      source_reelle: allTx.length > 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
