import { NextRequest, NextResponse } from "next/server";

// ── Bien'ici ─────────────────────────────────────────────────────────────────

async function getZoneId(ville: string): Promise<{ zoneId: string; nomVille: string; lat: number; lng: number } | null> {
  const r = await fetch(
    `https://res.bienici.com/suggest.json?q=${encodeURIComponent(ville)}&size=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) return null;
  const data = await r.json();
  if (!data?.length) return null;
  const first = data[0];
  const zoneId = first.zoneIds?.[0];
  if (!zoneId) return null;
  const bb = first.boundingBox;
  const lat = bb ? (bb.north + bb.south) / 2 : 0;
  const lng = bb ? (bb.east + bb.west) / 2 : 0;
  return { zoneId, nomVille: first.name, lat, lng };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0) {
    const nums = (v as unknown[]).filter(x => typeof x === "number") as number[];
    if (!nums.length) return null;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  }
  return null;
}

function formatAgence(a: any): string {
  if (a.accountDisplayName && a.accountDisplayName !== "null") return a.accountDisplayName;
  const type = a.accountType || "";
  if (type === "agency") return "Agence";
  if (type === "developer") return "Promoteur";
  if (type === "individual") return "Particulier";
  return type || "Agence";
}

function bestPhotoUrl(photos: any[]): string | null {
  if (!photos?.length) return null;
  const p = photos[0];
  return p.url_photo || p.url || p.thumb_url || null;
}

function buildFilters(zoneId: string, from: number, size: number, sortBy: string, sortOrder: string) {
  return {
    size, from,
    filterType: "buy",
    propertyType: ["house", "flat"],
    minPrice: 100000,
    zoneIdsByTypes: { zoneIds: [zoneId] },
    sortBy, sortOrder,
  };
}

async function fetchBieniciPage(zoneId: string, from: number, sortBy: string, sortOrder: string): Promise<any[]> {
  try {
    const filters = buildFilters(zoneId, from, 60, sortBy, sortOrder);
    const url = `https://www.bienici.com/realEstateAds.json?filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.realEstateAds || [];
  } catch { return []; }
}

function mapBieniciAd(a: any, nomVille: string): any | null {
  const prix = toNumber(a.price);
  const surface = toNumber(a.surfaceArea);
  if (!prix || prix < 80000) return null;
  const pos = a.blurInfo?.position || {};
  const lat: number | null = pos.lat ?? null;
  const lng: number | null = pos.lon ?? null;
  const type = a.propertyType === "house" ? "Maison" : "Appartement";
  const titre = a.title && a.title !== type.toUpperCase()
    ? a.title.charAt(0).toUpperCase() + a.title.slice(1).toLowerCase()
    : `${type} ${surface ? surface + "m²" : ""}`.trim();
  return {
    id: `bienici-${a.id || Math.random()}`,
    titre, prix, surface,
    pieces: toNumber(a.roomsQuantity),
    type,
    ville: a.city || nomVille,
    cp: a.postalCode || "",
    agence: formatAgence(a),
    photos: (a.photos || []).slice(0, 3).map((p: any) => bestPhotoUrl([p])).filter(Boolean),
    lat, lng,
    terrain: toNumber(a.landSurfaceArea) || 0,
    posType: a.blurInfo?.type || "unknown",
    url: a.id ? `https://www.bienici.com/annonce/${a.id}` : null,
    source: "Bien'ici",
    publishedAt: a.publicationDate || null,
    isNew: !!a.newProperty,
  };
}

// ── PAP.fr via ScraperAPI ─────────────────────────────────────────────────────

function citySlug(ville: string): string {
  return ville.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function fetchPapPage(ville: string, scraperKey: string, page = 1): Promise<{ ads: any[]; rawHtml?: string }> {
  const slug = citySlug(ville);
  // PAP URL: /annonce/ventes-maisons-appartements-{ville-slug}
  const targetUrl = `https://www.pap.fr/annonce/ventes-maisons-appartements-${slug}${page > 1 ? `?page=${page}` : ""}`;
  const proxyUrl = `https://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=fr`;

  try {
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(50000) });
    if (!r.ok) return { ads: [] };
    const html = await r.text();
    // Return raw HTML for debug (only first 5000 chars)
    const rawHtml = html.slice(0, 5000);
    return { ads: parsePapHtml(html, ville), rawHtml };
  } catch { return { ads: [] }; }
}

function parsePapHtml(html: string, nomVille: string): any[] {
  const ads: any[] = [];

  // Strategy 1: __NEXT_DATA__ (Next.js SSR payload)
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      // Try common PAP data paths
      const listings: any[] =
        data?.props?.pageProps?.listings ||
        data?.props?.pageProps?.annonces ||
        data?.props?.pageProps?.results ||
        data?.props?.pageProps?.data?.listings ||
        [];
      for (const ad of listings) {
        const mapped = mapPapNextAd(ad, nomVille);
        if (mapped) ads.push(mapped);
      }
      if (ads.length > 0) return ads;
    } catch {}
  }

  // Strategy 2: JSON-LD schema (RealEstateListing / ItemList)
  const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jsonLdMatches) {
    try {
      const data = JSON.parse(m[1]);
      const items: any[] = data?.["@type"] === "ItemList"
        ? (data.itemListElement || []).map((x: any) => x.item || x)
        : data?.["@type"] ? [data] : [];
      for (const item of items) {
        const mapped = mapPapJsonLd(item, nomVille);
        if (mapped) ads.push(mapped);
      }
      if (ads.length > 0) return ads;
    } catch {}
  }

  // Strategy 3: window.__data__ or similar embedded JSON objects
  const dataMatches = html.matchAll(/(?:window\.__(?:DATA|STORE|STATE|APP)__\s*=\s*|"annonces"\s*:\s*)(\[[\s\S]{50,20000}\])/g);
  for (const m of dataMatches) {
    try {
      const arr = JSON.parse(m[1]);
      if (!Array.isArray(arr)) continue;
      for (const ad of arr) {
        const mapped = mapPapNextAd(ad, nomVille);
        if (mapped) ads.push(mapped);
      }
      if (ads.length > 0) return ads;
    } catch {}
  }

  return ads;
}

function mapPapNextAd(ad: any, nomVille: string): any | null {
  // PAP Next.js data shape (approximate — adjusted after first real test)
  const prix = ad.prix || ad.price || ad.prixMax || ad.prix_min;
  const surface = ad.surface || ad.surfaceBati || ad.surface_habitable;
  if (!prix || prix < 50000) return null;
  const typeBrut = (ad.typeBien || ad.type_bien || ad.categorie || "").toLowerCase();
  const type = typeBrut.includes("maison") || typeBrut.includes("villa") ? "Maison" : "Appartement";
  return {
    id: `pap-${ad.id || ad.idAnnonce || Math.random()}`,
    titre: ad.titre || ad.title || `${type} ${surface ? surface + "m²" : ""}`.trim(),
    prix: typeof prix === "string" ? parseInt(prix.replace(/\D/g, "")) : prix,
    surface: surface ? parseFloat(surface) : null,
    pieces: ad.nbPieces || ad.pieces || ad.rooms || null,
    type,
    ville: ad.ville || ad.city || nomVille,
    cp: ad.codePostal || ad.cp || ad.postalCode || "",
    agence: "Particulier",
    photos: (ad.photos || ad.images || []).slice(0, 3).map((p: any) =>
      typeof p === "string" ? p : p?.url || p?.src || null
    ).filter(Boolean),
    lat: ad.lat || ad.latitude || null,
    lng: ad.lng || ad.longitude || null,
    posType: "exact",
    url: ad.url || (ad.id ? `https://www.pap.fr/annonces/${ad.id}` : null),
    source: "PAP",
    publishedAt: ad.dateParution || ad.date || null,
    isNew: false,
  };
}

function mapPapJsonLd(item: any, nomVille: string): any | null {
  // JSON-LD schema.org/RealEstateListing or schema.org/Product
  const prix = item?.offers?.price || item?.price;
  if (!prix || prix < 50000) return null;
  const surface = item?.floorSize?.value || item?.numberOfRooms;
  const type = (item?.["@type"] || "").includes("House") ? "Maison" : "Appartement";
  return {
    id: `pap-${encodeURIComponent(item?.url || Math.random())}`,
    titre: item?.name || `${type} ${surface ? surface + "m²" : ""}`.trim(),
    prix,
    surface: surface ? parseFloat(surface) : null,
    pieces: item?.numberOfRooms || null,
    type,
    ville: item?.address?.addressLocality || nomVille,
    cp: item?.address?.postalCode || "",
    agence: "Particulier",
    photos: item?.image ? (Array.isArray(item.image) ? item.image.slice(0, 3) : [item.image]) : [],
    lat: item?.geo?.latitude || null,
    lng: item?.geo?.longitude || null,
    posType: "exact",
    url: item?.url || null,
    source: "PAP",
    publishedAt: item?.datePosted || null,
    isNew: false,
  };
}

// ── Route principale ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ville = searchParams.get("ville") || "";
  const size = Math.min(parseInt(searchParams.get("size") || "60"), 300);
  const debug = searchParams.get("debug") === "1";
  const scraperKey = process.env.SCRAPERAPI_KEY || "";

  if (!ville) {
    return NextResponse.json({ error: "ville requis" }, { status: 400 });
  }

  try {
    // Bien'ici (toujours actif)
    const zone = await getZoneId(ville);
    if (!zone) {
      return NextResponse.json({ error: "Ville introuvable" }, { status: 404 });
    }

    const bieniciPages = await Promise.allSettled([
      fetchBieniciPage(zone.zoneId, 0,   "publicationDate", "desc"),
      fetchBieniciPage(zone.zoneId, 60,  "publicationDate", "desc"),
      fetchBieniciPage(zone.zoneId, 120, "publicationDate", "desc"),
      fetchBieniciPage(zone.zoneId, 0,   "price",           "desc"),
      fetchBieniciPage(zone.zoneId, 0,   "price",           "asc"),
    ]);

    const allRaw: any[] = [];
    const seen = new Set<string>();

    for (const p of bieniciPages) {
      if (p.status !== "fulfilled") continue;
      for (const ad of p.value) {
        const id = String(ad.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        allRaw.push(ad);
      }
    }

    const bieniciAds = allRaw
      .map(a => mapBieniciAd(a, zone.nomVille))
      .filter(Boolean);

    // PAP.fr via ScraperAPI (si clé présente)
    let papAds: any[] = [];
    let papDebug: string | undefined;
    let papStatus = "disabled";

    if (scraperKey) {
      papStatus = "fetching";
      const papResult = await fetchPapPage(ville, scraperKey, 1);
      papAds = papResult.ads;
      papStatus = papAds.length > 0 ? `ok:${papAds.length}` : "parsed:0";
      if (debug) papDebug = papResult.rawHtml;
    }

    // Dédupliquer PAP vs Bien'ici par prix+surface approximatif
    const bieniciKeys = new Set(bieniciAds.map((a: any) => `${a.prix}-${a.surface}`));
    const papUnique = papAds.filter((a: any) => !bieniciKeys.has(`${a.prix}-${a.surface}`));

    const annonces = [...bieniciAds, ...papUnique].slice(0, size);

    return NextResponse.json({
      annonces,
      total: annonces.length,
      sources: {
        bienici: bieniciAds.length,
        pap: papUnique.length,
        pap_status: papStatus,
      },
      ville: zone.nomVille,
      lat: String(zone.lat),
      lng: String(zone.lng),
      ...(debug && papDebug ? { pap_html_preview: papDebug } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
