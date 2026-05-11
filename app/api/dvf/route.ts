import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const ville = searchParams.get("ville");

  try {
    let geoLat = lat, geoLng = lng;

    // Geocode if ville provided
    if (ville && (!lat || !lng)) {
      const banRes = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ville)}&type=municipality&limit=1`
      );
      const banData = await banRes.json();
      if (!banData.features?.length) {
        return NextResponse.json({ error: "Ville introuvable" }, { status: 404 });
      }
      const [lng2, lat2] = banData.features[0].geometry.coordinates;
      geoLat = String(lat2);
      geoLng = String(lng2);
    }

    if (!geoLat || !geoLng) {
      return NextResponse.json({ error: "Coordonnées manquantes" }, { status: 400 });
    }

    // Fetch DVF
    const dvfUrl = `https://api-dvf.etalab.studio/api/geopoints?lat=${geoLat}&lon=${geoLng}&dist=3000&nombre_resultats=100`;
    const dvfRes = await fetch(dvfUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });

    if (!dvfRes.ok) {
      return NextResponse.json({ error: "API DVF indisponible" }, { status: 502 });
    }

    const dvfData = await dvfRes.json();
    const transactions = dvfData.results || dvfData || [];

    // Score each transaction
    const scored = transactions
      .filter((t: any) => 
        (t.type_local === "Maison" || t.type_local === "Appartement") &&
        t.valeur_fonciere > 0 &&
        t.latitude && t.longitude
      )
      .map((t: any) => {
        const annee = new Date(t.date_mutation).getFullYear();
        const age = new Date().getFullYear() - annee;
        const sAge = age>=10&&age<=15?40:age>=7&&age<10?35:age>=15&&age<=20?30:age>=5&&age<7?20:age>20?25:5;
        const sPV = t.valeur_fonciere>300000?25:t.valeur_fonciere>150000?18:10;
        const sType = t.type_local==="Maison"?15:12;
        const score = Math.min(100, sAge+sPV+sType);
        const adresse = `${t.adresse_numero||""} ${t.adresse_nom_voie||""}`.trim();
        return {
          id: Math.random(),
          adresse: adresse || t.adresse_nom_voie || "Adresse inconnue",
          ville: t.nom_commune,
          score,
          source: "DVF",
          status: score>=65?"À contacter":"À surveiller",
          notes: `Acheté en ${annee} · ${t.surface_reelle_bati||"?"}m² · ${Math.round(t.valeur_fonciere/1000)}k€`,
          lat: t.latitude,
          lng: t.longitude,
          anciennete: age,
          prix_achat: t.valeur_fonciere
        };
      })
      .sort((a: any, b: any) => b.score - a.score);

    return NextResponse.json({ 
      prospects: scored,
      total: scored.length,
      lat: geoLat,
      lng: geoLng
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: 500 });
  }
}
