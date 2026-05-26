import { NextRequest, NextResponse } from "next/server";

// CSV column indices (verified from geo-dvf header)
const COL = {
  date: 1, nature: 3, valeur: 4, num: 5, voie: 7,
  commune: 11, type_local: 30, surface: 31,
  pieces: 32, terrain: 37, lng: 38, lat: 39,
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
      nombre_pieces: parseFloat(c[COL.pieces]) || 0,
      surface_terrain: parseFloat(c[COL.terrain]) || 0,
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
  // Geo-estimation params (passed from frontend after geocoding)
  const addressLat = parseFloat(searchParams.get("address_lat") || "");
  const addressLng = parseFloat(searchParams.get("address_lng") || "");
  const inseeParam = searchParams.get("insee") || "";
  const deptParam = searchParams.get("dept") || "";

  try {
    let lat: number, lng: number, nomVille: string, inseeCode: string, dept: string;

    // If insee+dept provided directly (geo-estimation), skip BAN geocoding
    if (inseeParam && deptParam && !isNaN(addressLat) && !isNaN(addressLng)) {
      lat = addressLat;
      lng = addressLng;
      inseeCode = inseeParam;
      dept = deptParam;
      nomVille = ville || inseeParam;
    } else {
      const banRes = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ville)}&type=municipality&limit=1`
      );
      const banData = await banRes.json();
      if (!banData.features?.length) {
        return NextResponse.json({ error: "Ville introuvable" }, { status: 404 });
      }
      [lng, lat] = banData.features[0].geometry.coordinates;
      nomVille = banData.features[0].properties.city || ville;
      inseeCode = banData.features[0].properties.citycode || "";
      dept = inseeCode.slice(0, inseeCode.length === 5 ? 2 : 3);
    }

    if (!inseeCode) {
      return NextResponse.json({ error: "Code INSEE introuvable" }, { status: 404 });
    }

    // geo-dvf/latest contient uniquement 2021-2025 (années antérieures vides)
    // → on itère du plus ancien (meilleur signal vendeur) au plus récent
    const curYear = new Date().getFullYear();
    const years = [2021, 2022, 2023, 2024, 2025].filter(y => y <= curYear);

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

    // Estimation mode: geo-filtered comparables
    if (mode === "estimation") {
      const cutoff = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
      const hasGeo = !isNaN(addressLat) && !isNaN(addressLng);

      // Base filter: type + surface ±50% + recent
      let comps = allTx
        .filter(t =>
          t.type_local === typeEst &&
          t.surface_reelle_bati > 0 &&
          t.valeur_fonciere > 0 &&
          t.surface_reelle_bati >= surfaceEst * 0.5 &&
          t.surface_reelle_bati <= surfaceEst * 1.8 &&
          new Date(t.date_mutation) >= cutoff
        )
        .map(t => ({
          ...t,
          distance_m: hasGeo
            ? Math.round(haversineKm(addressLat, addressLng, t.latitude, t.longitude) * 1000)
            : null,
        }));

      let rayonKm = 0;

      if (hasGeo) {
        // Expand radius progressively until ≥ 5 comparables
        for (const km of [0.8, 1.5, 3, 5, 10]) {
          const near = comps.filter(t => (t.distance_m ?? 99999) <= km * 1000);
          if (near.length >= 5 || km === 10) {
            comps = near;
            rayonKm = km;
            break;
          }
        }
        // Sort by distance (nearest first)
        comps.sort((a, b) => (a.distance_m ?? 99999) - (b.distance_m ?? 99999));
      }

      return NextResponse.json({
        transactions: comps.slice(0, 60),
        lat: String(lat), lng: String(lng), ville: nomVille,
        rayon_km: rayonKm,
        total_commune: allTx.length,
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
      const terrain = t.surface_terrain || 0;
      const pieces = t.nombre_pieces || 0;
      // Exclure les transactions commerciales déguisées (prix/m² irréaliste ou valeur trop élevée)
      if (prixM2 > 20000 || valeur > 4000000) continue;
      const isMaison = t.type_local === "Maison";

      const notesParts = [`Acquis ${annee}`, `${surface||"?"}m²`];
      if (pieces > 0) notesParts.push(`${pieces}p`);
      if (isMaison && terrain > 0) notesParts.push(`terrain ${terrain}m²`);
      if (prixM2 > 0) notesParts.push(`${prixM2.toLocaleString("fr-FR")}€/m²`);

      // Ancienneté = multiplicateur principal (données dispo 2021-2025 uniquement)
      // Plus ancien = meilleur signal vendeur dans la fenêtre disponible
      const anciennete = currentYear - annee;
      const ancBonus = anciennete >= 5 ? 2.2   // 2021 — sweet spot dispo
        : anciennete === 4 ? 1.7               // 2022 — bon signal
        : anciennete === 3 ? 1.0               // 2023 — passable
        : anciennete === 2 ? 0.35              // 2024 — peu probable
        : 0.06;                                // 2025 — vient d'acheter
      const rawSignal = (valeur * 0.5 + surface * 800 + prixM2 * 60 + (isMaison ? 80000 : 0)) * ancBonus;
      const rawId = `${t.adresse_numero}${t.adresse_nom_voie}${t.date_mutation?.slice(0,7)||""}`;

      raw.push({
        id: "dvf-" + rawId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24),
        adresse,
        ville: t.nom_commune || nomVille,
        source: "DVF",
        notes: notesParts.join(" · "),
        lat: t.latitude,
        lng: t.longitude,
        anciennete,
        prix_achat: valeur,
        type_local: t.type_local,
        surface,
        terrain,
        pieces,
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
