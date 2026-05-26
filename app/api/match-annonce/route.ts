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
  // "L'Oumède Nord 83350 Ramatuelle" → "Oumede"
  // Remove postal code, commune at end, street prefixes, normalize accents
  const clean = adresse
    .replace(/\b\d{5}\b.*$/, "")  // remove postal code and everything after
    .replace(/^(\d+\s*(BIS|TER|QUATER)?\s*)/i, "")  // remove street number
    .replace(/^(RUE|AVENUE|AVE|AV|COURS|CRS|ALLEE|ALL|BOULEVARD|BD|IMPASSE|IMP|CHEMIN|CHE|PLACE|PL|LIEU[- ]DIT|LD|HAMEAU|L\'|LA |LES |LE )\s*/gi, "")
    .trim();
  if (clean.length < 4) return null;
  // Take first significant word (drop directionals like "Nord", "Sud", etc.)
  const word = clean.split(/\s+/).find(w =>
    w.length >= 4 && !/^(NORD|SUD|EST|OUEST|HAUT|BAS|GRAND|PETIT|VIEUX|VIEILLE)$/i.test(w)
  );
  if (!word || word.length < 4) return null;
  // Normalize accents
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]/g, "");
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

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 503 });

  const body = await req.json();
  const { lat, lng, surface = 100, type = "Maison", photos = [] }: {
    lat: number; lng: number; surface: number; type: string; photos: string[];
  } = body;

  if (!lat || !lng) return NextResponse.json({ error: "lat et lng requis" }, { status: 400 });

  // ── 1. Toutes les parcelles dans le disque (~600m) ─────────────────────────
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
    owner,
  });
}
