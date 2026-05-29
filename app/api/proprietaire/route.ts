import { NextRequest, NextResponse } from "next/server";

const MALE_NAMES = new Set([
  "ALEXANDRE","ALEXIS","ARNAUD","ARTHUR","BAPTISTE","BENJAMIN","BERNARD","BERTRAND","BRUNO",
  "CHARLES","CHRISTIAN","CHRISTOPHE","CLEMENT","DAMIEN","DANIEL","DAVID","DENIS","DIDIER",
  "EDOUARD","EMILE","ERIC","ETIENNE","FABIEN","FABRICE","FELIX","FLORIAN","FLORENT",
  "FRANCOIS","FREDERIC","GABRIEL","GAUTIER","GEOFFREY","GEORGES","GERARD","GILBERT",
  "GILLES","GUILLAUME","GUY","HENRI","HERVE","HUGO","IVAN","JACKY","JACQUES","JEAN",
  "JEROME","JOEL","JONATHAN","JOSEPH","JULIEN","KEVIN","KILIAN","LAURENT","LEON","LIONEL",
  "LOIC","LOUIS","LUC","LUCAS","MARC","MARTIN","MATHIEU","MATHIS","MAXIME","MELVIN",
  "MICHAEL","MICKAEL","MICHEL","MORGAN","NATHAN","NICOLAS","NOEL","NOAH","OLIVIER",
  "PASCAL","PATRICK","PAUL","PHILIPPE","PIERRE","QUENTIN","RAPHAEL","REMI","RENAUD",
  "RICHARD","ROBERT","ROMAIN","ROMEO","SAMUEL","SEBASTIEN","SIMON","STEPHANE","STEVE",
  "SYLVAIN","TEDDY","THEO","THIBAULT","THIBAUT","THIERRY","THOMAS","TIMOTHEE","TOM",
  "TONY","TRISTAN","ULRICH","VALENTIN","VICTOR","VINCENT","WILLIAM","XAVIER","YANNICK",
  "YVES","ADRIEN","ALAN","ALBERT","ANDRE","ANTHONY","ANTOINE","ARMAND","AUGUSTIN",
  "BENOIT","BORIS","CARL","CEDRIC","CORENTIN","CYRIL","DAMIAN","EDGAR","EMILIEN",
  "EMMANUEL","ENZO","FERNAND","GAUTIER","GREGOIRE","GRÉGORY","HANS","HAROLD","HENRY",
  "HUBERT","ISMAEL","JEAN-CLAUDE","JEAN-PAUL","JEAN-PIERRE","JEAN-LUC","JEAN-MARC",
  "JEAN-BAPTISTE","JEAN-FRANCOIS","JOACHIM","JORIS","JOSE","JOSSELIN","JULES",
  "LANCELOT","LUCA","LUDOVIC","LUKAS","MAËL","MAEL","NANS","NORDINE","OSCAR","PATRICE",
  "PETER","REGIS","ROLAND","RUDY","SERGE","STANISLAS","SYLVAIN","TOMMY","THIBAULT",
  "VALERY","VIVIAN","WILLY","YANN","GAETAN","GAEL","ISAAK","ROMEO"
]);

const FEMALE_NAMES = new Set([
  "AGNES","ALICE","AMANDINE","AMELIE","ANAIS","ANAÏS","ANGELIQUE","ANNE","AURELIE",
  "AXELLE","BEATRICE","BRIGITTE","CAMILLE","CAPUCINE","CAROLINE","CARINE","CATHERINE",
  "CECILE","CELINE","CHARLOTTE","CHANTAL","CHARLINE","CHLOE","CHRISTELLE","CHRISTIANE",
  "CLAIRE","CLEMENCE","CLOTILDE","CORALIE","CORINNE","DELPHINE","DAPHNE","DIANE",
  "DOROTHEE","EDITH","ELEONORE","ELISA","ELISE","ELOISE","EMILIE","EMMA","ESTELLE",
  "EVA","EVE","FANNY","FELICITE","FLORENCE","FRANCOISE","GAELLE","GENEVIEVE","GERALDINE",
  "GWENAELLE","HELENE","INGRID","INES","ISABELLE","JADE","JENNIFER","JESSICA","JOELLE",
  "JOSEPHINE","JULIE","JULIETTE","JUSTINE","KARINE","LAETITIA","LAURA","LAURE",
  "LAURENCE","LAURIE","LEA","LILIANE","LILAS","LOLA","LOUISE","LUCIE","MAEVA","MAGALI",
  "MANON","MARGAUX","MARGOT","MARIE","MARINE","MARLENE","MARTINE","MATHILDE","MAUD",
  "MELISSA","MELODIE","MICHELLE","MIREILLE","MONIQUE","MORGANE","MURIEL","NADEGE",
  "NATHALIE","NICOLE","NOEMI","NOEMIE","NORA","ODILE","OLIVIA","PASCALE","PAULINE",
  "PATRICIA","PENELOPE","PERRINE","RACHEL","SABINE","SABRINA","SANDRINE","SARAH",
  "SELENE","SEVERINE","SIMONE","SOLANGE","SOPHIE","STEPHANIE","SYLVIE","TIFFANY",
  "THERESE","VALERIE","VANESSA","VERONIQUE","VIRGINIE","ZOE","ADELINE","ADELE",
  "AGATHE","ALINE","ALISON","ANDREA","ANDREE","ANNA","ANNABELLE","ANNICK","ANNETTE",
  "ARMELLE","AURORE","BLANDINE","CHRISITNE","CLELIA","CYRIELLE","DOMINIQUE","ELEONORE",
  "EMILIENNE","EMMANUELLE","EUGENIE","GENEVIÈVE","GHISLAINE","GWENOLA","INÈS","IRIS",
  "ISABEAU","JACQUELINE","JASMINE","JOHANNE","KATELL","LAURY","LEONORE","LISELOTTE",
  "LISETTE","LORRAINE","MAËLLE","MAELLE","MARIANNE","MAUREEN","ODETTE","PRISCILLA",
  "RAPHAELLE","RENEE","ROSALIE","ROSALINE","ROSINE","SOLENNE","STELLA","YOLANDE",
  "YVETTE","YVONNE","ZORAH"
]);

function detectCivilite(prenoms: string): "Monsieur" | "Madame" | null {
  if (!prenoms) return null;
  const first = prenoms.split(/[\s-]/)[0]
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (MALE_NAMES.has(first)) return "Monsieur";
  if (FEMALE_NAMES.has(first)) return "Madame";
  return null;
}

function cleanName(nom: string, prenoms: string): string {
  const n = (nom || "").replace(/\s*\([^)]+\)/g, "").trim();
  const p = (prenoms || "").split(" ")[0] || "";
  return [n, p].filter(Boolean).join(" ");
}

function cleanBodacc(raw: string): string {
  // BODACC format: "NOM, Prenom, AutrePrenom" or "SOCIETE, NOM Prenom"
  if (!raw) return "";
  const parts = raw.split(",");
  if (parts.length >= 2) {
    const nom = parts[0].trim();
    const prenom = parts[1].trim().split(" ")[0] || "";
    return `${nom} ${prenom}`.trim();
  }
  return raw.trim();
}

function extractStreetNum(adresse: string): { num: string; street: string } {
  const m = adresse.match(/^(\d+)\s*(?:BIS|TER|QUATER)?\s+(.+)/i);
  if (m) return { num: m[1], street: m[2] };
  return { num: "", street: adresse };
}

async function tryBodacc(adresse: string, cp: string): Promise<string | null> {
  const { num, street } = extractStreetNum(adresse);
  if (!num || !street) return null;

  // Normalize street name for search (remove type prefix, keep distinctive part)
  const streetNorm = street
    .replace(/^(RUE|AVENUE|AVE|AV|COURS|CRS|ALLEE|ALL|BOULEVARD|BD|IMPASSE|IMP|PLACE|PL)\s+/i, "")
    .slice(0, 30)
    .toLowerCase();
  if (streetNorm.length < 4) return null;

  try {
    const q = encodeURIComponent(streetNorm);
    const url =
      `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/` +
      `annonces-commerciales/records?where=cp%3D%22${cp}%22%20and%20listeetablissements%20` +
      `like%20%22${q}%22&limit=20&select=commercant,listeetablissements,dateparution` +
      `&order_by=dateparution%20desc`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();

    for (const r of d.results || []) {
      let les = r.listeetablissements || "";
      if (typeof les === "string") { try { les = JSON.parse(les); } catch { les = {}; } }
      const etab = (les as any)?.etablissement || {};
      const adr = etab?.adresse || {};
      if (String(adr.numeroVoie || "") === num) {
        const nom = cleanBodacc(r.commercant || "");
        if (nom && nom.length > 1) return nom;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

async function fetchSVImage(googleKey: string, lat: string, lng: string, fov: number, heading: number, pitch: number): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&key=${googleKey}&fov=${fov}&heading=${Math.round(heading)}&pitch=${pitch}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.includes("image")) return null;
    const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { base64, mediaType: ct.includes("png") ? "image/png" : "image/jpeg" };
  } catch { return null; }
}

// Multi-shot Vision IA: wide + two zoomed angles targeting gate pillars
async function tryVision(lat: string, lng: string): Promise<string | null> {
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!googleKey || !anthropicKey) return null;

  try {
    const meta = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${googleKey}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!meta.ok) return null;
    const md = await meta.json();
    if (md.status !== "OK") return null;

    // Compute heading from pano position toward property for accurate framing
    const panoLat: number = md.location?.lat ?? parseFloat(lat);
    const panoLng: number = md.location?.lng ?? parseFloat(lng);
    const heading = bearingDeg(panoLat, panoLng, parseFloat(lat), parseFloat(lng));

    // Three shots in parallel: wide + zoom left pillar + zoom right pillar
    const [wide, zoomLeft, zoomRight] = await Promise.all([
      fetchSVImage(googleKey, lat, lng, 90, heading, 0),
      fetchSVImage(googleKey, lat, lng, 45, heading - 18, -12),
      fetchSVImage(googleKey, lat, lng, 45, heading + 18, -12),
    ]);

    const shots = [wide, zoomLeft, zoomRight].filter(Boolean) as { base64: string; mediaType: string }[];
    if (shots.length === 0) return null;

    const content: any[] = shots.map(s => ({
      type: "image", source: { type: "base64", media_type: s.mediaType, data: s.base64 },
    }));
    content.push({
      type: "text",
      text: `${shots.length} vue(s) de rue d'une propriété en France (wide + zoom piliers portail). Cherche un nom sur boîte aux lettres, interphone, pilier de portail, plaque ou sonnette. Réponds UNIQUEMENT avec le nom exact visible (ex: DUPONT, Famille MARTIN, SCI LES ACACIAS). Si aucun nom lisible: AUCUN.`,
    });

    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 80, messages: [{ role: "user", content }] }),
    });
    if (!cr.ok) return null;
    const cd = await cr.json();
    const text = (cd.content?.[0]?.text || "").trim();
    if (!text || text === "AUCUN" || text.length < 2 || text.length > 80) return null;
    return text;
  } catch { return null; }
}

// ── Pappers Immobilier (Fichiers Fonciers) ────────────────────────────────────

const PUBLIC_OWNER = /^(COMMUNE|COMMUNAUTE|DEPARTEMENT|REGION|ETAT|REPUBLIQUE|INDIVISAIRES?\s+VOIRIE|VOIRIE|AUTOROUTE|RFF|SNCF|EDF|GDF|ENEDIS|GRDF|VEOLIA|SUEZ|METROPOLE|SYNDICAT|COPROPRIETE\s+ROUTE|LOTISSEMENT\s+ROUTE)/i;

async function pappersImmoBasic(lat: string, lng: string, apiKey: string): Promise<{ nom: string; isEntity: boolean } | null> {
  try {
    const url = `https://api-immobilier.pappers.fr/v1/parcelles?latitude=${lat}&longitude=${lng}&distance=20&bases=proprietaires&champs_supplementaires=proprietaires.personnes_physiques&par_page=3`;
    const r = await fetch(url, { headers: { "api-key": apiKey }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    // Parcourir les résultats pour trouver un propriétaire privé (ignorer voiries/communes)
    for (const p of (data.resultats || [])) {
      for (const rp of (p.proprietaires || [])) {
        const pps: any[] = rp.personnes_physiques || [];
        if (pps.length > 0) {
          const pp = pps[0];
          const nom = pp.nom_complet || [pp.prenoms, pp.nom_usage || pp.nom_patronymique].filter(Boolean).join(" ").trim();
          if (nom && !PUBLIC_OWNER.test(nom)) return { nom, isEntity: false };
        } else if (rp.nom_entreprise && !PUBLIC_OWNER.test(rp.nom_entreprise)) {
          return { nom: rp.nom_entreprise, isEntity: true };
        }
      }
    }
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const adresse = searchParams.get("adresse") || "";

  if (!lat || !lng) return NextResponse.json({ error: "lat/lng requis" }, { status: 400 });

  // ── Priorité absolue : Pappers Immo (Fichiers Fonciers DGFIP) ────────────
  const pappersImmoKey = process.env.PAPPERS_IMMO_API_KEY || "";
  if (pappersImmoKey) {
    const pappersResult = await pappersImmoBasic(lat, lng, pappersImmoKey);
    if (pappersResult) {
      const cpMatch = adresse.match(/\b(3[0-9]{4})\b/);
      const cp = cpMatch?.[1] || "33000";
      // Cadastre en parallèle pour la parcelle
      const eps = 0.0002;
      const wfsBbox = `${(parseFloat(lat)-eps).toFixed(6)},${(parseFloat(lng)-eps).toFixed(6)},${(parseFloat(lat)+eps).toFixed(6)},${(parseFloat(lng)+eps).toFixed(6)}`;
      let parcelles: any[] = [];
      try {
        const cr = await fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${wfsBbox}&OUTPUTFORMAT=application/json&COUNT=3`, { signal: AbortSignal.timeout(6000) });
        if (cr.ok) { const d = await cr.json(); parcelles = (d.features || []).map((f: any) => ({ section: f.properties?.section, numero: f.properties?.numero, contenance: f.properties?.contenance, code_insee: f.properties?.code_insee })); }
      } catch {}
      // Prénom = dernier mot uniquement pour les particuliers, pas pour les entités
      const prenom = pappersResult.isEntity ? "" : (pappersResult.nom.split(" ").slice(-1)[0] || "");
      return NextResponse.json({
        parcelles, entreprises: [],
        proprietaire_nom: pappersResult.nom,
        proprietaire_prenom: prenom,
        civilite: "",
        proprietaire_source: "pappers_immo",
        vision_enabled: !!process.env.GOOGLE_STREETVIEW_KEY,
        pagesBlanchesUrl: `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=&ou=${encodeURIComponent(adresse)}`,
        annuaireUrl: `https://www.118712.fr/annuaire/personne?ou=${encodeURIComponent(adresse)}`,
      });
    }
  }

  // Extract postal code from address for BODACC
  const cpMatch = adresse.match(/\b(3[0-9]{4})\b/);
  const cp = cpMatch?.[1] || "33000";

  // Sirene + Cadastre in parallel (WFS Géoplateforme, EPSG:4326 bbox = south,west,north,east)
  const eps = 0.0002;
  const wfsBbox = `${(parseFloat(lat)-eps).toFixed(6)},${(parseFloat(lng)-eps).toFixed(6)},${(parseFloat(lat)+eps).toFixed(6)},${(parseFloat(lng)+eps).toFixed(6)}`;
  const [cadastreRes, sireneRes] = await Promise.allSettled([
    fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${wfsBbox}&OUTPUTFORMAT=application/json&COUNT=3`, {
      signal: AbortSignal.timeout(8000),
    }),
    fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(adresse)}&size=8`, {
      signal: AbortSignal.timeout(6000),
    }),
  ]);

  let parcelles: any[] = [];
  if (cadastreRes.status === "fulfilled" && cadastreRes.value.ok) {
    const d = await cadastreRes.value.json();
    parcelles = (d.features || []).map((f: any) => ({
      section: f.properties?.section,
      numero: f.properties?.numero,
      contenance: f.properties?.contenance,
      code_insee: f.properties?.code_insee,
    }));
  }

  let entreprises: any[] = [];
  let proprietaire_nom = "";
  let proprietaire_prenom = "";
  let proprietaire_source = "inconnu";
  let civilite: "Monsieur" | "Madame" | "" = "";

  if (sireneRes.status === "fulfilled" && sireneRes.value.ok) {
    const d = await sireneRes.value.json();
    const results: any[] = d.results || [];

    entreprises = results.slice(0, 3).map((e: any) => ({
      nom: e.nom_complet || e.nom_raison_sociale,
      siren: e.siren,
      adresse: e.siege?.adresse,
      activite: e.siege?.activite_principale,
      ouvert: (e.nombre_etablissements_ouverts || 0) > 0,
      dirigeants: (e.dirigeants || []).slice(0, 2).map((dg: any) => ({
        nom: dg.nom, prenoms: dg.prenoms,
      })),
    }));

    // Priority: SCI/SARL/foncière > first result
    const sci = results.find(e => {
      const n = (e.nom_complet || e.nom_raison_sociale || "").toUpperCase();
      return n.includes("SCI") || n.includes("SARL") || n.includes("SAS") || n.includes("SASU") || n.includes("FONCIERE") || n.includes("IMMOB");
    });

    const target = sci || results[0];
    if (target) {
      const dgs: any[] = target.dirigeants || [];
      if (dgs.length > 0) {
        proprietaire_prenom = (dgs[0].prenoms || "").split(" ")[0] || "";
        proprietaire_nom = cleanName(dgs[0].nom, dgs[0].prenoms);
        proprietaire_source = sci ? "sci+dirigeant" : "sirene+dirigeant";
        const detected = detectCivilite(dgs[0].prenoms || "");
        if (detected) civilite = detected;
      } else {
        proprietaire_nom = (target.nom_complet || target.nom_raison_sociale || "").split("(")[0].trim();
        proprietaire_source = sci ? "sci" : "sirene";
      }
    }
  }

  // Fallback 1: BODACC (commercial registrations at exact address)
  if (!proprietaire_nom) {
    const bodaccNom = await tryBodacc(adresse.toUpperCase(), cp);
    if (bodaccNom) {
      proprietaire_nom = bodaccNom;
      proprietaire_source = "bodacc";
    }
  }

  // Fallback 2: Street View + Claude Vision (inline, no HTTP hop)
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  if (!proprietaire_nom && googleKey) {
    const visionName = await tryVision(lat, lng);
    if (visionName) {
      proprietaire_nom = visionName;
      proprietaire_source = "vision-ia";
    }
  }

  if (!proprietaire_nom && parcelles.length > 0) proprietaire_source = "cadastre";

  // Deep links for manual lookup
  const adresseEnc = encodeURIComponent(adresse);
  const pagesBlanchesUrl = `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=&ou=${adresseEnc}`;
  const annuaireUrl = `https://www.118712.fr/annuaire/personne?ou=${adresseEnc}`;

  const deepLink = parcelles[0]
    ? `https://www.cadastre.gouv.fr/cadastre/publicDisplay?f=1&codeDep=${parcelles[0].code_insee?.slice(0,2)}&codeDir=${parcelles[0].code_insee?.slice(0,2)}&codeCommune=${parcelles[0].code_insee}&section=${parcelles[0].section}&numero=${parcelles[0].numero}`
    : null;

  return NextResponse.json({
    parcelles, entreprises, deepLink,
    proprietaire_nom, proprietaire_prenom, civilite, proprietaire_source,
    vision_enabled: !!googleKey,
    pagesBlanchesUrl, annuaireUrl,
  });
}
