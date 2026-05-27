import { NextRequest, NextResponse } from "next/server";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getIGNParcels(lat: number, lng: number): Promise<any[]> {
  const d = 0.006; // ~600m
  const bbox = {
    type: "Polygon",
    coordinates: [[[lng-d,lat-d],[lng+d,lat-d],[lng+d,lat+d],[lng-d,lat+d],[lng-d,lat-d]]]
  };
  try {
    const res = await fetch(
      `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify(bbox))}&_limit=80`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.features || [];
  } catch { return []; }
}

function getRing(feature: any): number[][] {
  const geom = feature.geometry;
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates?.[0] ?? [];
  if (geom.type === "MultiPolygon") return geom.coordinates?.[0]?.[0] ?? [];
  return [];
}

function parcelBbox(feature: any): string | null {
  const ring = getRing(feature);
  if (ring.length < 3) return null;
  const lngs = ring.map((c: number[]) => c[0]);
  const lats = ring.map((c: number[]) => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  // Padding minimum ~120m pour avoir un contexte visuel exploitable
  const padLng = Math.max((maxLng - minLng) * 0.4, 0.0010);
  const padLat = Math.max((maxLat - minLat) * 0.4, 0.0007);
  return `${minLng-padLng},${minLat-padLat},${maxLng+padLng},${maxLat+padLat}`;
}

function parcelCenter(feature: any): [number,number] | null {
  const ring = getRing(feature);
  if (ring.length < 3) return null;
  const lngs = ring.map((c: number[]) => c[0]);
  const lats = ring.map((c: number[]) => c[1]);
  return [
    (Math.min(...lats)+Math.max(...lats))/2,
    (Math.min(...lngs)+Math.max(...lngs))/2
  ];
}

async function getIGNAerial(bbox: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/jpeg&STYLES=&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&CRS=CRS:84&BBOX=${bbox}&WIDTH=320&HEIGHT=320`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 8000) return null;
    return Buffer.from(buf).toString("base64");
  } catch { return null; }
}

async function fetchPhotoB64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Mandatly/1.0)" }
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 15000) return null; // rejeter images trop petites / erreurs HTML
    return Buffer.from(buf).toString("base64");
  } catch { return null; }
}

function extractLocalityKeyword(adresse: string): string | null {
  // "154 Route de Collebasse 83350 Ramatuelle" → "Collebasse"
  // "L'Oumède Nord 83350 Ramatuelle"           → "Oumede"
  // "10 Avenue des Girelles 83350 Ramatuelle"  → "Girelles"
  const GENERIC = /^(NORD|SUD|EST|OUEST|HAUT|BAS|GRAND|PETIT|VIEUX|VIEILLE|DE|DU|DES|D|L|LA|LES|LE|EN|AU|AUX|ET|SAINT|SAINTE|STE|ST)$/i;
  const STREET_TYPES = /^(RUE|AVENUE|AVE|AV|COURS|CRS|ALLEE|ALL|BOULEVARD|BD|IMPASSE|IMP|CHEMIN|CHE|ROUTE|RTE|VOIE|PASSAGE|SENTIER|PLACE|PL|LIEU[- ]DIT|LD|HAMEAU|DOMAINE|DOM|LOTISSEMENT|LOT|VILLA|QUARTIER|QUA|DRAILLE|TRAVERSE|TRV|MONTEE|DESCENTE)$/i;
  const words = adresse
    .replace(/\b\d{5}\b.*$/, "")       // remove postal code + everything after
    .replace(/^[\d]+\s*(BIS|TER|QUATER)?\s*/i, "")  // remove street number
    .split(/[\s']+/)                    // split on spaces and apostrophes
    .filter(w => w.length >= 2);
  // Skip street type words and generic words, find first specific word >= 4 chars
  let skip = true;
  for (const w of words) {
    if (skip && (STREET_TYPES.test(w) || GENERIC.test(w))) continue;
    skip = false;
    if (GENERIC.test(w)) continue;  // skip "de", "du", "des" after street type
    if (w.length < 4) continue;
    if (/^\d+$/.test(w)) continue;  // skip pure numbers (years, street numbers)
    // Normalize accents and non-alphanum
    const norm = w.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "");
    if (norm.length >= 4) return norm;
  }
  return null;
}

function pickBestSirene(results: any[]): {nom:string;source:string;entreprise:string} | null {
  // 1. Prefer real estate activity codes (68.x)
  const realEstate = results.find(r => (r.siege?.activite_principale || "").startsWith("68"));
  // 2. Prefer SCI/SARL/foncière by name
  const sci = results.find(r => {
    const n = (r.nom_complet || r.nom_raison_sociale || "").toUpperCase();
    return n.includes("SCI") || n.includes("SARL") || n.includes("SAS") || n.includes("FONCIERE") || n.includes("IMMOB");
  });
  // 3. Any result with dirigeants
  const withDir = results.find(r => (r.dirigeants || []).length > 0);

  for (const target of [realEstate, sci, withDir].filter(Boolean)) {
    if (!target) continue;
    const dgs: any[] = target.dirigeants || [];
    if (dgs.length > 0) {
      const d = dgs[0];
      const nom = [d.nom, d.prenoms].filter(Boolean).join(" ").trim();
      const isRealEstate = (target.siege?.activite_principale || "").startsWith("68");
      return { nom, source: isRealEstate ? "sci+dirigeant" : "sirene+dirigeant", entreprise: target.nom_complet || "" };
    }
    const nomEnt = (target.nom_complet || "").split("(")[0].trim();
    if (nomEnt) return { nom: nomEnt, source: "sci", entreprise: nomEnt };
  }
  return null;
}

async function sireneOwner(_lat: number, _lng: number, adresse: string): Promise<{nom:string;source:string;entreprise:string}|null> {
  try {
    // Pass 1: exact address search (works for urban properties with street number)
    const url1 = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(adresse)}&page=1&per_page=10`;
    const res1 = await fetch(url1, { signal: AbortSignal.timeout(8000) });
    if (res1.ok) {
      const d1 = await res1.json();
      const pick = pickBestSirene(d1.results || []);
      if (pick) return pick;
    }

    // Pass 2: locality keyword + postal code (works for rural/luxury areas with lieu-dit)
    // Extract postal code from address
    const cpMatch = adresse.match(/\b(\d{5})\b/);
    const cp = cpMatch?.[1];
    const keyword = extractLocalityKeyword(adresse);
    if (!keyword || !cp) return null;

    const q2 = `${keyword} ${cp}`;
    const url2 = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q2)}&page=1&per_page=10`;
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
    if (!res2.ok) return null;
    const d2 = await res2.json();
    return pickBestSirene(d2.results || []);
  } catch { return null; }
}

async function reverseGeocode(lat: number, lng: number): Promise<string|null> {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    return d.features?.[0]?.properties?.label || null;
  } catch { return null; }
}

// ── DVF cross-match ──────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Agrège les lignes DVF par mutation (une vente = plusieurs lots/parcelles)
function aggregateMutations(text: string): any[] {
  const lines = text.split("\n");
  const mutations = new Map<string, any>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].trim().split(",");
    if (c.length < 40) continue;
    const type = c[30];
    if (type !== "Maison" && type !== "Appartement") continue;
    const mutId = c[0];
    const surface = parseFloat(c[31]) || 0;
    const terrain = parseFloat(c[37]) || 0;
    const lat = parseFloat(c[39]);
    const lng = parseFloat(c[38]);
    if (!mutId) continue;
    if (!mutations.has(mutId)) {
      mutations.set(mutId, { adresse: "", commune: c[11]||"", type_local: type, surface_bati: 0, surface_terrain: 0, lat: 0, lng: 0 });
    }
    const m = mutations.get(mutId);
    if (surface > m.surface_bati) {
      m.surface_bati = surface;
      m.adresse = `${c[5]||""} ${c[7]||""}`.trim();
      if (!isNaN(lat) && lat) { m.lat = lat; m.lng = lng; }
    }
    m.surface_terrain += terrain; // sommer toutes les parcelles
  }
  return Array.from(mutations.values()).filter(m => m.surface_bati > 0);
}

type DvfMatch = { adresse:string; commune:string; lat:number; lng:number; surface_bati:number; surface_terrain:number; confidence:"high"|"medium"; candidates?: DvfMatch[] };

async function dvfCrossMatch(ville: string, cp: string, lat: number, lng: number, surface: number, terrain: number, type: string): Promise<DvfMatch|null> {
  try {
    // Utiliser ville+CP pour trouver l'INSEE (coordonnées Bien'ici = centroïde flou, inutilisable)
    let insee = "", dept = "";
    const q = cp ? `${ville}&postcode=${cp}` : ville;
    const banRes = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&limit=1`, { signal: AbortSignal.timeout(6000) });
    if (banRes.ok) {
      const banData = await banRes.json();
      const feat = banData.features?.[0];
      if (feat) { insee = feat.properties.citycode || ""; dept = insee.slice(0, insee.startsWith("97") ? 3 : 2); }
    }
    // Fallback reverse geocode si pas de résultat
    if (!insee) {
      const rev = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`, { signal: AbortSignal.timeout(6000) });
      if (rev.ok) {
        const rd = await rev.json();
        const f = rd.features?.[0];
        if (f) { insee = f.properties.citycode || ""; dept = insee.slice(0, insee.startsWith("97") ? 3 : 2); }
      }
    }
    if (!insee || !dept) return null;

    // Fetch DVF 2021-2025, agréger par mutation
    const years = [2021, 2022, 2023, 2024, 2025];
    let allMuts: any[] = [];
    const csvResults = await Promise.allSettled(
      years.map(async y => {
        const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${y}/communes/${dept}/${insee}.csv`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        return aggregateMutations(await res.text());
      })
    );
    for (const r of csvResults) if (r.status === "fulfilled") allMuts.push(...r.value);

    const typeMatch = type === "Maison" ? "Maison" : "Appartement";

    // Surface habitable Bien'ici ≈ 75-95% de la surface bâtie DVF → tolérance large
    const sMin = surface * 0.75, sMax = surface * 1.35;
    let pool = allMuts.filter(r => r.type_local === typeMatch && r.surface_bati >= sMin && r.surface_bati <= sMax);

    // Avec terrain : filtre ±30% sur le terrain agrégé
    if (terrain > 100) {
      const tMin = terrain * 0.70, tMax = terrain * 1.40;
      const withT = pool.filter(r => r.surface_terrain >= tMin && r.surface_terrain <= tMax);
      if (withT.length === 1) return { ...withT[0], confidence: "high" };
      if (withT.length >= 2 && withT.length <= 5) {
        return { ...withT[0], confidence: "medium", candidates: withT };
      }
    }

    // Sans terrain ou terrain trop commun : unicité dans la commune
    if (pool.length === 1) return { ...pool[0], confidence: "high" };
    if (pool.length >= 2 && pool.length <= 4) {
      return { ...pool[0], confidence: "medium", candidates: pool };
    }
    return null;
  } catch { return null; }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 503 });

  const body = await req.json();
  const { lat, lng, surface = 100, terrain = 0, type = "Maison", ville = "", cp = "", photos = [] }: {
    lat: number; lng: number; surface: number; terrain: number; type: string; ville: string; cp: string; photos: string[];
  } = body;

  if (!lat || !lng) return NextResponse.json({ error: "lat et lng requis" }, { status: 400 });

  // Lien satellite Géoportail centré sur les coordonnées (utile même si floues)
  const geoportailUrl = `https://www.geoportail.gouv.fr/carte?c=${lng},${lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;

  // ── 0. DVF cross-match (le plus fiable : adresse exacte) ──────────────────
  const dvfMatch = await dvfCrossMatch(ville, cp, lat, lng, surface, terrain, type);
  if (dvfMatch && dvfMatch.confidence === "high") {
    const owner = await sireneOwner(dvfMatch.lat, dvfMatch.lng, dvfMatch.adresse + " " + dvfMatch.commune);
    const parcelRes = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lon=${dvfMatch.lng}&lat=${dvfMatch.lat}`, { signal: AbortSignal.timeout(8000) });
    let parcel = null;
    if (parcelRes.ok) {
      const pd = await parcelRes.json();
      const f = pd.features?.[0];
      if (f) parcel = { section: f.properties.section, numero: f.properties.numero, contenance: f.properties.contenance, commune: f.properties.nom_com };
    }
    return NextResponse.json({
      method: "dvf",
      dvf_confidence: dvfMatch.confidence,
      dvf_surface: dvfMatch.surface_bati,
      dvf_terrain: dvfMatch.surface_terrain,
      dvf_candidates: dvfMatch.candidates?.map(c => ({ adresse: c.adresse + (c.commune ? ", " + c.commune : ""), surface_bati: c.surface_bati, surface_terrain: c.surface_terrain })),
      parcel, adresse: dvfMatch.adresse + (dvfMatch.commune ? ", " + dvfMatch.commune : ""),
      owner, matched: true, geoportailUrl,
    });
  }

  // ── 1. Toutes les parcelles dans le disque (~1km) ──────────────────────────
  const allParcels = await getIGNParcels(lat, lng);

  // ── 2. Filtrer par taille cohérente avec le type de bien ──────────────────
  const isMaison = type === "Maison" || type === "Villa";
  const minC = isMaison ? Math.max(surface * 1.2, 150) : 30;
  const maxC = isMaison ? surface * 35 : surface * 5;

  const candidates = allParcels
    .filter(p => {
      const c = p.properties?.contenance ?? 0;
      return c >= minC && c <= maxC;
    })
    .slice(0, 7);

  // ── 3. Vue aérienne IGN pour chaque candidat ──────────────────────────────
  const withMeta = candidates.map(p => ({
    section: p.properties?.section ?? "",
    numero: p.properties?.numero ?? "",
    contenance: p.properties?.contenance ?? 0,
    commune: p.properties?.nom_com ?? "",
    bbox: parcelBbox(p),
    center: parcelCenter(p),
    feature: p,
  }));

  const withAerials = (await Promise.all(
    withMeta.map(async c => ({ ...c, aerial: c.bbox ? await getIGNAerial(c.bbox) : null }))
  )).filter(c => c.aerial !== null);

  // ── 4. Récupérer la photo de l'annonce (b64 direct ou URL) ──────────────
  let listingB64: string | null = null;
  for (const p of photos.slice(0, 3)) {
    if (!p) continue;
    // Client-side pre-fetched: raw base64 string (no data: prefix)
    if (!p.startsWith("http")) {
      if (p.length > 20000) { listingB64 = p; break; }
      continue;
    }
    // URL: fetch server-side (works for public CDNs, not agency-blocked images)
    listingB64 = await fetchPhotoB64(p);
    if (listingB64) break;
  }

  // ── 5. Claude Vision : matching photo annonce ↔ vues aériennes ────────────
  let visionResult: { match_index: number; confidence: number; reason: string } | null = null;

  if (listingB64 && withAerials.length > 0) {
    const content: any[] = [];

    // Photo de l'annonce
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: listingB64 } });
    content.push({ type: "text", text: `Photo d'une annonce : ${type} d'environ ${surface}m², secteur Golfe de Saint-Tropez.` });

    // Une vue aérienne par candidat
    withAerials.forEach((c, i) => {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.aerial! } });
      content.push({ type: "text", text: `Candidat ${i+1} — parcelle ${c.section}${c.numero} (${c.contenance}m², ${c.commune})` });
    });

    content.push({ type: "text", text: `Compare la photo de l'annonce avec les ${withAerials.length} vues aériennes. Critères : piscine, toiture, végétation. JSON UNIQUEMENT (reason < 20 mots) : {"match_index":N,"confidence":0-100,"reason":"..."}. match_index 1-based, 0=aucun. confidence<40 si incertain.` });

    try {
      const cr = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 150,
          messages: [{ role: "user", content }]
        }),
        signal: AbortSignal.timeout(35000)
      });
      if (cr.ok) {
        const cd = await cr.json();
        const txt: string = cd.content?.[0]?.text ?? "";
        // Extraire le premier objet JSON complet (chercher la dernière } qui clôt le premier {)
        const start = txt.indexOf("{");
        const end = txt.lastIndexOf("}");
        const m = start >= 0 && end > start ? [txt.slice(start, end+1)] : null;
        if (m) {
          try { visionResult = JSON.parse(m[0]); } catch {}
        }
      }
    } catch {}
  }

  // ── 6. Sélectionner la parcelle retenue ───────────────────────────────────
  const matchIdx = visionResult && visionResult.confidence >= 45
    ? visionResult.match_index - 1  // 1-based → 0-based
    : -1;

  const chosen = matchIdx >= 0 && matchIdx < withAerials.length
    ? withAerials[matchIdx]
    : (withAerials[0] ?? withMeta[0] ?? null);  // fallback : première parcelle compatible

  // ── 7. Adresse + propriétaire ─────────────────────────────────────────────
  let adresseLabel: string | null = null;
  let owner: { nom: string; source: string; entreprise: string } | null = null;

  if (chosen?.center) {
    const [cLat, cLng] = chosen.center;
    adresseLabel = await reverseGeocode(cLat, cLng);
    if (adresseLabel) {
      owner = await sireneOwner(cLat, cLng, adresseLabel);
    }
  }

  // ── 8. DPE cross-check ────────────────────────────────────────────────────
  // (optionnel — le frontend peut appeler /api/dpe séparément si besoin)

  return NextResponse.json({
    parcels_total: allParcels.length,
    candidates_count: candidates.length,
    aerials_fetched: withAerials.length,
    vision_used: listingB64 !== null,
    vision_confidence: visionResult?.confidence ?? null,
    vision_reason: visionResult?.reason ?? null,
    matched: matchIdx >= 0,
    parcel: chosen ? {
      section: chosen.section,
      numero: chosen.numero,
      contenance: chosen.contenance,
      commune: chosen.commune,
    } : null,
    adresse: adresseLabel,
    owner, geoportailUrl,
  });
}
