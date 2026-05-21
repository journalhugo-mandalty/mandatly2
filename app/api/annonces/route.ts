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
    // For price ranges (new builds), return the average
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ville = searchParams.get("ville") || "";
  const size = Math.min(parseInt(searchParams.get("size") || "60"), 100);

  if (!ville) {
    return NextResponse.json({ error: "ville requis" }, { status: 400 });
  }

  try {
    const zone = await getZoneId(ville);
    if (!zone) {
      return NextResponse.json({ error: "Ville introuvable sur Bien'ici" }, { status: 404 });
    }

    const filters = {
      size,
      from: 0,
      filterType: "buy",
      propertyType: ["house", "flat"],
      minPrice: 200000,
      zoneIdsByTypes: { zoneIds: [zone.zoneId] },
    };

    const url = `https://www.bienici.com/realEstateAds.json?filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (!r.ok) {
      return NextResponse.json({ error: "Bien'ici indisponible" }, { status: 502 });
    }

    const data = await r.json();
    const ads: any[] = data.realEstateAds || [];

    const annonces = ads
      .map((a: any) => {
        const prix = toNumber(a.price);
        const surface = toNumber(a.surfaceArea);
        if (!prix || prix < 150000) return null; // skip viager and tiny lots

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
          ville: a.city || zone.nomVille,
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
      })
      .filter(Boolean);

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
