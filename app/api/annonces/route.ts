import { NextRequest, NextResponse } from "next/server";

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
    size,
    from,
    filterType: "buy",
    propertyType: ["house", "flat"],
    minPrice: 100000,
    zoneIdsByTypes: { zoneIds: [zoneId] },
    sortBy,
    sortOrder,
  };
}

async function fetchPage(zoneId: string, from: number, sortBy: string, sortOrder: string): Promise<any[]> {
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

function mapAd(a: any, nomVille: string): any | null {
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
    titre,
    prix,
    surface,
    pieces: toNumber(a.roomsQuantity),
    type,
    ville: a.city || nomVille,
    cp: a.postalCode || "",
    agence: formatAgence(a),
    photos: (a.photos || []).slice(0, 3).map((p: any) => bestPhotoUrl([p])).filter(Boolean),
    lat,
    lng,
    posType: a.blurInfo?.type || "unknown",
    url: a.id ? `https://www.bienici.com/annonce/${a.id}` : null,
    source: "Bien'ici",
    publishedAt: a.publicationDate || null,
    isNew: !!a.newProperty,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ville = searchParams.get("ville") || "";
  const size = Math.min(parseInt(searchParams.get("size") || "60"), 300);

  if (!ville) {
    return NextResponse.json({ error: "ville requis" }, { status: 400 });
  }

  try {
    const zone = await getZoneId(ville);
    if (!zone) {
      return NextResponse.json({ error: "Ville introuvable" }, { status: 404 });
    }

    // Fetch 5 pages in parallel with different offsets and sort orders
    // to maximize coverage: newest listings + price spread + mid-range
    const pages = await Promise.allSettled([
      fetchPage(zone.zoneId, 0,   "publicationDate", "desc"),  // newest
      fetchPage(zone.zoneId, 60,  "publicationDate", "desc"),  // newest p2
      fetchPage(zone.zoneId, 120, "publicationDate", "desc"),  // newest p3
      fetchPage(zone.zoneId, 0,   "price",           "desc"),  // most expensive
      fetchPage(zone.zoneId, 0,   "price",           "asc"),   // least expensive
    ]);

    const allAds: any[] = [];
    const seen = new Set<string>();

    for (const p of pages) {
      if (p.status !== "fulfilled") continue;
      for (const ad of p.value) {
        const id = String(ad.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        allAds.push(ad);
      }
    }

    const annonces = allAds
      .map(a => mapAd(a, zone.nomVille))
      .filter(Boolean)
      .slice(0, size);

    return NextResponse.json({
      annonces,
      total: annonces.length,
      ville: zone.nomVille,
      lat: String(zone.lat),
      lng: String(zone.lng),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
