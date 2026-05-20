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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ville = searchParams.get("ville") || "";
  const size = Math.min(parseInt(searchParams.get("size") || "60"), 100);
  const filterType = searchParams.get("type") || "buy"; // buy | rent

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
      filterType,
      propertyType: ["house", "flat"],
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

    const annonces = ads.map((a: any) => {
      const pos = a.blurInfo?.position || {};
      const lat = pos.lat || null;
      const lng = pos.lon || null;
      const posType = a.blurInfo?.type || "unknown"; // cityOrArrondissement | disk

      return {
        id: `bienici-${a.id || Math.random()}`,
        titre: a.title || `${a.propertyType === "house" ? "Maison" : "Appartement"} ${a.surfaceArea || "?"}m²`,
        prix: a.price || null,
        surface: a.surfaceArea || null,
        pieces: a.roomsQuantity || null,
        type: a.propertyType === "house" ? "Maison" : "Appartement",
        ville: a.city || zone.nomVille,
        cp: a.postalCode || "",
        agence: a.agencyName || a.accountType || "Particulier",
        photos: a.photos?.slice(0, 3).map((p: any) => p.url || p.thumb_url) || [],
        lat,
        lng,
        posType,
        url: a.id ? `https://www.bienici.com/annonce/${a.id}` : null,
        source: "Bien'ici",
        publishedAt: a.publicationDate || null,
      };
    });

    return NextResponse.json({
      annonces,
      total: annonces.length,
      ville: zone.nomVille,
      lat: String(zone.lat),
      lng: String(zone.lng),
      bienici_url: `https://www.bienici.com/recherche/${filterType === "buy" ? "achat" : "location"}/${ville.toLowerCase().replace(/\s+/g, "-")}-${zone.nomVille ? "" : ""}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
