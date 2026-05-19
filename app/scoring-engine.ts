// Moteur de scoring vendeur prédictif Mandatly
// Calcule la probabilité qu'un propriétaire vende dans les 3-24 mois

export type DVFTransaction = {
  id_mutation: string;
  date_mutation: string;
  valeur_fonciere: number;
  adresse_numero?: string;
  adresse_nom_voie?: string;
  nom_commune: string;
  code_postal: string;
  type_local: string;
  surface_reelle_bati?: number;
  surface_terrain?: number;
  latitude?: number;
  longitude?: number;
};

export type ProspectScore = {
  id: number;
  adresse: string;
  ville: string;
  code_postal: string;
  lat?: number;
  lng?: number;
  score: number;
  niveau: "très_élevé" | "élevé" | "moyen" | "faible";
  source: string;
  status: string;
  notes: string;
  details: {
    anciennete_ans: number;
    prix_achat: number;
    surface?: number;
    type_bien: string;
    plus_value_estimee?: number;
    score_anciennete: number;
    score_plusvalue: number;
    score_type: number;
  };
};

// Calcul du score basé sur l'ancienneté (critère principal)
function scoreAnciennete(anneeAchat: number): number {
  const age = new Date().getFullYear() - anneeAchat;
  if (age >= 10 && age <= 15) return 40; // Fenêtre idéale
  if (age >= 7 && age < 10) return 35;
  if (age >= 15 && age <= 20) return 30;
  if (age >= 5 && age < 7) return 20;
  if (age > 20) return 25;
  if (age >= 3 && age < 5) return 10;
  return 5;
}

// Score basé sur la plus-value latente
function scorePlusValue(prixAchat: number, commune: string): number {
  // Estimation simplifiée - en prod on croiserait avec les prix actuels
  const facteurHausse: Record<string, number> = {
    "bordeaux": 1.8, "paris": 2.1, "lyon": 1.7, "nantes": 1.6,
    "montpellier": 1.5, "toulouse": 1.4, "default": 1.3
  };
  const communeKey = commune.toLowerCase().split(" ")[0];
  const facteur = facteurHausse[communeKey] || facteurHausse["default"];
  const prixEstimeActuel = prixAchat * facteur;
  const plusValue = prixEstimeActuel - prixAchat;
  const ratio = plusValue / prixAchat;

  if (ratio > 0.8) return 30;
  if (ratio > 0.5) return 25;
  if (ratio > 0.3) return 20;
  if (ratio > 0.15) return 12;
  return 5;
}

// Score basé sur le type de bien
function scoreTypeBien(type: string): number {
  if (type === "Maison") return 15;
  if (type === "Appartement") return 12;
  if (type === "Dépendance") return 8;
  return 10;
}

// Score bonus surface terrain
function scoreTerrain(surface?: number): number {
  if (!surface) return 0;
  if (surface > 1000) return 10;
  if (surface > 500) return 7;
  if (surface > 200) return 4;
  return 2;
}

export function calculerScore(dvf: DVFTransaction): ProspectScore {
  const dateAchat = new Date(dvf.date_mutation);
  const anneeAchat = dateAchat.getFullYear();
  const anciennete = new Date().getFullYear() - anneeAchat;

  const sAnciennete = scoreAnciennete(anneeAchat);
  const sPlusValue = scorePlusValue(dvf.valeur_fonciere, dvf.nom_commune);
  const sType = scoreTypeBien(dvf.type_local);
  const sTerrain = scoreTerrain(dvf.surface_terrain);

  const scoreTotal = Math.min(100, sAnciennete + sPlusValue + sType + sTerrain);

  const adresse = `${dvf.adresse_numero || ""} ${dvf.adresse_nom_voie || ""}`.trim();
  const prixEstimeActuel = dvf.valeur_fonciere * 1.5;

  const niveau = scoreTotal >= 80 ? "très_élevé"
    : scoreTotal >= 65 ? "élevé"
    : scoreTotal >= 45 ? "moyen"
    : "faible";

  const notes = [
    `Acheté en ${anneeAchat}`,
    dvf.surface_reelle_bati ? `${dvf.surface_reelle_bati}m²` : null,
    `${(dvf.valeur_fonciere / 1000).toFixed(0)}k€`,
    anciennete >= 7 ? `${anciennete} ans de détention` : null,
  ].filter(Boolean).join(" · ");

  // Deterministic stable ID based on address + date
  const rawId = `${dvf.adresse_numero || ""}${dvf.adresse_nom_voie || ""}${dvf.date_mutation || ""}`;
  const stableId = rawId.split("").reduce((a: number, c: string) => ((a << 5) - a) + c.charCodeAt(0), 0) >>> 0;

  return {
    id: stableId,
    adresse: adresse || dvf.adresse_nom_voie || "Adresse inconnue",
    ville: dvf.nom_commune,
    code_postal: dvf.code_postal,
    lat: dvf.latitude,
    lng: dvf.longitude,
    score: scoreTotal,
    niveau,
    source: "DVF",
    status: scoreTotal >= 65 ? "À contacter" : "À surveiller",
    notes,
    details: {
      anciennete_ans: anciennete,
      prix_achat: dvf.valeur_fonciere,
      surface: dvf.surface_reelle_bati,
      type_bien: dvf.type_local,
      plus_value_estimee: prixEstimeActuel - dvf.valeur_fonciere,
      score_anciennete: sAnciennete,
      score_plusvalue: sPlusValue,
      score_type: sType,
    },
  };
}

// Fetch DVF depuis l'API Etalab
export async function fetchDVF(lat: number, lng: number, rayon = 3000): Promise<ProspectScore[]> {
  const url = `https://api-dvf.etalab.studio/api/geopoints?lat=${lat}&lon=${lng}&dist=${rayon}&nombre_resultats=100`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error("API DVF indisponible");

  const data = await res.json();
  const transactions: DVFTransaction[] = data.results || data || [];

  return transactions
    .filter(t => (t.type_local === "Maison" || t.type_local === "Appartement") && t.valeur_fonciere > 0)
    .map(t => calculerScore(t))
    .filter(p => p.lat && p.lng)
    .sort((a, b) => b.score - a.score);
}

// Géocoder une ville via BAN
export async function geocodeVille(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&type=municipality&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.features?.length) return null;
  const [lng, lat] = data.features[0].geometry.coordinates;
  return { lat, lng, label: data.features[0].properties.label };
}
