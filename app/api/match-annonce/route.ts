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
  const GENERIC = /^(NORD|SUD|EST|OUEST|HAUT|BAS|GRAND|PETIT|VIEUX|VIEILLE|DE|DU|DES|D|L|LA|LES|LE|EN|AU|AUX|ET|SAINT|SAINTE|STE|ST)$/i;
  const STREET_TYPES = /^(RUE|AVENUE|AVE|AV|COURS|CRS|ALLEE|ALL|BOULEVARD|BD|IMPASSE|IMP|CHEMIN|CHE|ROUTE|RTE|VOIE|PASSAGE|SENTIER|PLACE|PL|LIEU[- ]DIT|LD|HAMEAU|DOMAINE|DOM|LOTISSEMENT|LOT|VILLA|QUARTIER|QUA|DRAILLE|TRAVERSE|TRV|MONTEE|DESCENTE)$/i;
  const words = adresse
    .replace(/\b\d{5}\b.*$/, "")
    .replace(/^[\d]+\s*(BIS|TER|QUATER)?\s*/i, "")
    .split(/[\s']+/)
    .filter(w => w.length >= 2);
  let skip = true;
  for (const w of words) {
    if (skip && (STREET_TYPES.test(w) || GENERIC.test(w))) continue;
    skip = false;
    if (GENERIC.test(w)) continue;
    if (w.length < 4) continue;
    if (/^\d+$/.test(w)) continue;
    const norm = w.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "");
    if (norm.length >= 4) return norm;
  }
  return null;
}

// Extrait tous les mots significatifs (≥5 chars, normalisés) d'un texte libre
function extractTextKeywords(text: string): string[] {
  const NOISE = /^(MAISON|VILLA|APPARTEMENT|VENTE|ACHAT|BELLE|MAGNIFIQUE|SUPERBE|JOLIE|IDEALE|IDEAL|EXCLUSIVITE|OFFRE|RARE|PIECE|PIECES|CHAMBRE|CHAMBRES|CUISINE|SALON|SEJOUR|GARAGE|PARKING|JARDIN|PISCINE|TERRASSE|AVEC|POUR|DANS|CETTE|VOTRE|NOTRE|VOUS|PLEIN|BEAU|PROCHE|CENTRE|VILLE|QUARTIER|ENTRE|ENVIRON|ESPACE|PLUS|PLUS|TRES|TOUT|TOUTE|TOUS|TOUTES|BORD|PLAGE)$/i;
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-zA-ZÀ-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 5)
    .map(w => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase())
    .filter(w => !NOISE.test(w) && /^[A-Z]{5,}$/.test(w));
}

// Filtre un pool DVF par correspondance de mots-clés avec le titre/description de l'annonce
function filterByTextMatch(pool: any[], titre: string, description: string): any[] {
  const allText = `${titre} ${description}`;
  const keywords = extractTextKeywords(allText);
  if (!keywords.length) return pool;

  return pool.filter(m => {
    const dvfAddr = (m.adresse || "").toUpperCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
    return keywords.some(kw => dvfAddr.includes(kw));
  });
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
type DvfPool = { match: DvfMatch|null; allTypePool: any[] };

async function dvfCrossMatch(ville: string, cp: string, lat: number, lng: number, surface: number, terrain: number, type: string): Promise<DvfPool> {
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
    if (!insee || !dept) return { match: null, allTypePool: [] };

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
    // Tout le pool du bon type (pour Vision IA fallback avec vraies coordonnées DVF)
    const allTypePool = allMuts.filter(r => r.type_local === typeMatch && r.lat && r.lng);

    // Surface habitable Bien'ici ≈ 75-95% de la surface bâtie DVF → tolérance large
    const sMin = surface * 0.75, sMax = surface * 1.35;
    let pool = allMuts.filter(r => r.type_local === typeMatch && r.surface_bati >= sMin && r.surface_bati <= sMax);

    // Avec terrain : filtre ±30% sur le terrain agrégé
    if (terrain > 100) {
      const tMin = terrain * 0.70, tMax = terrain * 1.40;
      const withT = pool.filter(r => r.surface_terrain >= tMin && r.surface_terrain <= tMax);
      if (withT.length === 1) return { match: { ...withT[0], confidence: "high" }, allTypePool };
      if (withT.length >= 2 && withT.length <= 5) {
        return { match: { ...withT[0], confidence: "medium", candidates: withT }, allTypePool };
      }
    }

    // Sans terrain ou terrain trop commun : unicité dans la commune
    if (pool.length === 1) return { match: { ...pool[0], confidence: "high" }, allTypePool };
    if (pool.length >= 2 && pool.length <= 4) {
      return { match: { ...pool[0], confidence: "medium", candidates: pool }, allTypePool };
    }
    return { match: null, allTypePool };
  } catch { return { match: null, allTypePool: [] }; }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 503 });

  const body = await req.json();
  const { lat, lng, surface = 100, terrain = 0, type = "Maison", ville = "", cp = "", titre = "", description = "", photos = [] }: {
    lat: number; lng: number; surface: number; terrain: number; type: string; ville: string; cp: string; titre: string; description: string; photos: string[];
  } = body;

  if (!lat || !lng) return NextResponse.json({ error: "lat et lng requis" }, { status: 400 });

  // Lien satellite Géoportail centré sur les coordonnées (utile même si floues)
  const geoportailUrl = `https://www.geoportail.gouv.fr/carte?c=${lng},${lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;

  // ── 0. DVF cross-match (le plus fiable : adresse exacte) ──────────────────
  const dvfPool = await dvfCrossMatch(ville, cp, lat, lng, surface, terrain, type);
  let dvfMatch = dvfPool.match;

  // Affiner par mots-clés de l'annonce (titre + description) si match imprécis
  if (dvfMatch?.confidence === "medium" && (titre || description)) {
    const filtered = filterByTextMatch(dvfMatch.candidates || [], titre, description);
    if (filtered.length === 1) dvfMatch = { ...filtered[0], confidence: "high" };
    else if (filtered.length >= 2 && filtered.length < (dvfMatch.candidates?.length || 99)) {
      dvfMatch = { ...filtered[0], confidence: "medium", candidates: filtered };
    }
  }
  // Aussi tenter le filtrage texte sur le pool complet si pas de match
  if (!dvfMatch && (titre || description)) {
    const textFiltered = filterByTextMatch(dvfPool.allTypePool, titre, description);
    const sMin = surface * 0.75, sMax = surface * 1.35;
    const sFiltered = textFiltered.filter(r => r.surface_bati >= sMin && r.surface_bati <= sMax);
    if (sFiltered.length === 1) dvfMatch = { ...sFiltered[0], confidence: "high" };
    else if (sFiltered.length >= 2 && sFiltered.length <= 5) dvfMatch = { ...sFiltered[0], confidence: "medium", candidates: sFiltered };
  }

  if (dvfMatch && dvfMatch.confidence === "high") {
    const [owner, parcelRes] = await Promise.all([
      sireneOwner(dvfMatch.lat, dvfMatch.lng, dvfMatch.adresse + " " + dvfMatch.commune),
      fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify({type:"Point",coordinates:[dvfMatch.lng,dvfMatch.lat]}))}`, { signal: AbortSignal.timeout(8000) }),
    ]);
    let parcel = null;
    if (parcelRes.ok) {
      const pd = await parcelRes.json();
      const f = pd.features?.[0];
      if (f) parcel = { section: f.properties.section, numero: f.properties.numero, contenance: f.properties.contenance, commune: f.properties.nom_com };
    }
    // Géoportail centré sur les VRAIES coordonnées DVF (pas le centroïde flou)
    const dvfGeoportailUrl = dvfMatch.lat
      ? `https://www.geoportail.gouv.fr/carte?c=${dvfMatch.lng},${dvfMatch.lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`
      : geoportailUrl;
    return NextResponse.json({
      method: "dvf",
      dvf_confidence: dvfMatch.confidence,
      dvf_surface: dvfMatch.surface_bati,
      dvf_terrain: dvfMatch.surface_terrain,
      dvf_candidates: dvfMatch.candidates?.map(c => ({ adresse: c.adresse + (c.commune ? ", " + c.commune : ""), surface_bati: c.surface_bati, surface_terrain: c.surface_terrain })),
      parcel, adresse: dvfMatch.adresse + (dvfMatch.commune ? ", " + dvfMatch.commune : ""),
      owner, matched: true, geoportailUrl: dvfGeoportailUrl,
    });
  }

  // ── 1. Récupérer la photo de l'annonce ─────────────────────────────────────
  let listingB64: string | null = null;
  for (const p of photos.slice(0, 3)) {
    if (!p) continue;
    if (!p.startsWith("http")) {
      if (p.length > 20000) { listingB64 = p; break; }
      continue;
    }
    listingB64 = await fetchPhotoB64(p);
    if (listingB64) break;
  }

  // ── 2. Vision IA sur locations DVF (vraies coordonnées GPS) ─────────────
  // Les coords Bien'ici sont un centroïde de ville — inutilisables pour IGN.
  // À la place on utilise les positions RÉELLES des mutations DVF de la commune.
  const dvfTypePool = dvfPool.allTypePool;
  let visionResult: { match_index: number; confidence: number; reason: string } | null = null;
  type DvfCandidate = { adresse: string; commune: string; surface_bati: number; surface_terrain: number; lat: number; lng: number; aerial?: string | null };
  let dvfVisionCandidates: DvfCandidate[] = [];

  if (listingB64 && dvfTypePool.length > 0) {
    // Si DVF a trouvé 2-5 candidats (medium confidence), utiliser CES candidats précis
    // Sinon, prendre les 6 plus proches en surface dans tout le pool
    const medCandidates = dvfMatch?.confidence === "medium" && dvfMatch.candidates?.length
      ? dvfMatch.candidates
      : null;
    const sorted = medCandidates
      ? medCandidates
      : [...dvfTypePool]
          .filter(r => r.surface_bati >= surface * 0.55 && r.surface_bati <= surface * 1.80)
          .sort((a, b) => Math.abs(a.surface_bati - surface) - Math.abs(b.surface_bati - surface))
          .slice(0, 6);

    // Vue aérienne IGN à chaque coordonnée DVF réelle
    const aerialResults = await Promise.all(
      sorted.map(async r => {
        // bbox ~80m autour du point DVF
        const pad = 0.0006;
        const bbox = `${r.lng - pad},${r.lat - pad},${r.lng + pad},${r.lat + pad}`;
        return { ...r, aerial: await getIGNAerial(bbox) };
      })
    );
    dvfVisionCandidates = aerialResults.filter(r => r.aerial);

    if (dvfVisionCandidates.length > 0) {
      const content: any[] = [];
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: listingB64 } });
      content.push({ type: "text", text: `Photo d'une annonce immobilière : ${type} ~${surface}m², commune de ${ville}.` });

      dvfVisionCandidates.forEach((c, i) => {
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.aerial! } });
        content.push({ type: "text", text: `Vue satellite candidat ${i+1} : ${c.adresse} (${c.surface_bati}m² bâti)` });
      });

      content.push({ type: "text", text: `Compare la photo de l'annonce aux ${dvfVisionCandidates.length} vues satellites. Critères : piscine, toiture, végétation, forme du bâtiment. JSON UNIQUEMENT (reason < 20 mots) : {"match_index":N,"confidence":0-100,"reason":"..."}. match_index 1-based, 0=aucun. confidence<40 si incertain.` });

      try {
        const cr = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content }] }),
          signal: AbortSignal.timeout(40000),
        });
        if (cr.ok) {
          const cd = await cr.json();
          const txt: string = cd.content?.[0]?.text ?? "";
          const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
          if (start >= 0 && end > start) { try { visionResult = JSON.parse(txt.slice(start, end+1)); } catch {} }
        }
      } catch {}
    }
  }

  // ── 3. Résultat Vision IA ─────────────────────────────────────────────────
  const matchIdx = visionResult && visionResult.confidence >= 50
    ? visionResult.match_index - 1
    : -1;

  const chosenDvf = matchIdx >= 0 && matchIdx < dvfVisionCandidates.length
    ? dvfVisionCandidates[matchIdx]
    : null;

  if (chosenDvf) {
    const dvfGeoUrl = `https://www.geoportail.gouv.fr/carte?c=${chosenDvf.lng},${chosenDvf.lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;
    const owner = await sireneOwner(chosenDvf.lat, chosenDvf.lng, chosenDvf.adresse + " " + chosenDvf.commune);
    const parcelRes = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify({type:"Point",coordinates:[chosenDvf.lng,chosenDvf.lat]}))}`, { signal: AbortSignal.timeout(8000) });
    let parcel = null;
    if (parcelRes.ok) {
      const pd = await parcelRes.json();
      const f = pd.features?.[0];
      if (f) parcel = { section: f.properties.section, numero: f.properties.numero, contenance: f.properties.contenance, commune: f.properties.nom_com };
    }
    return NextResponse.json({
      method: "dvf_vision",
      dvf_confidence: "medium",
      dvf_surface: chosenDvf.surface_bati,
      dvf_terrain: chosenDvf.surface_terrain,
      adresse: chosenDvf.adresse + (chosenDvf.commune ? ", " + chosenDvf.commune : ""),
      parcel, owner, matched: true, geoportailUrl: dvfGeoUrl,
      vision_used: true,
      vision_confidence: visionResult?.confidence ?? null,
      vision_reason: visionResult?.reason ?? null,
    });
  }

  // ── 4. Aucun match — retourner les candidats DVF bruts pour info ───────────
  const dvfBruts = dvfTypePool
    .sort((a, b) => Math.abs(a.surface_bati - surface) - Math.abs(b.surface_bati - surface))
    .slice(0, 5)
    .map(r => ({ adresse: r.adresse + (r.commune ? ", " + r.commune : ""), surface_bati: r.surface_bati, surface_terrain: r.surface_terrain }));

  return NextResponse.json({
    matched: false,
    vision_used: listingB64 !== null,
    vision_confidence: visionResult?.confidence ?? null,
    vision_reason: visionResult?.reason ?? null,
    dvf_candidates: dvfBruts.length > 0 ? dvfBruts : undefined,
    geoportailUrl,
    message: dvfTypePool.length === 0
      ? "Aucune vente de ce type trouvée dans la commune (DVF 2021-2025)"
      : `${dvfTypePool.length} vente(s) dans la commune — surface trop courante pour identifier`,
  });
}
