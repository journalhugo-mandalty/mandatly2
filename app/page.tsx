"use client";
import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { loadUserData, saveUserData, signOut as supabaseSignOut } from "../lib/supabase";
import { createClient as createBrowserClient } from "../utils/supabase/client";

const MapComponent = lazy(() => import("./map-component"));

// ── Estimation & Avis de valeur via DVF géo-localisée ──────────────────────
async function lancerEstimation(type: string, surface: number, adresse: string, etat: string) {
  // 1. Géocoder l'adresse précise
  const banRes = await fetch(
    `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`
  );
  if (!banRes.ok) throw new Error("Service de géocodage indisponible");
  const banData = await banRes.json();
  const feature = banData.features?.[0];
  if (!feature) throw new Error("Adresse introuvable — vérifiez l'adresse saisie (ex: 14 rue des Acacias, Bordeaux)");

  const [lng, lat] = feature.geometry.coordinates;
  const adresseLabel: string = feature.properties.label || adresse;
  const city: string = feature.properties.city || adresse;
  const inseeCode: string = feature.properties.citycode || "";
  const dept: string = inseeCode.slice(0, inseeCode.length === 5 ? 2 : 3);

  // 2. Récupérer DVF avec filtrage géographique
  const dvfRes = await fetch(
    `/api/dvf?ville=${encodeURIComponent(city)}&mode=estimation&type=${encodeURIComponent(type)}&surface=${surface}&address_lat=${lat}&address_lng=${lng}&insee=${inseeCode}&dept=${dept}`
  );
  if (!dvfRes.ok) throw new Error("API DVF indisponible");
  const dvfData = await dvfRes.json();
  if (dvfData.error) throw new Error(dvfData.error);
  const comparables: any[] = dvfData.transactions || [];

  const prixM2s = comparables
    .map((t: any) => t.valeur_fonciere / t.surface_reelle_bati)
    .filter((p: number) => p > 500 && p < 25000)
    .sort((a: number, b: number) => a - b);

  if (prixM2s.length < 3) throw new Error(`Seulement ${prixM2s.length} vente(s) comparable(s) dans un rayon de ${dvfData.rayon_km || 10} km — essayez une surface différente`);

  const mid = Math.floor(prixM2s.length / 2);
  const median = prixM2s.length % 2 ? prixM2s[mid] : (prixM2s[mid-1] + prixM2s[mid]) / 2;
  const facteur = etat==="neuf"?1.12:etat==="bon"?1.0:etat==="moyen"?0.91:0.77;
  const base = median * surface * facteur;

  return {
    adresse: adresseLabel,
    ville: city,
    lat, lng,
    rayon_km: dvfData.rayon_km || 5,
    nb_comparables: comparables.length,
    prix_m2_median: Math.round(median),
    prix_m2_min: Math.round(prixM2s[0]),
    prix_m2_max: Math.round(prixM2s[prixM2s.length-1]),
    estimation: Math.round(base),
    fourchette_bas: Math.round(base * 0.91),
    fourchette_haut: Math.round(base * 1.09),
    comparables: comparables.slice(0, 8).map((t: any) => ({
      adresse: `${t.adresse_numero||""} ${t.adresse_nom_voie||""}`.trim() || "—",
      surface: t.surface_reelle_bati,
      prix: t.valeur_fonciere,
      prix_m2: Math.round(t.valeur_fonciere / t.surface_reelle_bati),
      date: t.date_mutation?.slice(0, 7) || "",
      distance_m: t.distance_m ?? null,
    })),
  };
}

type CrmStatus = "nouveau"|"courrier_pret"|"envoye"|"relance_prevue"|"interesse"|"estimation"|"mandat"|"perdu";
type Mandat = { id:number; adresse:string; nom_propriete:string; ville:string; prix:number; surface:number; terrain:number; chambres:number; dpe:string; type:string; statut:string; pipeline:string; proprietaire:string; tel:string; email:string; honoraires:number; exclusif:boolean; fin_mandat:string; description:string; signature_request_id?:string; signature_status?:string; };
type SignatureState = { loading:boolean; url?:string; error?:string; sandbox?:boolean; };
type Prospect = { id:any; nom?:string; adresse:string; ville:string; score:number; source:string; status:string; notes:string; lat?:number; lng?:number; anciennete?:number; prix_achat?:number; proprietaire_nom?:string; proprietaire_prenom?:string; civilite?:string; proprietaire_source?:string; proprietaire_chargement?:boolean; type_local?:string; surface?:number; terrain?:number; pieces?:number; crm_status?:CrmStatus; classe_dpe?:string; age_jours?:number; };

function getSalutation(p: Prospect): string {
  if (!p.proprietaire_nom) return "Madame, Monsieur,";
  const nom = p.proprietaire_nom;
  if (p.civilite === "Monsieur" || p.civilite === "Madame") return `${p.civilite} ${nom},`;
  return `Madame, Monsieur ${nom},`;
}

// Standalone letter generator (no API, no AI required)
function generateLetter(p: Prospect, template: string, ag: {prenom:string;nom:string;agence:string}): string {
  const t = p.type_local || (p.source==="DPE"?"bien":"propriété");
  const sc = p.surface ? ` de ${p.surface} m²` : "";
  const tc = p.terrain && p.terrain>0 ? ` avec ${p.terrain} m² de terrain` : "";
  const sal = getSalutation(p);
  const sign = `Cordialement,\n${ag.prenom} ${ag.nom}\nAgent immobilier — ${ag.agence}`;
  if(template==="relance") return `${sal}\n\nJe me permets de revenir vers vous suite à mon précédent courrier concernant votre ${t.toLowerCase()} au ${p.adresse}.\n\nNotre acquéreur est toujours très motivé par ce secteur et l'opportunité reste entière. Je reste disponible pour un échange sans obligation.\n\n${sign}`;
  if(template==="offre") return `${sal}\n\nNous représentons un acquéreur sérieux, financement validé, à la recherche d'un ${t.toLowerCase()}${sc}${tc} dans votre quartier.\n\nVotre bien au ${p.adresse} correspond exactement à ses critères. Cette configuration représente une opportunité rare de conclure rapidement, au juste prix.\n\nNous sommes à votre disposition pour un premier échange confidentiel.\n\n${sign}`;
  return `${sal}\n\n${ag.agence} est une agence immobilière reconnue dans le secteur de ${p.ville}. Nous intervenons régulièrement dans votre quartier et connaissons parfaitement les spécificités du marché local.\n\nVotre ${t.toLowerCase()}${sc} au ${p.adresse} retient notre attention. Nous accompagnons plusieurs acquéreurs sérieux, financement confirmé, à la recherche d'un bien de ce type dans ce secteur précis.\n\nNous vous proposons une estimation gratuite, confidentielle et sans engagement. Si vous envisagez une cession dans les mois à venir, il serait dommage de ne pas explorer ensemble cette opportunité.\n\n${sign}`;
}
type Acheteur = { id:number; nom:string; email:string; tel:string; budget_min:number; budget_max:number; surface_min:number; chambres_min:number; types:string[]; villes:string[]; notes:string; };
type RDV = { id:number; titre:string; client:string; tel:string; date:string; heure:string; duree:number; type:string; bien:string; };
type Msg = { id:number; role:"user"|"agent"; text:string; };
type Transac = { id:number; mandat_id:number; label:string; adresse:string; montant:number; statut:"en_attente"|"encaisse"|"annule"; date_encaissement:string; };
type CourrierModal = { prospect:Prospect; template:string; content:string; loading:boolean; };
type CourrierHistorique = { id:number; prospect_id:any; prospect_adresse:string; prospect_ville:string; date:string; template:string; statut:"envoye"|"repondu"|"relance"; content:string; };

const TRANSACS_INIT: Transac[] = [
  {id:1,mandat_id:1,label:"Villa des Acacias",adresse:"14 rue des Acacias, Bordeaux",montant:24250,statut:"en_attente",date_encaissement:""},
  {id:2,mandat_id:2,label:"Victor Hugo",adresse:"32 cours Victor Hugo, Bordeaux",montant:14250,statut:"en_attente",date_encaissement:""},
  {id:3,mandat_id:3,label:"Les Pins",adresse:"7 allée des Pins, Mérignac",montant:33000,statut:"en_attente",date_encaissement:""},
];

const MANDATS: Mandat[] = [
  {id:1,adresse:"14 rue des Acacias",nom_propriete:"Villa des Acacias",ville:"Bordeaux",prix:485000,surface:142,terrain:620,chambres:4,dpe:"C",type:"Maison",statut:"signe",pipeline:"signe",proprietaire:"Marie Dupont",tel:"06 12 34 56 78",email:"m.dupont@email.fr",honoraires:5,exclusif:true,fin_mandat:"15/07/2026",description:"Belle villa avec jardin paysagé, garage double, cuisine équipée. Quartier calme et résidentiel."},
  {id:2,adresse:"32 cours Victor Hugo",nom_propriete:"Victor Hugo",ville:"Bordeaux",prix:285000,surface:78,terrain:0,chambres:3,dpe:"D",type:"Appartement",statut:"signe",pipeline:"negociation",proprietaire:"Pierre Leblanc",tel:"06 98 76 54 32",email:"p.leblanc@email.fr",honoraires:5,exclusif:false,fin_mandat:"30/06/2026",description:"Appartement centre-ville lumineux, parquet ancien, balcon filant."},
  {id:3,adresse:"7 allée des Pins",nom_propriete:"Les Pins",ville:"Mérignac",prix:550000,surface:185,terrain:800,chambres:5,dpe:"B",type:"Maison",statut:"en_cours",pipeline:"prospect",proprietaire:"Sophie Martin",tel:"06 55 44 33 22",email:"s.martin@email.fr",honoraires:6,exclusif:true,fin_mandat:"01/09/2026",description:"Grande villa contemporaine avec piscine chauffée, home cinéma, suite parentale."},
];
const PROSPECTS: Prospect[] = [
  {id:1,nom:"Jean Bernard",adresse:"22 rue Gambetta, Bordeaux",ville:"Bordeaux",score:94,source:"DVF",status:"À contacter",notes:"Acheté en 2013 · 145m² · 320 000€ · Ancienneté idéale"},
  {id:2,nom:"Claire Moreau",adresse:"8 bd Maréchal Foch, Mérignac",ville:"Mérignac",score:87,source:"DPE",status:"À contacter",notes:"DPE réalisé jan. 2026 · Signal de vente fort"},
  {id:3,nom:"François Petit",adresse:"45 rue des Fleurs, Pessac",ville:"Pessac",score:72,source:"DVF",status:"À surveiller",notes:"Acheté en 2016 · 98m²"},
];
const ACHETEURS: Acheteur[] = [
  {id:1,nom:"Thomas Lefebvre",email:"t.lefebvre@gmail.com",tel:"06 11 22 33 44",budget_min:400000,budget_max:550000,surface_min:120,chambres_min:4,types:["Maison"],villes:["Bordeaux","Mérignac"],notes:"Recherche depuis 6 mois, très motivé"},
  {id:2,nom:"Claire & Julien Moreau",email:"moreau.cj@email.fr",tel:"06 77 88 99 00",budget_min:250000,budget_max:320000,surface_min:70,chambres_min:3,types:["Appartement"],villes:["Bordeaux"],notes:"Premier achat, pré-accord bancaire obtenu"},
];
const PIPELINE_COLS = [{id:"prospect",label:"Prospect",color:"#94A3B8"},{id:"estimation",label:"Estimation",color:"#F59E0B"},{id:"negociation",label:"Négociation",color:"#8B5CF6"},{id:"signe",label:"Signé",color:"#10B981"},{id:"vendu",label:"Vendu",color:"#3B82F6"}];
const fmt = (n:number) => n?.toLocaleString("fr-FR") || "0";

export default function App() {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [nav, setNav] = useState("prospects");
  const [mandats, setMandats] = useState<Mandat[]>(()=>{
    if(typeof window==="undefined") return MANDATS;
    try{const s=localStorage.getItem("m_mandats");return s?JSON.parse(s):MANDATS;}catch{return MANDATS;}
  });
  const [prospects, setProspects] = useState<Prospect[]>(PROSPECTS);
  const [dvfLoading, setDvfLoading] = useState(false);
  const [dvfError, setDvfError] = useState("");
  const [mapCenter, setMapCenter] = useState<[number,number]>([44.837, -0.579]);
  const [selProspect, setSelProspect] = useState<Prospect|null>(null);
  const [mapFlyTo, setMapFlyTo] = useState<{lat:number;lng:number;zoom:number;key:any}|null>(null);
  const [acheteurs, setAcheteurs] = useState<Acheteur[]>(()=>{
    if(typeof window==="undefined") return ACHETEURS;
    try{const s=localStorage.getItem("m_acheteurs");return s?JSON.parse(s):ACHETEURS;}catch{return ACHETEURS;}
  });
  const [acheteurForm, setAcheteurForm] = useState<Partial<Acheteur>|null>(null);
  const RDV_INIT: RDV[] = [
    {id:1,titre:"Visite Villa des Acacias",client:"Thomas Lefebvre",tel:"06 11 22 33 44",date:"2026-05-14",heure:"10:00",duree:60,type:"visite",bien:"14 rue des Acacias"},
    {id:2,titre:"Signature mandat",client:"Sophie Martin",tel:"06 55 44 33 22",date:"2026-05-15",heure:"14:00",duree:90,type:"signature",bien:"7 allée des Pins"},
  ];
  const [rdvs, setRdvs] = useState<RDV[]>(()=>{
    if(typeof window==="undefined") return RDV_INIT;
    try{const s=localStorage.getItem("m_rdvs");return s?JSON.parse(s):RDV_INIT;}catch{return RDV_INIT;}
  });
  const [rdvForm, setRdvForm] = useState<Partial<RDV>|null>(null);
  const [selM, setSelM] = useState<Mandat|null>(null);
  const [chat, setChat] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{id:1,role:"agent",text:"Bonjour. 3 mandats actifs, 2 rendez-vous cette semaine. Comment puis-je vous aider ?"}]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [drag, setDrag] = useState<number|null>(null);
  const [dragOver, setDragOver] = useState<string|null>(null);
  const [prospSecteur, setProspSecteur] = useState("");
  const [prospMethod, setProspMethod] = useState("");
  const [banSugg, setBanSugg] = useState<{city:string;citycode:string;dept:string}[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const banDebounce = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [prospFilter, setProspFilter] = useState<"tous"|"dpe-recent"|"dpe-fg"|"dvf"|"contactes">("tous");
  const [prospCrm, setProspCrm] = useState<Record<string,"contacte"|"repondu"|"sans_suite">>(()=>{
    if(typeof window==="undefined") return {};
    try{return JSON.parse(localStorage.getItem("m_prosp_crm")||"{}");}catch{return {};}
  });
  const [profile, setProfile] = useState(false);
  // Estimation
  const [estForm, setEstForm] = useState({type:"Maison",surface:"",adresse:"",etat:"bon"});
  const [estResult, setEstResult] = useState<any>(null);
  const [estLoading, setEstLoading] = useState(false);
  const [estError, setEstError] = useState("");
  // Comptabilité
  const [transacs, setTransacs] = useState<Transac[]>(()=>{
    if(typeof window==="undefined") return TRANSACS_INIT;
    try{const s=localStorage.getItem("m_transacs");return s?JSON.parse(s):TRANSACS_INIT;}catch{return TRANSACS_INIT;}
  });
  // Courrier modal
  const [courrier, setCourrier] = useState<CourrierModal|null>(null);
  // Courrier historique
  const [courrierHisto, setCourrierHisto] = useState<CourrierHistorique[]>(()=>{
    if(typeof window==="undefined") return [];
    try{const s=localStorage.getItem("m_courriers");return s?JSON.parse(s):[];}catch{return [];}
  });
  // Propriétaire lookup
  const [propData, setPropData] = useState<Record<string,any>>({});
  const [propLoading, setPropLoading] = useState<string|null>(null);
  // Street View modal
  const [svModal, setSvModal] = useState<{lat:number;lng:number;adresse:string}|null>(null);
  // Sélection prospects pour envoi batch
  const [selProspects, setSelProspects] = useState<Set<any>>(new Set());
  // Stats dernière prospection + per-source status
  const [dvfStats, setDvfStats] = useState<{dvf:number;dpe:number}|null>(null);
  const [srcStatus, setSrcStatus] = useState<{dvf:"idle"|"loading"|"ok"|"err", dpe:"idle"|"loading"|"ok"|"err", enrichir:"idle"|"loading"|"ok"}>({dvf:"idle",dpe:"idle",enrichir:"idle"});
  // Merci Facteur envoi en cours
  const [mfSending, setMfSending] = useState(false);
  const [mfResult, setMfResult] = useState<{ok:number;err:number}|null>(null);
  // Auto-courrier (right panel in prospection)
  const [autoCourrierContent, setAutoCourrierContent] = useState("");
  const [autoCourrierLoading, setAutoCourrierLoading] = useState(false);
  const [autoCourrierTemplate, setAutoCourrierTemplate] = useState("prospection");
  const [autoMfSending, setAutoMfSending] = useState(false);
  const [autoMfDone, setAutoMfDone] = useState<"ok"|"err"|null>(null);
  // Veille concurrence
  const [annonceVille, setAnnonceVille] = useState("");
  const [annonces, setAnnonces] = useState<any[]>([]);
  const [annoncesLoading, setAnnoncesLoading] = useState(false);
  const [annoncesError, setAnnoncesError] = useState("");
  const [annoncesTypeFilter, setAnnoncesTypeFilter] = useState<""|"Maison"|"Appartement">("");
  const [annoncesSort, setAnnoncesSort] = useState<"prix_asc"|"prix_desc"|"surface_desc">("prix_asc");
  const [selAnnonce, setSelAnnonce] = useState<any>(null);
  const [annoncePhotoIdx, setAnnoncePhotoIdx] = useState(0);
  const [annonceShowDesc, setAnnonceShowDesc] = useState(false);
  const [cardPhotoIdx, setCardPhotoIdx] = useState<Record<string,number>>({});
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchResult, setMatchResult] = useState<any>(null);
  const [fullDossierLoading, setFullDossierLoading] = useState(false);
  const [fullDossierResult, setFullDossierResult] = useState<any>(null);
  // Veille — mode "Analyser une annonce" (saisie libre)
  const [veilleMode, setVeilleMode] = useState<"recherche"|"analyser">("recherche");
  const [analyserForm, setAnalyserForm] = useState({
    ville:"", cp:"", type:"Maison" as "Maison"|"Appartement", surface:"", terrain:"",
    description:"", photoUrls:"",
  });
  const [analyserLoading, setAnalyserLoading] = useState(false);
  const [analyserResult, setAnalyserResult] = useState<any>(null);
  const [analyserFullDossier, setAnalyserFullDossier] = useState<any>(null);
  const [analyserFullLoading, setAnalyserFullLoading] = useState(false);
  // Email modal
  type EmailModal = {to:string; sujet:string; corps:string; loading:boolean; sending?:boolean; sent?:boolean; sendError?:string};
  const [emailModal, setEmailModal] = useState<EmailModal|null>(null);
  // Supabase auth
  const [user, setUser] = useState<any>(null);
  // Yousign signature
  const [sigState, setSigState] = useState<Record<number,SignatureState>>({});
  // Stripe subscription
  const [stripeModal, setStripeModal] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeMsg, setStripeMsg] = useState("");
  const [subStatus, setSubStatus] = useState<"active"|"trialing"|"inactive"|"">("");
  // Radar — Mode 1 prospection automatique
  const [radarVilles, setRadarVilles] = useState<string[]>(()=>{
    if(typeof window==="undefined") return [];
    try{return JSON.parse(localStorage.getItem("m_radar_villes")||"[]");}catch{return [];}
  });
  const [radarVilleInput, setRadarVilleInput] = useState("");
  const [radarProspects, setRadarProspects] = useState<Prospect[]>([]);
  const [radarIdx, setRadarIdx] = useState(0);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarDone, setRadarDone] = useState<Set<string>>(new Set());
  const [radarLetter, setRadarLetter] = useState("");
  const [radarLetterLoading, setRadarLetterLoading] = useState(false);
  const [radarLetterTemplate, setRadarLetterTemplate] = useState("prospection");
  const [radarView, setRadarView] = useState<"cards"|"map">("cards");
  const [dpeMapLoading, setDpeMapLoading] = useState(false);
  const [radarSelected, setRadarSelected] = useState<any>(null);
  const [radarLayers, setRadarLayers] = useState({ parcelles: true, ventes: true, proprietaires: false, dpe: true });
  const [radarParcelPanel, setRadarParcelPanel] = useState<{
    properties: any; centroid: [number,number]; matching: any[];
    address: string|null; owner: any|null; ownerLoading: boolean;
  }|null>(null);
  const [parcelTab, setParcelTab] = useState<"ventes"|"proprietaires"|"dpe">("proprietaires");
  const [radarBasket, setRadarBasket] = useState<Record<string,{prospect:any;liked:boolean;dateSent?:string}>>(() => {
    if(typeof window==="undefined") return {};
    try{return JSON.parse(localStorage.getItem("m_radar_basket")||"{}");}catch{return {};}
  });
  // Gamification
  const [courriersSent, setCourriersSent] = useState(()=>{
    if(typeof window==="undefined") return 0;
    return parseInt(localStorage.getItem("m_sent_count")||"0");
  });
  const [mandatsFromProsp, setMandatsFromProsp] = useState(()=>{
    if(typeof window==="undefined") return 0;
    return parseInt(localStorage.getItem("m_mandats_prosp")||"0");
  });
  const [streakDays, setStreakDays] = useState(1);
  // CRM statuses for all prospects (id → status)
  const [crmStatuses, setCrmStatuses] = useState<Record<string,CrmStatus>>(()=>{
    if(typeof window==="undefined") return {};
    try{return JSON.parse(localStorage.getItem("m_crm_statuses")||"{}");}catch{return {};}
  });
  const AGENT_DEFAULT = {prenom:"Jean",nom:"Dupont",agence:"Agence Prestige Immobilier",email:"jean@agence.fr"};
  const [agent, setAgent] = useState(()=>{
    if(typeof window==="undefined") return AGENT_DEFAULT;
    try{const s=localStorage.getItem("m_agent");return s?JSON.parse(s):AGENT_DEFAULT;}catch{return AGENT_DEFAULT;}
  });
  const [onboarding, setOnboarding] = useState(() => typeof window!=="undefined"?!localStorage.getItem("m_setup"):true);
  const [obStep, setObStep] = useState(0);
  const [obData, setObData] = useState({prenom:"",nom:"",agence:"",email:""});
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[msgs]);
  // Persist on change
  useEffect(()=>{localStorage.setItem("m_mandats",JSON.stringify(mandats));},[mandats]);
  useEffect(()=>{localStorage.setItem("m_transacs",JSON.stringify(transacs));},[transacs]);
  useEffect(()=>{localStorage.setItem("m_acheteurs",JSON.stringify(acheteurs));},[acheteurs]);
  useEffect(()=>{localStorage.setItem("m_rdvs",JSON.stringify(rdvs));},[rdvs]);
  useEffect(()=>{localStorage.setItem("m_courriers",JSON.stringify(courrierHisto));},[courrierHisto]);
  useEffect(()=>{localStorage.setItem("m_radar_villes",JSON.stringify(radarVilles));},[radarVilles]);
  useEffect(()=>{localStorage.setItem("m_radar_basket",JSON.stringify(radarBasket));},[radarBasket]);
  useEffect(()=>{localStorage.setItem("m_crm_statuses",JSON.stringify(crmStatuses));},[crmStatuses]);
  useEffect(()=>{localStorage.setItem("m_prosp_crm",JSON.stringify(prospCrm));},[prospCrm]);
  useEffect(()=>{localStorage.setItem("m_sent_count",String(courriersSent));},[courriersSent]);
  useEffect(()=>{localStorage.setItem("m_mandats_prosp",String(mandatsFromProsp));},[mandatsFromProsp]);
  // Streak calculation on mount
  useEffect(()=>{
    const today = new Date().toDateString();
    const last = localStorage.getItem("m_last_visit");
    const savedStreak = parseInt(localStorage.getItem("m_streak")||"1");
    if(!last){setStreakDays(1);}
    else if(last===today){setStreakDays(savedStreak);}
    else{
      const diff = Math.round((new Date(today).getTime()-new Date(last).getTime())/(86400000));
      const newStreak = diff===1?savedStreak+1:1;
      setStreakDays(newStreak);
      localStorage.setItem("m_streak",String(newStreak));
    }
    localStorage.setItem("m_last_visit",today);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Stripe: handle return from checkout
  useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    if(p.get("stripe")==="success") {
      setSubStatus("active");
      setStripeMsg("Abonnement activé — bienvenue dans Mandatly Pro !");
      window.history.replaceState({}, "", window.location.pathname);
    }
  },[]);

  // Supabase: load user + data on mount
  useEffect(()=>{
    const init = async () => {
      const supabase = createBrowserClient();
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) setUser(u);
      const data = await loadUserData();
      if (!data) return;
      if (data.mandats?.length) setMandats(data.mandats);
      if (data.acheteurs?.length) setAcheteurs(data.acheteurs);
      if (data.rdvs?.length) setRdvs(data.rdvs);
      if (data.transacs?.length) setTransacs(data.transacs);
      if (data.courriers?.length) setCourrierHisto(data.courriers);
      if (data.agent?.prenom) setAgent(data.agent);
      if (data.radar_villes?.length) setRadarVilles(data.radar_villes);
      if (data.crm_statuses && Object.keys(data.crm_statuses).length) setCrmStatuses(data.crm_statuses);
      if (data.prosp_crm && Object.keys(data.prosp_crm).length) setProspCrm(data.prosp_crm);
      if (data.sent_count) setCourriersSent(data.sent_count);
      if (data.mandats_prosp) setMandatsFromProsp(data.mandats_prosp);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Supabase: debounced sync on any data change
  const syncTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    if (!user) return;
    if(syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async()=>{
      await saveUserData({ mandats, acheteurs, rdvs, transacs, courriers: courrierHisto, agent, radar_villes: radarVilles, crm_statuses: crmStatuses, prosp_crm: prospCrm, sent_count: courriersSent, mandats_prosp: mandatsFromProsp });
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mandats, acheteurs, rdvs, transacs, courrierHisto, agent, radarVilles, crmStatuses, prospCrm, courriersSent, mandatsFromProsp]);

  // Auto-generate courrier when a prospect is selected in prospection tab
  useEffect(()=>{
    if(!selProspect) { setAutoCourrierContent(""); setAutoCourrierLoading(false); setAutoMfDone(null); return; }
    setAutoCourrierLoading(true); setAutoCourrierContent(""); setAutoMfDone(null);
    const p = selProspect;
    const nomCtx = p.proprietaire_nom ? ` Le propriétaire identifié est ${p.proprietaire_nom}${p.proprietaire_source ? " (source : "+p.proprietaire_source+")" : ""}.` : "";
    const typeLabel = p.type_local || (p.source==="DPE"?"bien":"propriété");
    const surfaceCtx = p.surface ? ` de ${p.surface} m²` : "";
    const terrainCtx = p.terrain && p.terrain>0 ? ` avec ${p.terrain} m² de terrain` : "";
    const ancCtx = p.anciennete ? ` acquis il y a ${p.anciennete} ans` : "";
    const salutation = getSalutation(p);
    const templatePrompts: Record<string,string> = {
      prospection: `Rédige un courrier de prospection immobilière sobre et professionnel pour un propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx}${terrainCtx}${ancCtx} au ${p.adresse}, ${p.ville}.${nomCtx} Tu représentes ${agent.prenom} ${agent.nom} de ${agent.agence}. Adopte le ton d'une agence haut de gamme : confiant, direct, sans être agressif. Ne mentionne jamais de DPE ou de données publiques. 3 paragraphes. Commence obligatoirement par "${salutation}"`,
      relance: `Rédige un courrier de relance pour un propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx} au ${p.adresse}, ${p.ville} contacté il y a 3 semaines sans réponse.${nomCtx} Signe en tant que ${agent.prenom} ${agent.nom}, ${agent.agence}. Ton : bienveillant, sans pression. 2 paragraphes. Commence obligatoirement par "${salutation}"`,
      offre: `Rédige un courrier informant le propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx}${terrainCtx} au ${p.adresse}, ${p.ville} qu'un acquéreur sérieux avec financement confirmé recherche exactement ce type de bien dans ce secteur.${nomCtx} Signe: ${agent.prenom} ${agent.nom}, ${agent.agence}. Sobre, crédible. Commence obligatoirement par "${salutation}"`,
    };
    const fallback: Record<string,string> = {
      prospection: `${salutation}\n\n${agent.agence} est une agence immobilière reconnue dans le secteur de ${p.ville} et ses alentours. Nous intervenons régulièrement dans votre quartier et connaissons parfaitement les spécificités du marché local.\n\nVotre ${typeLabel.toLowerCase()}${surfaceCtx} au ${p.adresse} retient notre attention. Dans le contexte actuel, nous accompagnons plusieurs acquéreurs sérieux, avec financement confirmé, à la recherche d'un bien de ce type dans ce secteur précis.\n\nNous vous proposons une estimation gratuite, confidentielle et sans engagement. Si vous envisagez une cession dans les mois à venir, il serait dommage de ne pas explorer ensemble cette opportunité.\n\nCordialement,\n${agent.prenom} ${agent.nom}\nAgent immobilier — ${agent.agence}`,
      relance: `${salutation}\n\nJe me permets de revenir vers vous suite à mon précédent courrier concernant votre ${typeLabel.toLowerCase()} au ${p.adresse}.\n\nNotre acheteur est toujours très motivé par ce secteur, et l'opportunité reste entière. Si vous avez eu l'occasion de réfléchir à votre situation, je reste disponible pour un échange sans obligation.\n\nCordialement,\n${agent.prenom} ${agent.nom}\n${agent.agence}`,
      offre: `${salutation}\n\nNous représentons un acquéreur sérieux, dont le projet est précisément défini et le financement validé, à la recherche d'un ${typeLabel.toLowerCase()}${surfaceCtx}${terrainCtx} dans votre quartier.\n\nVotre bien au ${p.adresse} correspond exactement à ses critères. Si vous envisagez de vendre, cette configuration représente une opportunité rare de conclure une transaction rapide, au juste prix, sans délai de commercialisation prolongé.\n\nNous sommes à votre disposition pour un premier échange confidentiel.\n\nCordialement,\n${agent.prenom} ${agent.nom}\nAgent immobilier — ${agent.agence}`,
    };
    fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      system:`Tu es Lucas, assistant IA de ${agent.prenom} ${agent.nom} chez ${agent.agence}. Tu rédiges uniquement le texte du courrier, sans introduction ni explication supplémentaire.`,
      messages:[{role:"user",content:templatePrompts[autoCourrierTemplate]||templatePrompts.prospection}],
      max_tokens:700
    })})
    .then(r=>r.json())
    .then(d=>{
      const txt = d.content?.[0]?.text;
      if(txt) { setAutoCourrierContent(txt); }
      else { setAutoCourrierContent(fallback[autoCourrierTemplate]||fallback.prospection); }
      setAutoCourrierLoading(false);
    })
    .catch(()=>{ setAutoCourrierContent(fallback[autoCourrierTemplate]||fallback.prospection); setAutoCourrierLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selProspect?.id, autoCourrierTemplate]);

  const C = dark ? {
    // Marine élégant — nuit
    bg:"#07111F",surface:"#0C1929",card:"#111E2E",border:"#1C2F45",border2:"#243A54",
    text:"#EDE8DC",muted:"#566480",soft:"#7289A6",
    accent:"#C4A35A",accentBg:"rgba(196,163,90,0.08)",
    green:"#3DAB74",red:"#C05040",amber:"#C4873A",blue:"#5B8CCC",purple:"#8B6FC0",
    gold:"#C4A35A",navy:"#5B8CCC",
    shadow:"rgba(0,0,0,0.7)"
  }:{
    // Blanc ivoire — prestige
    bg:"#FFFFFF",surface:"#F8F6F1",card:"#FFFFFF",border:"#EAE5D8",border2:"#D6CFBF",
    text:"#14213D",muted:"#8A8372",soft:"#5C5747",
    accent:"#14213D",accentBg:"rgba(20,33,61,0.05)",
    green:"#2A6647",red:"#A83228",amber:"#B5762A",blue:"#14213D",purple:"#4A3564",
    gold:"#C4A35A",navy:"#14213D",
    shadow:"rgba(20,33,61,0.10)"
  };

  const DISPLAY = "var(--font-display), 'Cormorant Garamond', Georgia, serif";
  const BODY = "var(--font-body), 'DM Sans', -apple-system, sans-serif";

  const card = (p:any={}) => ({
    background:C.card,
    border:`1px solid ${C.border}`,
    borderRadius:10,
    boxShadow:`0 1px 3px ${C.shadow}, 0 4px 16px rgba(20,33,61,0.04)`,
    ...p
  });

  // Progressive background enrichment: top 30 premiers prospects (Sirene + Cadastre IGN)
  const enrichirProspects = useCallback(async (list: Prospect[]) => {
    const withCoords = list.filter(p => p.lat && p.lng).slice(0, 30);
    if (!withCoords.length) return;
    setSrcStatus(s => ({...s, enrichir:"loading"}));
    setProspects(prev => prev.map(p => withCoords.find(x => x.id === p.id) ? {...p, proprietaire_chargement: true} : p));
    // Batches of 5 en parallèle pour aller plus vite
    for (let i = 0; i < withCoords.length; i += 5) {
      const batch = withCoords.slice(i, i + 5);
      await Promise.allSettled(batch.map(async (p) => {
        try {
          // Strip postal code from DPE addresses like "119 Rue Lagrange 33000 Bordeaux"
          const cleanAddr = p.adresse.replace(/\b\d{5}\b\s*/g, "").trim();
          const adrsQuery = cleanAddr.toLowerCase().includes(p.ville.toLowerCase()) ? cleanAddr : `${cleanAddr} ${p.ville}`;
          const r = await fetch(`/api/proprietaire?lat=${p.lat}&lng=${p.lng}&adresse=${encodeURIComponent(adrsQuery)}`);
          if (!r.ok) return;
          const d = await r.json();
          setProspects(prev => prev.map(x => x.id === p.id ? {
            ...x,
            proprietaire_nom: d.proprietaire_nom || "",
            proprietaire_prenom: d.proprietaire_prenom || "",
            civilite: d.civilite || "",
            proprietaire_source: d.proprietaire_source || "inconnu",
            proprietaire_chargement: false,
          } : x));
          setPropData(prev => ({...prev, [String(p.id)]: d}));
        } catch {
          setProspects(prev => prev.map(x => x.id === p.id ? {...x, proprietaire_chargement: false} : x));
        }
      }));
    }
    setSrcStatus(s => ({...s, enrichir:"ok"}));
  }, []);

  // ── Prospection unifiée : DVF + DPE en parallèle avec statut par source
  const handleProspect = useCallback(async (ville: string, insee?: string) => {
    if (!ville.trim()) return;
    setDvfLoading(true);
    setDvfError("");
    setSelProspect(null);
    setProspects([]);
    setSelProspects(new Set());
    setDvfStats(null);
    setShowSugg(false);
    setProspFilter("tous");
    setSrcStatus({dvf:"loading", dpe:"loading", enrichir:"idle"});

    // Lance DVF + DPE en parallèle (passe l'INSEE direct si dispo → évite ambiguïté)
    const dvfUrl = insee
      ? `/api/dvf?ville=${encodeURIComponent(ville)}&insee=${encodeURIComponent(insee)}`
      : `/api/dvf?ville=${encodeURIComponent(ville)}`;
    const dpeUrl = insee
      ? `/api/dpe?commune=${encodeURIComponent(ville)}&insee=${encodeURIComponent(insee)}`
      : `/api/dpe?commune=${encodeURIComponent(ville)}`;
    const [dvfResult, dpeResult] = await Promise.allSettled([
      fetch(dvfUrl).then(r => r.json()),
      fetch(dpeUrl).then(r => r.json()),
    ]);

    const dvfData = dvfResult.status === "fulfilled" ? dvfResult.value : null;
    const dpeData = dpeResult.status === "fulfilled" ? dpeResult.value : null;

    if (!dvfData || dvfData.error) {
      setDvfError(dvfData?.error || "Ville introuvable — vérifiez l'orthographe");
      setDvfLoading(false);
      setSrcStatus({dvf:"err", dpe:"idle", enrichir:"idle"});
      return;
    }

    setSrcStatus(s => ({...s, dvf:"ok"}));

    // Re-fetch DPE avec code INSEE précis si DPE initial a raté
    let dpeProspects: any[] = dpeData?.prospects || [];
    if (dvfData.insee && dpeProspects.length === 0) {
      try {
        const r = await fetch(`/api/dpe?commune=${encodeURIComponent(dvfData.ville)}&insee=${dvfData.insee}`);
        if (r.ok) { const d = await r.json(); dpeProspects = d.prospects || []; }
      } catch {}
    }
    setSrcStatus(s => ({...s, dpe: dpeProspects.length > 0 ? "ok" : "ok"}));

    const allProspects = [...(dvfData.prospects || []), ...dpeProspects]
      .sort((a: any, b: any) => b.score - a.score);

    setProspects(allProspects);
    setMapCenter([parseFloat(dvfData.lat), parseFloat(dvfData.lng)]);
    setDvfStats({dvf: dvfData.prospects?.length || 0, dpe: dpeProspects.length});
    setDvfLoading(false);

    // Enrichissement Sirene + Cadastre pour le top 30
    enrichirProspects(allProspects);
  }, [enrichirProspects]);

  const handleAnnonces = useCallback(async (ville: string) => {
    if (!ville.trim() || annoncesLoading) return;
    setAnnoncesLoading(true); setAnnoncesError(""); setAnnonces([]);
    try {
      const r = await fetch(`/api/annonces?ville=${encodeURIComponent(ville)}&size=300`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAnnonces(d.annonces || []);
    } catch (err: any) { setAnnoncesError(err.message || "Erreur"); }
    setAnnoncesLoading(false);
  }, [annoncesLoading]);

  const handleMatchAnnonce = useCallback(async (annonce: any) => {
    if (!annonce?.lat || !annonce?.lng) return;
    setMatchLoading(true); setMatchResult(null); setFullDossierResult(null); setFullDossierLoading(false);
    try {
      // Fetch photos client-side (browser can download them, server cannot due to referer blocking)
      const photos: string[] = [];
      for (const url of (annonce.photos || []).slice(0, 5)) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 8000) continue;
          // Chunked btoa — évite le crash stack pour les images > 200KB
          const bytes = new Uint8Array(buf);
          let binary = "";
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          photos.push(btoa(binary));
          if (photos.length >= 3) break;
        } catch {}
      }
      const r = await fetch("/api/match-annonce", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          lat: annonce.lat,
          lng: annonce.lng,
          surface: annonce.surface || 100,
          terrain: annonce.terrain || 0,
          type: annonce.type || "Maison",
          ville: annonce.ville || "",
          cp: annonce.cp || "",
          titre: annonce.titre || "",
          description: annonce.description || "",
          photos,
        }),
      });
      const d = await r.json();
      setMatchResult(d);
    } catch (e: any) {
      setMatchResult({ error: e.message || "Erreur" });
    }
    setMatchLoading(false);
  }, []);

  const handleAnalyserAnnonce = useCallback(async () => {
    const f = analyserForm;
    if (!f.ville.trim() || !f.surface) return;
    setAnalyserLoading(true); setAnalyserResult(null); setAnalyserFullDossier(null);
    try {
      // Géocoder la ville pour obtenir lat/lng + INSEE
      const banRes = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(f.ville+(f.cp?` ${f.cp}`:""))}&type=municipality&limit=1`);
      const banData = await banRes.json();
      const feat = banData.features?.[0];
      if (!feat) throw new Error("Ville introuvable — vérifiez le nom");
      const [lng, lat] = feat.geometry.coordinates as [number, number];

      // Fetch photos depuis les URLs (côté navigateur)
      const photoUrls = f.photoUrls.split(/[\n,]+/).map((u:string)=>u.trim()).filter(Boolean).slice(0, 5);
      const photos: string[] = [];
      for (const url of photoUrls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 8000) continue;
          const bytes = new Uint8Array(buf);
          let binary = "";
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          photos.push(btoa(binary));
          if (photos.length >= 3) break;
        } catch {}
      }

      const r = await fetch("/api/match-annonce", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          lat, lng,
          surface: parseFloat(f.surface) || 100,
          terrain: parseFloat(f.terrain) || 0,
          type: f.type,
          ville: feat.properties.city || f.ville,
          cp: f.cp || feat.properties.postcode || "",
          description: f.description,
          photos,
        }),
      });
      setAnalyserResult(await r.json());
    } catch (e: any) {
      setAnalyserResult({ error: e.message || "Erreur" });
    }
    setAnalyserLoading(false);
  }, [analyserForm]);

  const loadRadar = useCallback(async () => {
    if (!radarVilles.length) return;
    setRadarLoading(true); setRadarProspects([]); setRadarIdx(0); setRadarSelected(null);
    const all: Prospect[] = [];
    for (const v of radarVilles) {
      try {
        const [dvfR, dpeR] = await Promise.allSettled([
          fetch(`/api/dvf?ville=${encodeURIComponent(v)}`).then(r=>r.json()),
          fetch(`/api/dpe?commune=${encodeURIComponent(v)}`).then(r=>r.json()),
        ]);
        if(dvfR.status==="fulfilled"&&!dvfR.value.error) all.push(...(dvfR.value.prospects||[]));
        if(dpeR.status==="fulfilled"&&!dpeR.value.error) all.push(...(dpeR.value.prospects||[]));
      } catch{}
    }
    const sorted = all
      .filter(p=>!radarDone.has(String(p.id)))
      .sort((a,b)=>b.score-a.score);
    setRadarProspects(sorted);
    setRadarLoading(false);
    setRadarView("map");
    // Enrichissement propriétaire en arrière-plan sur les 20 premiers
    const toEnrich = sorted.filter(p => p.lat && p.lng).slice(0, 20);
    for (let i = 0; i < toEnrich.length; i += 4) {
      const batch = toEnrich.slice(i, i + 4);
      await Promise.allSettled(batch.map(async (p) => {
        try {
          const cleanAddr = p.adresse.replace(/\b\d{5}\b\s*/g, "").trim();
          const q = cleanAddr.toLowerCase().includes(p.ville.toLowerCase()) ? cleanAddr : `${cleanAddr} ${p.ville}`;
          const r = await fetch(`/api/proprietaire?lat=${p.lat}&lng=${p.lng}&adresse=${encodeURIComponent(q)}`);
          if (!r.ok) return;
          const d = await r.json();
          if (!d.proprietaire_nom) return;
          setRadarProspects(prev => prev.map(x => x.id === p.id ? {
            ...x,
            proprietaire_nom: d.proprietaire_nom,
            proprietaire_prenom: d.proprietaire_prenom || "",
            civilite: d.civilite || "",
            proprietaire_source: d.proprietaire_source || "",
          } : x));
        } catch {}
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarVilles, radarDone, radarLetterTemplate, agent]);

  const loadDpeOnly = useCallback(async () => {
    if (!radarVilles.length) return;
    setDpeMapLoading(true);
    const all: Prospect[] = [];
    for (const v of radarVilles) {
      try {
        const dpeR = await fetch(`/api/dpe?commune=${encodeURIComponent(v)}`).then(r => r.json());
        if (!dpeR.error) all.push(...(dpeR.prospects || []));
      } catch {}
    }
    const sorted = all
      .filter(p => p.lat && p.lng)
      .sort((a: any, b: any) => (a.age_jours ?? 999) - (b.age_jours ?? 999));
    setRadarProspects(sorted);
    setRadarView("map");
    setDpeMapLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarVilles]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const generateRadarLetterFn = useCallback(async (p: Prospect, template: string) => {
    setRadarLetterLoading(true);
    setRadarLetter("");
    const typeLabel = p.type_local || (p.source==="DPE"?"bien":"propriété");
    const surfaceCtx = p.surface ? ` de ${p.surface} m²` : "";
    const terrainCtx = p.terrain && p.terrain>0 ? ` avec ${p.terrain} m² de terrain` : "";
    const ancCtx = p.anciennete ? ` acquis il y a ${p.anciennete} ans` : "";
    const nomCtx = p.proprietaire_nom ? ` Le propriétaire identifié est ${p.proprietaire_nom}.` : "";
    const sal = getSalutation(p);
    const prompts: Record<string,string> = {
      prospection: `Rédige un courrier de prospection immobilière sobre et professionnel pour un propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx}${terrainCtx}${ancCtx} au ${p.adresse}, ${p.ville}.${nomCtx} Tu représentes ${agent.prenom} ${agent.nom} de ${agent.agence}. 3 paragraphes. Commence obligatoirement par "${sal}"`,
      relance: `Rédige un courrier de relance pour un propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx} au ${p.adresse}, ${p.ville} contacté il y a 3 semaines sans réponse.${nomCtx} Signe en tant que ${agent.prenom} ${agent.nom}, ${agent.agence}. 2 paragraphes. Commence obligatoirement par "${sal}"`,
      offre: `Rédige un courrier informant le propriétaire d'${typeLabel.toLowerCase()}${surfaceCtx}${terrainCtx} au ${p.adresse}, ${p.ville} qu'un acquéreur sérieux avec financement confirmé recherche ce type de bien.${nomCtx} Signe: ${agent.prenom} ${agent.nom}, ${agent.agence}. Commence obligatoirement par "${sal}"`,
    };
    try {
      const res = await fetch("/api/claude", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({
        system:`Tu es Lucas, assistant IA de ${agent.prenom} ${agent.nom} chez ${agent.agence}. Réponds uniquement avec le texte du courrier, sans introduction ni explication.`,
        messages:[{role:"user",content:prompts[template]||prompts.prospection}],
        max_tokens:600
      })});
      const d = await res.json();
      const txt = d.content?.[0]?.text;
      setRadarLetter(txt || generateLetter(p, template, agent));
    } catch {
      setRadarLetter(generateLetter(p, template, agent));
    }
    setRadarLetterLoading(false);
  }, [agent]);

  // Regénère la lettre quand le nom du propriétaire arrive sur le prospect courant
  const radarCurrentId = radarProspects[radarIdx]?.id;
  const radarCurrentNom = radarProspects[radarIdx]?.proprietaire_nom;
  useEffect(() => {
    const p = radarProspects[radarIdx];
    if (!p || !p.proprietaire_nom || radarLetterLoading) return;
    // Seulement si la lettre actuelle ne mentionne pas encore le nom
    if (radarLetter && !radarLetter.includes(p.proprietaire_nom.split(" ")[0])) {
      generateRadarLetterFn(p, radarLetterTemplate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarCurrentNom, radarCurrentId]);

  const sendMsg = useCallback(async()=>{
    if(!input.trim()) return;
    const txt = input.trim();
    setInput("");
    const newMsgs = [...msgs,{id:Date.now(),role:"user" as const,text:txt}];
    setMsgs(newMsgs);
    setTyping(true);
    try {
      const res = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        system:`Tu es Lucas, l'assistant IA de ${agent.prenom} ${agent.nom} chez ${agent.agence}. Date: ${new Date().toLocaleDateString("fr-FR")}. Mandats (${mandats.length}): ${mandats.map(m=>`${m.nom_propriete} ${m.adresse} ${fmt(m.prix)}€ ${m.surface}m² prop:${m.proprietaire} pipeline:${m.pipeline}`).join(" | ")}. Prospects DVF/DPE (${prospects.length}): ${prospects.slice(0,8).map(p=>`${p.adresse} score:${p.score}${p.proprietaire_nom?" propriétaire:"+p.proprietaire_nom:""} ${p.notes}`).join(" | ")}. Acheteurs (${acheteurs.length}): ${acheteurs.map(a=>`${a.nom} budget:${fmt(a.budget_min)}-${fmt(a.budget_max)}€ type:${a.types.join(",")} villes:${a.villes.join(",")}`).join(" | ")}. RDVs: ${rdvs.map(r=>`${r.titre} ${r.date} ${r.heure}`).join(" | ")}. CA encaissé: ${fmt(transacs.filter(t=>t.statut==="encaisse").reduce((a,t)=>a+t.montant,0))}€. Réponds en français, concis, professionnel, 1-4 phrases max sauf si on te demande de rédiger un courrier.`,
        messages:(()=>{const raw=newMsgs.slice(-8).map(m=>({role:m.role==="agent"?"assistant":"user" as const,content:m.text}));const fi=raw.findIndex(m=>m.role==="user");return fi>0?raw.slice(fi):raw;})(),
        max_tokens:500
      })});
      const d = await res.json();
      const reply = d.content?.[0]?.text || (d.error ? `Erreur API : ${d.error}` : "Désolé, je n'ai pas pu répondre.");
      setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:reply}]);
    } catch(e:any) {
      setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Erreur de connexion : ${e.message||"réseau"}`}]);
    }
    setTyping(false);
  },[input,msgs,mandats,prospects,agent]);

  // ONBOARDING
  if(onboarding) return (
    <div style={{minHeight:"100vh",background:"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"var(--font-body),'DM Sans',-apple-system,sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{width:"100%",maxWidth:440,animation:"fadeUp 0.5s ease"}}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:52,justifyContent:"center"}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#C4A35A"}}/>
          <span style={{fontFamily:"var(--font-display),'Cormorant Garamond',Georgia,serif",fontSize:20,fontWeight:600,color:"#14213D",letterSpacing:"0.15em",textTransform:"uppercase"}}>Mandatly</span>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:40,justifyContent:"center"}}>
          {["Bienvenue","Personnaliser","Profil"].map((s,i)=>(
            <div key={s} style={{width:i<=obStep?28:20,height:3,borderRadius:2,background:i<=obStep?"#14213D":"#EAE5D8",transition:"all 0.4s"}}/>
          ))}
        </div>

        {obStep===0&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <div style={{fontSize:11,color:"#C4A35A",fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:14}}>Bienvenue</div>
            <h1 style={{fontFamily:"var(--font-display),'Cormorant Garamond',Georgia,serif",fontSize:42,fontWeight:400,color:"#14213D",marginBottom:14,letterSpacing:"-0.01em",lineHeight:1.1,fontStyle:"italic"}}>Le CRM qui prospecte pour vous.</h1>
            <p style={{fontSize:14,color:"#8A8372",lineHeight:1.75,marginBottom:32}}>Mandatly est le premier CRM immobilier avec un agent IA intégré. Il prospecte, rédige vos courriers et gère votre agenda — pendant que vous faites des visites.</p>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:32}}>
              {[["Prospection DVF & DPE automatique","Identifiez les propriétaires prêts à vendre"],["Courriers personnalisés en 1 clic","Lucas rédige, vous validez, Merci Facteur envoie"],["Agent IA disponible 24h/24","Posez n'importe quelle question sur vos dossiers"]].map(([t,d])=>(
                <div key={t} style={{padding:"14px 18px",background:"#F8F6F1",border:"1px solid #EAE5D8",borderRadius:8,display:"flex",alignItems:"flex-start",gap:12}}>
                  <div style={{width:4,height:4,borderRadius:"50%",background:"#C4A35A",flexShrink:0,marginTop:5}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:"#14213D",marginBottom:1}}>{t}</div>
                    <div style={{fontSize:12,color:"#8A8372"}}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setObStep(1)} style={{width:"100%",background:"#14213D",color:"#FFFFFF",border:"none",borderRadius:8,padding:"14px",fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.06em",transition:"opacity 0.2s"}} onMouseOver={e=>(e.currentTarget.style.opacity="0.85")} onMouseOut={e=>(e.currentTarget.style.opacity="1")}>Commencer →</button>
          </div>
        )}

        {obStep===1&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <div style={{fontSize:11,color:"#C4A35A",fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:12}}>Votre agent IA</div>
            <h2 style={{fontFamily:"var(--font-display),'Cormorant Garamond',Georgia,serif",fontSize:34,fontWeight:400,color:"#14213D",marginBottom:8,fontStyle:"italic"}}>Choisissez votre assistant</h2>
            <p style={{fontSize:13,color:"#8A8372",marginBottom:24}}>Personnalisez le prénom de votre secrétaire IA.</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
              {[{id:"lucas",name:"Lucas",role:"Professionnel"},{id:"sophie",name:"Sophie",role:"Élégante"},{id:"alex",name:"Alex",role:"Dynamique"},{id:"marie",name:"Marie",role:"Experte"}].map(a=>(
                <div key={a.id} onClick={()=>setObData(d=>({...d,agentId:a.id,prenom:d.prenom||a.name} as any))} style={{padding:"14px 16px",background:(obData as any).agentId===a.id?"#EAE5D8":"#F8F6F1",border:`1px solid ${(obData as any).agentId===a.id?"#14213D":"#EAE5D8"}`,borderRadius:8,cursor:"pointer",transition:"all 0.2s"}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:(obData as any).agentId===a.id?"#14213D":"#EAE5D8",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:(obData as any).agentId===a.id?"#C4A35A":"#8A8372"}}/>
                  </div>
                  <div style={{fontSize:13,fontWeight:500,color:"#14213D"}}>{a.name}</div>
                  <div style={{fontSize:11,color:"#8A8372"}}>{a.role}</div>
                </div>
              ))}
            </div>
            <input value={obData.prenom} onChange={e=>setObData(d=>({...d,prenom:e.target.value}))} placeholder="Prénom de votre agent" style={{width:"100%",background:"#F8F6F1",border:"1px solid #EAE5D8",borderRadius:8,color:"#14213D",padding:"12px 14px",fontSize:13,marginBottom:14}} onFocus={e=>e.target.style.borderColor="#14213D"} onBlur={e=>e.target.style.borderColor="#EAE5D8"}/>
            <button onClick={()=>setObStep(2)} style={{width:"100%",background:"#14213D",color:"#FFFFFF",border:"none",borderRadius:8,padding:"13px",fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:"0.06em"}}>Continuer →</button>
          </div>
        )}

        {obStep===2&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <div style={{fontSize:11,color:"#C4A35A",fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:12}}>Votre profil</div>
            <h2 style={{fontFamily:"var(--font-display),'Cormorant Garamond',Georgia,serif",fontSize:34,fontWeight:400,color:"#14213D",marginBottom:8,fontStyle:"italic"}}>Dernière étape</h2>
            <p style={{fontSize:13,color:"#8A8372",marginBottom:22}}>{obData.prenom||"Votre agent"} personnalisera chaque interaction avec vos clients.</p>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
              {[{l:"Prénom",k:"prenom",p:"Jean"},{l:"Nom",k:"nom",p:"Dupont"},{l:"Agence",k:"agence",p:"Agence Prestige Immobilier"},{l:"Email professionnel",k:"email",p:"jean@agence.fr"}].map(f=>(
                <div key={f.k}>
                  <div style={{fontSize:10,color:"#8A8372",marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.1em"}}>{f.l}</div>
                  <input value={(obData as any)[f.k]||""} onChange={e=>setObData(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p} style={{width:"100%",background:"#F8F6F1",border:"1px solid #EAE5D8",borderRadius:8,color:"#14213D",padding:"11px 14px",fontSize:13}} onFocus={e=>e.target.style.borderColor="#14213D"} onBlur={e=>e.target.style.borderColor="#EAE5D8"}/>
                </div>
              ))}
            </div>
            <button onClick={()=>{
              const a={prenom:obData.prenom,nom:obData.nom,agence:obData.agence,email:obData.email};
              setAgent(a);
              localStorage.setItem("m_setup","1");
              localStorage.setItem("m_agent",JSON.stringify(a));
              setOnboarding(false);
            }} disabled={!obData.agence} style={{width:"100%",background:obData.agence?"#14213D":"#EAE5D8",color:obData.agence?"#FFFFFF":"#8A8372",border:"none",borderRadius:8,padding:"13px",fontSize:13,fontWeight:500,letterSpacing:"0.06em",cursor:obData.agence?"pointer":"default",transition:"all 0.2s"}}>
              Accéder à Mandatly →
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // MAIN APP
  const NAVS = [{id:"radar",label:"Prospection"},{id:"veille",label:"Veille"},{id:"mandats",label:"Mandats"},{id:"pipeline",label:"Pipeline"},{id:"acheteurs",label:"Acheteurs"},{id:"agenda",label:"Agenda"},{id:"estimation",label:"Estimation"},{id:"compta",label:"Comptabilité"},{id:"courriers",label:"Courriers"}];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:C.bg,fontFamily:BODY,color:C.text,overflow:"hidden"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:2px;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes shimmer{0%{opacity:0.5}50%{opacity:1}100%{opacity:0.5}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes slideInRight{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
        input:focus,select:focus,textarea:focus{outline:none;}
        button{font-family:${BODY};}
        input,select,textarea{font-family:${BODY};}
      `}</style>

      {/* NAV */}
      <div style={{height:54,background:C.card,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 24px",gap:0,flexShrink:0,boxShadow:dark?"none":`0 1px 0 ${C.border}`}}>
        {/* Wordmark */}
        <div style={{marginRight:28,flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.gold}}/>
          <span style={{fontFamily:DISPLAY,fontSize:18,fontWeight:600,color:C.text,letterSpacing:"0.12em",textTransform:"uppercase"}}>Mandatly</span>
        </div>
        {/* Separator */}
        <div style={{width:1,height:22,background:C.border,marginRight:20,flexShrink:0}}/>
        <div style={{display:"flex",gap:0,flex:1,overflow:"hidden"}}>
          {NAVS.map(n=>(
            <button key={n.id} onClick={()=>setNav(n.id)} style={{padding:"6px 13px",background:"transparent",border:"none",borderBottom:`2px solid ${nav===n.id?C.gold:"transparent"}`,color:nav===n.id?C.text:C.muted,fontSize:12,fontWeight:nav===n.id?600:400,letterSpacing:"0.03em",transition:"all 0.2s",whiteSpace:"nowrap",cursor:"pointer",marginBottom:-1}}>
              {n.label}
            </button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* Stripe subscription badge/button */}
          {subStatus==="active"||subStatus==="trialing"?(
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:C.gold+"15",border:`1px solid ${C.gold}30`,borderRadius:8,cursor:"pointer"}} onClick={()=>setStripeModal(true)}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.gold}}/>
              <span style={{fontSize:11,color:C.gold,fontWeight:600}}>Pro{subStatus==="trialing"?" (essai)":""}</span>
            </div>
          ):(
            <button onClick={()=>setStripeModal(true)} style={{padding:"5px 12px",background:C.gold+"18",border:`1px solid ${C.gold}40`,borderRadius:8,fontSize:11,color:C.gold,cursor:"pointer",fontWeight:600}}>Passer Pro</button>
          )}
          {stripeMsg&&<span style={{fontSize:11,color:C.green,fontWeight:500}}>{stripeMsg}</span>}
          {user&&(
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:C.green+"15",border:`1px solid ${C.green}25`,borderRadius:8}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.green}}/>
              <span style={{fontSize:11,color:C.green,fontWeight:500}}>{user.email?.split("@")[0]}</span>
              <button onClick={async()=>{await supabaseSignOut();router.push("/login");}} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",marginLeft:2}}>×</button>
            </div>
          )}
          <button onClick={()=>setChat(o=>!o)} style={{padding:"6px 14px",background:chat?C.accentBg:C.surface,border:`1px solid ${chat?C.border2:C.border}`,borderRadius:8,color:chat?C.text:C.muted,fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all 0.15s"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite"}}/>
            {agent.prenom||"Agent IA"}
          </button>
          <button onClick={()=>setDark(d=>!d)} title={dark?"Mode clair":"Mode sombre"} style={{width:32,height:32,borderRadius:8,background:"transparent",border:`1px solid ${C.border}`,color:C.muted,fontSize:13,cursor:"pointer",transition:"all 0.2s",flexShrink:0}}>{dark?"☀":"☾"}</button>
          <div onClick={()=>setProfile(o=>!o)} style={{width:32,height:32,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,fontWeight:600,color:dark?"#07111F":"#FFFFFF",flexShrink:0,letterSpacing:"0.05em"}}>
            {agent.prenom?.[0]?.toUpperCase()||"A"}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>

        {/* RADAR */}
        {nav==="radar"&&(()=>{
          const basketItems = Object.values(radarBasket).sort((a:any,b:any)=>{
            if(a.liked&&!b.liked) return -1; if(!a.liked&&b.liked) return 1;
            return (b.dateSent||"").localeCompare(a.dateSent||"");
          });
          const isLiked = (id:string)=>!!radarBasket[id]?.liked;
          const toggleLike = (p:any)=>{
            const sid=String(p.id);
            setRadarBasket(b=>{const ex=b[sid];return ex?{...b,[sid]:{...ex,liked:!ex.liked}}:{...b,[sid]:{prospect:p,liked:true}};});
          };
          const sendLetter = async (p:any,letter:string)=>{
            if(!p||!letter) return;
            const today=new Date().toLocaleDateString("fr-FR");
            // Appel Merci Facteur (best effort)
            const cpMatch=(p.adresse||"").match(/\b(\d{5})\b/)||(p.ville||"").match(/\d{5}/);
            const cp=cpMatch?.[1]||cpMatch?.[0]||"33000";
            const villeClean=(p.ville||"").replace(/\d{5}\s*/g,"").trim()||(p.ville||"");
            try {
              await fetch("/api/merci-facteur",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                dest_nom:p.proprietaire_nom||"Occupant",
                dest_adresse:p.adresse||"",
                dest_cp:cp,
                dest_ville:villeClean,
                exp_nom:`${agent.prenom} ${agent.nom}`,
                exp_adresse:agent.agence||"",
                content:letter,
              })});
            } catch {}
            setCourrierHisto(h=>[...h,{id:Date.now(),prospect_id:p.id,prospect_adresse:p.adresse,prospect_ville:p.ville,date:today,template:radarLetterTemplate,statut:"envoye",content:letter}]);
            setCourriersSent(n=>n+1);
            const sid=String(p.id);
            setRadarBasket(b=>({...b,[sid]:{...(b[sid]||{prospect:p,liked:false}),dateSent:today,liked:b[sid]?.liked||false}}));
            navigator.clipboard?.writeText(letter).catch(()=>{});
          };
          const handleParcelClick = async ({properties,centroid,matchingProspects}:any)=>{
            setRadarSelected(null);
            setRadarLetter("");
            setRadarLetterTemplate("prospection");
            setParcelTab("proprietaires");
            setRadarParcelPanel({properties,centroid,matching:matchingProspects,address:null,owner:null,ownerLoading:true});
            const [lat,lng]=centroid;
            let resolvedAddress:string|null=null;
            try{
              const ban=await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`).then(r=>r.json());
              resolvedAddress=ban.features?.[0]?.properties?.label||null;
              setRadarParcelPanel(prev=>prev?{...prev,address:resolvedAddress}:prev);
            }catch{}
            const buildProspect=(ownerNom?:string)=>({
              ...(matchingProspects[0]||{id:`parcel-${properties?.section}-${properties?.numero}`,source:"DVF",score:0,notes:"",lat,lng}),
              adresse:resolvedAddress||(matchingProspects[0]?.adresse)||`Section ${properties?.section} n°${properties?.numero}`,
              ville:resolvedAddress?.split(",").slice(-1)[0]?.trim()||(matchingProspects[0]?.ville)||"",
              proprietaire_nom:ownerNom||matchingProspects.find((p:any)=>p.proprietaire_nom)?.proprietaire_nom||undefined,
            });
            try{
              const own=await fetch(`/api/proprietaire?lat=${lat}&lng=${lng}&adresse=${encodeURIComponent(resolvedAddress||"")}`).then(r=>r.json());
              setRadarParcelPanel(prev=>prev?{...prev,owner:own,ownerLoading:false}:prev);
              generateRadarLetterFn(buildProspect(own?.proprietaire_nom),"prospection");
            }catch{
              setRadarParcelPanel(prev=>prev?{...prev,ownerLoading:false}:prev);
              generateRadarLetterFn(buildProspect(),"prospection");
            }
          };
          const firstWithCoords=radarProspects.find(p=>p.lat&&p.lng);
          const radarMapCenter:[number,number]=firstWithCoords?[firstWithCoords.lat as number,firstWithCoords.lng as number]:[44.837,-0.579];

          // Layer config
          const LAYER_CFG=[
            {key:"parcelles",label:"Parcelles cadastrales",color:"#94A3B8",desc:"Polygones IGN officiels"},
            {key:"ventes",    label:"Ventes DVF",          color:"#F97316",desc:"Transactions immobilières"},
            {key:"proprietaires",label:"Propriétaires",   color:"#6366F1",desc:"Propriétaires identifiés"},
            {key:"dpe",       label:"DPE récents",         color:"#10B981",desc:"Signaux de vente"},
          ] as const;

          const EyeOpen = ()=>(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          );
          const EyeOff = ()=>(
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          );

          const rightOpen = !!(radarSelected || radarParcelPanel);

          return (
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>

            {/* LEFT: calques + config + panier */}
            <div style={{width:220,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:C.card}}>
              {/* Calques */}
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:10}}>Calques</div>
                {LAYER_CFG.map(l=>{
                  const on=radarLayers[l.key];
                  return(
                  <div key={l.key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}
                    onClick={()=>setRadarLayers(prev=>({...prev,[l.key]:!prev[l.key]}))}>
                    <div style={{width:10,height:10,borderRadius:2,background:l.color,opacity:on?1:0.25,flexShrink:0,transition:"opacity 0.15s"}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:500,color:on?C.text:C.muted,transition:"color 0.15s"}}>{l.label}</div>
                    </div>
                    <div style={{color:on?C.text:C.border,flexShrink:0,transition:"color 0.15s"}}>
                      {on?<EyeOpen/>:<EyeOff/>}
                    </div>
                  </div>
                );})}
              </div>

              {/* Secteur */}
              <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:8}}>Secteur</div>
                <div style={{display:"flex",gap:4,marginBottom:7}}>
                  <input value={radarVilleInput} onChange={e=>setRadarVilleInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&radarVilleInput.trim()&&!radarVilles.includes(radarVilleInput.trim())){setRadarVilles(v=>[...v,radarVilleInput.trim()]);setRadarVilleInput("");}}}
                    placeholder="Ex: Bordeaux" style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,color:C.text,padding:"5px 7px",fontSize:11}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button onClick={()=>{if(radarVilleInput.trim()&&!radarVilles.includes(radarVilleInput.trim())){setRadarVilles(v=>[...v,radarVilleInput.trim()]);setRadarVilleInput("");}}} style={{background:C.accent,color:dark?"#080808":"#fff",border:"none",borderRadius:5,padding:"5px 8px",fontSize:12,fontWeight:600,cursor:"pointer"}}>+</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
                  {radarVilles.map(v=>(
                    <div key={v} style={{background:C.accentBg,border:`1px solid ${C.border2}`,borderRadius:4,padding:"2px 6px",fontSize:10,color:C.text,display:"flex",alignItems:"center",gap:3}}>
                      {v}<button onClick={()=>setRadarVilles(vs=>vs.filter(x=>x!==v))} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
                    </div>
                  ))}
                  {radarVilles.length===0&&<div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>Aucune ville</div>}
                </div>
                <button disabled={radarLoading||radarVilles.length===0} onClick={loadRadar} style={{width:"100%",background:radarLoading||radarVilles.length===0?C.border:C.accent,color:radarLoading||radarVilles.length===0?C.muted:(dark?"#080808":"#fff"),border:"none",borderRadius:6,padding:"8px",fontSize:11,fontWeight:700,cursor:radarLoading||radarVilles.length===0?"default":"pointer",transition:"all 0.15s",marginBottom:5}}>
                  {radarLoading?"Analyse…":"Lancer le radar"}
                </button>
                <button disabled={dpeMapLoading||radarVilles.length===0} onClick={loadDpeOnly} style={{width:"100%",background:"transparent",color:dpeMapLoading||radarVilles.length===0?C.muted:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px",fontSize:10,fontWeight:600,cursor:dpeMapLoading||radarVilles.length===0?"default":"pointer",transition:"all 0.15s"}}>
                  {dpeMapLoading?"Chargement…":"Carte DPE (gratuit)"}
                </button>
                {radarProspects.length>0&&<div style={{fontSize:10,color:C.muted,marginTop:6,textAlign:"center"}}>{radarProspects.length} biens chargés</div>}
              </div>

              {/* Panier */}
              <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
                <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:8}}>Panier{basketItems.length>0?` · ${basketItems.length}`:""}</div>
                {basketItems.length>0?(
                  basketItems.map((item:any)=>(
                    <div key={String(item.prospect.id)} onClick={()=>{setRadarParcelPanel(null);setRadarSelected(item.prospect);generateRadarLetterFn(item.prospect,radarLetterTemplate);}} style={{padding:"7px 8px",borderRadius:6,border:`1px solid ${item.liked?C.gold+"50":C.border}`,background:item.liked?C.gold+"08":C.surface,marginBottom:5,cursor:"pointer",transition:"all 0.12s"}} onMouseOver={e=>e.currentTarget.style.borderColor=C.text} onMouseOut={e=>e.currentTarget.style.borderColor=item.liked?C.gold+"50":C.border}>
                      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                        <span style={{fontSize:11,color:item.liked?C.gold:C.muted,flexShrink:0}}>{item.liked?"♥":"○"}</span>
                        <div style={{fontSize:10,fontWeight:600,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.prospect.adresse}</div>
                      </div>
                      <div style={{fontSize:9,color:C.muted}}>{item.prospect.ville}</div>
                      {item.dateSent&&<div style={{fontSize:9,color:C.green,marginTop:2,fontWeight:600}}>Envoyé le {item.dateSent}</div>}
                    </div>
                  ))
                ):(
                  <div style={{fontSize:10,color:C.muted,fontStyle:"italic",textAlign:"center",paddingTop:12,lineHeight:1.6}}>♡ ou envoi = panier</div>
                )}
              </div>
            </div>

            {/* CENTER: carte */}
            <div style={{flex:1,position:"relative",background:C.bg}}>
              {(radarLoading||dpeMapLoading)&&(
                <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
                  <div style={{width:34,height:34,border:`3px solid ${C.accent}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
                  <div style={{fontSize:12,color:"#fff",fontWeight:600}}>{radarLoading?"Analyse en cours…":"Chargement DPE…"}</div>
                </div>
              )}
              {radarProspects.length>0||radarLayers.parcelles?(
                <MapComponent
                  prospects={radarProspects.filter(p=>p.lat&&p.lng) as any}
                  center={radarMapCenter}
                  dark={dark}
                  satellite={true}
                  layers={radarLayers}
                  onSelect={(p:any)=>{setRadarParcelPanel(null);setRadarSelected(p);generateRadarLetterFn(p,radarLetterTemplate);}}
                  onParcelClick={handleParcelClick}
                />
              ):(
                !radarLoading&&!dpeMapLoading&&(
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
                    <div style={{fontFamily:DISPLAY,fontSize:24,fontWeight:400,color:C.text,fontStyle:"italic",textAlign:"center"}}>Radar multi-villes</div>
                    <div style={{fontSize:12,color:C.muted,textAlign:"center",maxWidth:280,lineHeight:1.6}}>Ajoutez des villes et lancez le radar — les biens s'affichent sur la carte.</div>
                    {radarVilles.length>0&&<button onClick={loadRadar} style={{background:C.accent,color:dark?"#080808":"#fff",border:"none",borderRadius:10,padding:"10px 24px",fontSize:13,fontWeight:700,cursor:"pointer",marginTop:8}}>Lancer sur {radarVilles.join(", ")}</button>}
                  </div>
                )
              )}
            </div>

            {/* RIGHT: fiche parcelle ou fiche prospect */}
            {rightOpen&&(
              <div style={{width:340,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,background:C.card,animation:"slideInRight 0.18s ease"}}>

                {/* === FICHE PARCELLE === */}
                {radarParcelPanel&&(()=>{
                  const pp=radarParcelPanel;
                  const {section,numero,contenance,code_insee}=pp.properties||{};
                  const dvfHits=pp.matching.filter(p=>p.source!=="DPE");
                  const dpeHits=pp.matching.filter(p=>p.source==="DPE");
                  const ownerFromProspect=pp.matching.find(p=>p.proprietaire_nom);
                  const owner=pp.owner?.proprietaire_nom?pp.owner:null;
                  const ownerName=owner?.proprietaire_nom||ownerFromProspect?.proprietaire_nom||null;
                  const ownerSrc=owner?.proprietaire_source||ownerFromProspect?.proprietaire_source||null;
                  const parcelProspect:any={
                    ...(pp.matching[0]||{id:`parcel-${section}-${numero}`,source:"DVF",score:0,notes:"",lat:pp.centroid[0],lng:pp.centroid[1]}),
                    adresse:pp.address||(pp.matching[0]?.adresse)||`Section ${section} n°${numero}`,
                    ville:pp.address?.split(",").slice(-1)[0]?.trim()||(pp.matching[0]?.ville)||"",
                    proprietaire_nom:ownerName||pp.matching[0]?.proprietaire_nom||undefined,
                  };

                  return(
                  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",animation:"slideInRight 0.18s ease"}}>

                    {/* ── HEADER style Pappers ── */}
                    <div style={{padding:"14px 16px 0",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6,marginBottom:4}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:800,color:C.text,lineHeight:1.25,letterSpacing:"-0.01em"}}>
                            {pp.address
                              ?<>{pp.address.split(",").slice(0,-1).join(",").trim().toUpperCase()}<br/><span style={{fontSize:12,fontWeight:600,color:C.muted}}>{pp.address.split(",").slice(-1)[0].trim()}</span></>
                              :<span style={{color:C.muted,fontStyle:"italic",fontSize:12}}>Chargement adresse…</span>}
                          </div>
                        </div>
                        <button onClick={()=>setRadarParcelPanel(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,padding:"2px 6px",lineHeight:1,flexShrink:0,fontSize:18,marginTop:-2}}>×</button>
                      </div>
                      {/* Infos parcelle (style Pappers : 3 colonnes) */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10,marginTop:8}}>
                        {[
                          ["N° parcelle",`${code_insee||""}${section||""}${numero||""}`],
                          ["Surface",contenance?`${Number(contenance).toLocaleString("fr-FR")} m²`:"—"],
                          ["Ventes",`${dvfHits.length}`],
                        ].map(([lbl,val])=>(
                          <div key={lbl} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px"}}>
                            <div style={{fontSize:9,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>{lbl}</div>
                            <div style={{fontSize:11,fontWeight:700,color:C.text,lineHeight:1.2}}>{val}</div>
                          </div>
                        ))}
                      </div>
                      {/* Onglets style Pappers */}
                      <div style={{display:"flex",gap:0,marginLeft:-2,marginRight:-2}}>
                        {([
                          ["proprietaires","Propriétaires"],
                          ["ventes",`Ventes (${dvfHits.length})`],
                          ...(dpeHits.length?[["dpe",`DPE (${dpeHits.length})`] as [string,string]]:[]),
                        ] as [string,string][]).map(([id,lbl])=>(
                          <button key={id} onClick={()=>setParcelTab(id as any)} style={{flex:1,padding:"7px 6px",border:"none",borderBottom:parcelTab===id?`2px solid #3B82F6`:`2px solid transparent`,background:"none",color:parcelTab===id?"#3B82F6":C.muted,fontSize:11,fontWeight:parcelTab===id?700:500,cursor:"pointer",transition:"all 0.12s",textAlign:"center"}}>{lbl}</button>
                        ))}
                      </div>
                    </div>

                    {/* ── CONTENU ONGLET ── */}
                    <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>

                      {/* Onglet Propriétaires */}
                      {parcelTab==="proprietaires"&&(
                        <>
                          {pp.ownerLoading?(
                            <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:"#3B82F6",animation:"pulse 1s infinite",flexShrink:0}}/>
                              <span style={{fontSize:12,color:C.muted}}>Identification en cours…</span>
                            </div>
                          ):ownerName?(
                            <div style={{background:"#3B82F608",border:"1px solid #3B82F630",borderRadius:8,padding:"12px 14px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                                <div style={{width:36,height:36,borderRadius:"50%",background:"#3B82F615",border:"1px solid #3B82F630",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                </div>
                                <div style={{minWidth:0}}>
                                  <div style={{fontSize:14,fontWeight:700,color:C.text,lineHeight:1.2}}>{ownerName}</div>
                                  {ownerSrc&&ownerSrc!=="inconnu"&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>Source : {ownerSrc}</div>}
                                </div>
                              </div>
                              {pp.owner?.entreprises?.slice(0,2).map((e:any,i:number)=>(
                                <div key={i} style={{padding:"8px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,marginTop:6}}>
                                  <div style={{fontSize:12,fontWeight:600,color:C.text}}>{e.nom}</div>
                                  {e.siren&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{e.siren}</div>}
                                  {e.activite&&<div style={{fontSize:10,color:C.muted}}>{e.activite}</div>}
                                </div>
                              ))}
                            </div>
                          ):(
                            <div style={{padding:"14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8}}>
                              <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Propriétaire non identifié via les données publiques.</div>
                              <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>Consultez manuellement :</div>
                              <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent(pp.address||"")}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:6,fontSize:11,color:"#3B82F6",fontWeight:600,textDecoration:"none"}}>
                                Pappers Immo <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                            </div>
                          )}

                          {/* Courrier auto-généré */}
                          <div style={{marginTop:4}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6}}>Courrier Lucas</div>
                            <div style={{display:"flex",gap:3,marginBottom:6}}>
                              {[{id:"prospection",l:"Prospection"},{id:"relance",l:"Relance"},{id:"offre",l:"Offre"}].map(t=>(
                                <button key={t.id} onClick={()=>{setRadarLetterTemplate(t.id);generateRadarLetterFn(parcelProspect,t.id);}} style={{flex:1,padding:"5px 4px",background:radarLetterTemplate===t.id?"#3B82F6":C.surface,color:radarLetterTemplate===t.id?"#fff":C.muted,border:`1px solid ${radarLetterTemplate===t.id?"#3B82F6":C.border}`,borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer",transition:"all 0.12s"}}>{t.l}</button>
                              ))}
                            </div>
                            {radarLetterLoading&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",background:C.surface,borderRadius:6,border:`1px solid ${C.gold}40`,marginBottom:5}}><div style={{width:6,height:6,borderRadius:"50%",background:C.gold,animation:"pulse 1s infinite"}}/><span style={{fontSize:10,color:C.gold}}>Lucas rédige…</span></div>}
                            <textarea value={radarLetterLoading?"":radarLetter} onChange={e=>setRadarLetter(e.target.value)} placeholder={radarLetterLoading?"Génération…":"Choisissez un type de courrier"} rows={7} style={{width:"100%",background:C.surface,border:`1px solid ${radarLetterLoading?C.gold:C.border}`,borderRadius:7,color:C.text,padding:"9px 11px",fontSize:11,lineHeight:1.65,fontFamily:BODY,resize:"vertical",boxSizing:"border-box",transition:"border-color 0.3s"}}/>
                          </div>
                        </>
                      )}

                      {/* Onglet Ventes DVF */}
                      {parcelTab==="ventes"&&(
                        dvfHits.length>0?(
                          dvfHits.map((p:any,i:number)=>{
                            const prixM2=p.surface&&p.prix_achat?Math.round(p.prix_achat/p.surface):null;
                            const annee=p.anciennete!=null?new Date().getFullYear()-p.anciennete:null;
                            return(
                            <div key={i} style={{padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderLeft:"3px solid #7C3AED",borderRadius:"0 8px 8px 0"}}>
                              <div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:3,letterSpacing:"-0.02em"}}>
                                {p.prix_achat?`${p.prix_achat.toLocaleString("fr-FR")} €`:"Prix non disponible"}
                              </div>
                              {prixM2&&<div style={{fontSize:11,color:"#7C3AED",fontWeight:600,marginBottom:4}}>{prixM2.toLocaleString("fr-FR")} €/m²</div>}
                              <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{[p.surface&&`${p.surface} m²`,p.type_local,p.pieces&&`${p.pieces} pièces`,annee&&`Acheté en ${annee}`].filter(Boolean).join(" · ")}</div>
                            </div>
                          );})
                        ):(
                          <div style={{padding:"20px",textAlign:"center",color:C.muted,fontSize:12}}>Aucune vente DVF dans cette zone</div>
                        )
                      )}

                      {/* Onglet DPE */}
                      {parcelTab==="dpe"&&dpeHits.map((p:any,i:number)=>{
                        const cls=p.classe_dpe||"";
                        const col=cls==="G"?"#EF4444":cls==="F"?"#F97316":cls==="E"?"#F59E0B":cls==="D"?"#6B7280":"#10B981";
                        return(
                        <div key={i} style={{display:"flex",gap:12,alignItems:"center",padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderLeft:"3px solid #10B981",borderRadius:"0 8px 8px 0"}}>
                          {cls&&<div style={{width:40,height:40,borderRadius:8,background:col,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:18,color:"#fff",flexShrink:0}}>{cls}</div>}
                          <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{p.notes}</div>
                        </div>
                      );})}

                    </div>

                    {/* ── FOOTER ENVOI ── */}
                    <div style={{padding:"10px 12px",borderTop:`1px solid ${C.border}`,flexShrink:0,background:C.card}}>
                      <button onClick={()=>sendLetter(parcelProspect,radarLetter)} disabled={radarLetterLoading||!radarLetter}
                        style={{width:"100%",background:radarLetterLoading||!radarLetter?C.border:"#3B82F6",color:radarLetterLoading||!radarLetter?C.muted:"#fff",border:"none",borderRadius:7,padding:"10px",fontSize:12,fontWeight:700,cursor:radarLetterLoading||!radarLetter?"default":"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        Envoyer par Merci Facteur
                        {radarLetter&&<span style={{fontSize:10,fontWeight:400,opacity:0.75}}>· 1,50 €</span>}
                      </button>
                    </div>
                  </div>
                );})()}

                {/* === FICHE PROSPECT (pin cliqué) === */}
                {radarSelected&&!radarParcelPanel&&(
                  <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.3,marginBottom:2}}>{radarSelected.adresse}</div>
                          <div style={{fontSize:11,color:C.muted}}>{radarSelected.ville}</div>
                        </div>
                        <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
                          <button onClick={()=>toggleLike(radarSelected)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,lineHeight:1,color:isLiked(String(radarSelected.id))?C.gold:C.border,transition:"color 0.15s",padding:"2px 4px"}}>
                            {isLiked(String(radarSelected.id))?"♥":"♡"}
                          </button>
                          <button onClick={()=>setRadarSelected(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:15,color:C.muted,padding:"2px 4px",lineHeight:1}}>✕</button>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:radarSelected.proprietaire_nom?8:0}}>
                        {(()=>{const sc=radarSelected.score;const col=sc>=75?C.green:sc>=50?C.amber:C.red;return<span style={{fontSize:10,fontWeight:700,color:col,background:col+"18",border:`1px solid ${col}30`,borderRadius:4,padding:"2px 7px"}}>Score {sc}</span>;})()}
                        {radarSelected.source==="DPE"&&radarSelected.classe_dpe&&(()=>{const cls=radarSelected.classe_dpe;const col=cls==="G"?"#EF4444":cls==="F"?"#F97316":cls==="E"?"#F59E0B":"#10B981";return<span style={{fontSize:10,fontWeight:700,color:col,background:col+"18",border:`1px solid ${col}30`,borderRadius:4,padding:"2px 7px"}}>DPE {cls}</span>;})()}
                        {radarBasket[String(radarSelected.id)]?.dateSent&&<span style={{fontSize:10,color:C.green,fontWeight:600}}>Envoyé le {radarBasket[String(radarSelected.id)].dateSent}</span>}
                      </div>
                      {radarSelected.proprietaire_nom&&<div style={{background:C.green+"12",border:`1px solid ${C.green}30`,borderRadius:7,padding:"7px 10px",fontSize:11,color:C.green,fontWeight:600}}>{radarSelected.proprietaire_nom}{radarSelected.proprietaire_source&&radarSelected.proprietaire_source!=="inconnu"&&<span style={{fontWeight:400,color:C.muted}}> · {radarSelected.proprietaire_source}</span>}</div>}
                      {radarSelected.notes&&<div style={{fontSize:10,color:C.muted,marginTop:6,lineHeight:1.4}}>{radarSelected.notes}</div>}
                    </div>
                    <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{display:"flex",gap:4}}>
                        {[{id:"prospection",l:"Prospection"},{id:"relance",l:"Relance"},{id:"offre",l:"Offre"}].map(t=>(
                          <button key={t.id} onClick={()=>{setRadarLetterTemplate(t.id);generateRadarLetterFn(radarSelected,t.id);}} style={{padding:"3px 8px",background:radarLetterTemplate===t.id?C.accent:C.surface,color:radarLetterTemplate===t.id?(dark?"#080808":"#fff"):C.muted,border:`1px solid ${radarLetterTemplate===t.id?C.accent:C.border}`,borderRadius:5,fontSize:10,fontWeight:500,cursor:"pointer",transition:"all 0.12s"}}>{t.l}</button>
                        ))}
                        {radarLetterLoading&&<span style={{fontSize:10,color:C.gold,fontWeight:500,animation:"pulse 1s infinite",alignSelf:"center",marginLeft:4}}>Génération…</span>}
                      </div>
                      <textarea value={radarLetterLoading?"":radarLetter} onChange={e=>setRadarLetter(e.target.value)} placeholder={radarLetterLoading?"Lucas rédige le courrier…":"Sélectionnez un type de courrier"} style={{flex:1,minHeight:220,background:C.surface,border:`1px solid ${radarLetterLoading?C.gold:C.border}`,borderRadius:8,color:C.text,padding:"10px 12px",fontSize:11,lineHeight:1.7,fontFamily:BODY,resize:"none",transition:"border-color 0.3s"}}/>
                    </div>
                    <div style={{padding:"12px 14px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
                      <button onClick={()=>sendLetter(radarSelected,radarLetter)} disabled={radarLetterLoading||!radarLetter} style={{width:"100%",background:radarLetterLoading||!radarLetter?C.border:C.green,color:radarLetterLoading||!radarLetter?C.muted:"#fff",border:"none",borderRadius:8,padding:"11px",fontSize:13,fontWeight:700,cursor:radarLetterLoading||!radarLetter?"default":"pointer",transition:"all 0.15s",marginBottom:6}}>
                        Envoyer par Merci Facteur
                      </button>
                      <div style={{fontSize:9,color:C.muted,textAlign:"center"}}>{isLiked(String(radarSelected.id))?"Dans le panier":"Ajout automatique au panier après envoi"}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>);
        })()}

        {/* STREET VIEW MODAL */}
        {svModal&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:2000,display:"flex",flexDirection:"column"}} onClick={()=>setSvModal(null)}>
            <div style={{padding:"10px 16px",background:"#000",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}} onClick={e=>e.stopPropagation()}>
              <span style={{color:"#fff",fontSize:12,fontFamily:BODY}}>{svModal.adresse}</span>
              <button onClick={()=>setSvModal(null)} style={{background:"transparent",border:"none",color:"#888",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <iframe
              src={`https://maps.google.com/maps?q=&layer=c&cbll=${svModal.lat},${svModal.lng}&output=embed`}
              style={{flex:1,border:"none"}}
              loading="lazy"
            />
            <div style={{background:"#000",padding:"8px 16px",display:"flex",gap:12,alignItems:"center"}}>
              <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${svModal.lat},${svModal.lng}`} target="_blank" rel="noopener" style={{fontSize:11,color:"#aaa",textDecoration:"none"}}>Ouvrir dans Google Maps →</a>
            </div>
          </div>
        )}

        {/* PROSPECTION */}
        {nav==="prospects"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
            {/* LEFT PANEL */}
            <div style={{width:380,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",background:C.surface,flexShrink:0}}>
              {/* Search header */}
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                <div style={{fontFamily:DISPLAY,fontSize:17,fontWeight:500,color:C.text,marginBottom:2}}>Prospection</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Identifie propriétaires · Noms en arrière-plan · Génère les courriers</div>
                <div style={{position:"relative",marginBottom:8}}>
                  <div style={{display:"flex",gap:8}}>
                    <input value={prospSecteur}
                      onChange={e=>{
                        const v=e.target.value; setProspSecteur(v);
                        if(banDebounce.current) clearTimeout(banDebounce.current);
                        if(v.length<2){setBanSugg([]);setShowSugg(false);return;}
                        banDebounce.current=setTimeout(async()=>{
                          try{
                            const r=await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(v)}&type=municipality&limit=8`);
                            const d=await r.json();
                            const items=(d.features||[]).map((f:any)=>({
                              city:f.properties.city||f.properties.name,
                              citycode:f.properties.citycode,
                              dept:f.properties.context?.split(",")[1]?.trim()||f.properties.context||"",
                            }));
                            setBanSugg(items); setShowSugg(items.length>0);
                          }catch{}
                        },250);
                      }}
                      onKeyDown={e=>{
                        if(e.key==="Escape"){setShowSugg(false);}
                        if(e.key==="Enter"&&!dvfLoading){setShowSugg(false);handleProspect(prospSecteur);}
                      }}
                      onFocus={e=>{e.target.style.borderColor=C.text;if(banSugg.length>0)setShowSugg(true);}}
                      onBlur={e=>{e.target.style.borderColor=C.border;setTimeout(()=>setShowSugg(false),150);}}
                      placeholder="Ville, village, code postal..." style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,fontFamily:BODY}}/>
                    <button disabled={dvfLoading||!prospSecteur} onClick={()=>{setShowSugg(false);handleProspect(prospSecteur);}}
                      style={{background:dvfLoading?C.border:C.accent,color:dvfLoading?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:dvfLoading?"not-allowed":"pointer",flexShrink:0,transition:"all 0.15s"}}>
                      {dvfLoading?"...":"Analyser"}
                    </button>
                  </div>
                  {showSugg&&banSugg.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:60,zIndex:200,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.35)",marginTop:3,overflow:"hidden"}}>
                      {banSugg.map((s,i)=>(
                        <div key={i} onMouseDown={()=>{
                          setProspSecteur(s.city);
                          setBanSugg([]); setShowSugg(false);
                          handleProspect(s.city, s.citycode);
                        }} style={{padding:"8px 14px",cursor:"pointer",borderBottom:i<banSugg.length-1?`1px solid ${C.border}`:"none",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                          onMouseEnter={e=>(e.currentTarget.style.background=C.surface)}
                          onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                          <span style={{fontSize:13,color:C.text,fontWeight:500}}>{s.city}</span>
                          <span style={{fontSize:11,color:C.muted}}>{s.dept}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {dvfError&&<div style={{fontSize:12,color:C.red,marginBottom:6}}>{dvfError}</div>}
                {/* Stats chargement */}
                {dvfLoading&&(
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {["DPE","DVF","Sirene"].map(l=>(
                      <div key={l} style={{fontSize:11,color:C.muted,background:C.card,border:`1px solid ${C.amber}40`,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:C.amber,animation:"pulse 1.2s infinite"}}/>
                        {l}
                      </div>
                    ))}
                  </div>
                )}
                {/* Stats résultat + filtre */}
                {prospects.length>0&&(()=>{
                  const nDpeR = prospects.filter(p=>p.source==="DPE"&&(p.age_jours??999)<=180).length;
                  const nDpeFG = prospects.filter(p=>p.source==="DPE"&&(p.age_jours??999)>180).length;
                  const nDvf = prospects.filter(p=>p.source!=="DPE").length;
                  const nNoms = prospects.filter(p=>p.proprietaire_nom).length;
                  const nContact = Object.keys(prospCrm).filter(k=>prospects.find(p=>String(p.id)===k)).length;
                  return(
                    <div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                        {nDpeR>0&&<div style={{fontSize:11,fontWeight:600,color:"#F97316",background:"#F9731615",border:"1px solid #F9731630",borderRadius:5,padding:"2px 7px"}}>{nDpeR} DPE récents</div>}
                        {nDpeFG>0&&<div style={{fontSize:11,fontWeight:600,color:C.amber,background:C.amber+"15",border:`1px solid ${C.amber}30`,borderRadius:5,padding:"2px 7px"}}>{nDpeFG} DPE F/G</div>}
                        {nDvf>0&&<div style={{fontSize:11,fontWeight:600,color:C.blue,background:C.blue+"12",border:`1px solid ${C.blue}25`,borderRadius:5,padding:"2px 7px"}}>{nDvf} DVF</div>}
                        {nNoms>0&&<div style={{fontSize:11,fontWeight:600,color:C.gold,background:C.gold+"12",border:`1px solid ${C.gold}25`,borderRadius:5,padding:"2px 7px"}}>{nNoms} noms</div>}
                      </div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {([
                          ["tous","Tous",prospects.length],
                          ["dpe-recent","DPE récents",nDpeR],
                          ["dpe-fg","DPE F/G",nDpeFG],
                          ["dvf","DVF",nDvf],
                          ["contactes","Contactés",nContact],
                        ] as [string,string,number][]).map(([id,label,count])=>(count>0||id==="tous")&&(
                          <button key={id} onClick={()=>setProspFilter(id as any)}
                            style={{padding:"3px 9px",borderRadius:20,border:`1px solid ${prospFilter===id?C.accent:C.border}`,background:prospFilter===id?C.accent+"20":"transparent",color:prospFilter===id?C.accent:C.muted,fontSize:11,fontWeight:prospFilter===id?600:400,cursor:"pointer",transition:"all 0.12s"}}>
                            {label}{count>0&&id!=="tous"?` · ${count}`:""}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Batch action bar — CTA principale */}
              {selProspects.size>0&&(
                <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.gold+"12",flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:12,color:C.text,fontWeight:600}}>{selProspects.size} sélectionné{selProspects.size>1?"s":" ≈"} ≈ {(selProspects.size*1.5).toFixed(0)} €</span>
                    <span style={{fontSize:10,color:C.muted}}>1,50 € / lettre Merci Facteur</span>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button disabled={mfSending} onClick={async()=>{
                      if(mfSending) return;
                      const ps = prospects.filter(p=>selProspects.has(p.id) && p.adresse && p.ville);
                      if(!ps.length) return;
                      setMfSending(true); setMfResult(null);
                      let ok=0, err=0;
                      const sentIds: string[] = [];
                      for(const p of ps){
                        const cpMatch = p.adresse.match(/\b(\d{5})\b/)||p.ville?.match(/\d{5}/);
                        const cp = cpMatch?.[1]||cpMatch?.[0]||"33000";
                        const villeClean = p.ville?.replace(/\d{5}\s*/,"").trim()||p.ville;
                        const sal = getSalutation(p);
                        const typeLabel = p.type_local||(p.source==="DPE"?"bien":"bien");
                        const isDpe = p.source==="DPE";
                        const isDpeFG = isDpe && (p.classe_dpe==="F"||p.classe_dpe==="G");
                        // Angle différencié selon le signal
                        const para2 = isDpeFG
                          ? `La réglementation énergétique actuelle transforme profondément le marché immobilier dans votre secteur. Si vous souhaitez connaître la valeur de votre ${typeLabel.toLowerCase()} au ${p.adresse} ou envisagez un projet dans les prochains mois, nous serions heureux de vous accompagner.`
                          : isDpe
                          ? `Le marché immobilier de ${p.ville} est particulièrement actif en ce moment, et votre ${typeLabel.toLowerCase()} au ${p.adresse} suscite l'intérêt de nos acquéreurs. Si vous avez un projet — même lointain — nous pouvons vous proposer une évaluation confidentielle et sans engagement.`
                          : `Votre ${typeLabel.toLowerCase()} au ${p.adresse} retient notre attention. Nous accompagnons plusieurs acquéreurs sérieux, avec financement confirmé, à la recherche d'un bien de ce type dans ce secteur précis.`;
                        const content = `${sal}\n\n${agent.agence} est une agence immobilière active dans le secteur de ${p.ville}. Nous connaissons parfaitement les spécificités du marché local et intervenons régulièrement dans votre quartier.\n\n${para2}\n\nNous vous proposons une estimation gratuite, confidentielle et sans engagement de votre part.\n\nCordialement,\n${agent.prenom} ${agent.nom}\nAgent immobilier — ${agent.agence}`;
                        const r = await fetch("/api/merci-facteur",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                          dest_nom: p.proprietaire_nom||"Occupant",
                          dest_adresse: p.adresse,
                          dest_cp: cp,
                          dest_ville: villeClean,
                          exp_nom:`${agent.prenom} ${agent.nom}`,
                          exp_adresse:agent.email,
                          content,
                        })});
                        if((await r.json()).ok){ ok++; sentIds.push(String(p.id)); } else err++;
                      }
                      setMfSending(false);
                      setMfResult({ok,err});
                      if(ok>0){
                        // Marquer automatiquement comme "contacté"
                        setProspCrm(s=>{const n={...s};sentIds.forEach(id=>{n[id]="contacte";});return n;});
                        const now = new Date().toISOString().slice(0,10);
                        const newHisto = prospects.filter(p=>sentIds.includes(String(p.id))).map(p=>({
                          id:Date.now()+Math.random(), prospect_id:p.id,
                          prospect_adresse:p.adresse, prospect_ville:p.ville,
                          date:now, template:"prospection", statut:"envoye" as const,
                          content:getSalutation(p).slice(0,40),
                        }));
                        setCourrierHisto(h=>[...newHisto,...h]);
                        setSelProspects(new Set());
                        setNav("courriers");
                      }
                    }} style={{flex:1,background:mfSending?C.border:C.gold,color:mfSending?C.muted:"#000",border:"none",borderRadius:8,padding:"9px 0",fontSize:13,fontWeight:700,cursor:mfSending?"not-allowed":"pointer",transition:"all 0.15s"}}>
                      {mfSending?"Envoi en cours...":"Envoyer via Merci Facteur →"}
                    </button>
                  </div>
                </div>
              )}
              {mfResult&&(
                <div style={{padding:"8px 16px",background:mfResult.err>0?C.red+"15":C.green+"15",borderBottom:`1px solid ${C.border}`,fontSize:11,color:mfResult.err>0?C.red:C.green,flexShrink:0}}>
                  {mfResult.ok>0&&`${mfResult.ok} lettre(s) postées. Suivi dans Courriers. `}
                  {mfResult.err>0&&`${mfResult.err} erreur(s) — configurez MERCI_FACTEUR_TOKEN dans Vercel.`}
                </div>
              )}

              {/* Prospects list */}
              <div style={{flex:1,overflowY:"auto"}}>
                {prospects.length===0?(
                  <div style={{padding:28,color:C.muted}}>
                    <div style={{fontFamily:DISPLAY,fontSize:17,fontWeight:400,fontStyle:"italic",marginBottom:14,color:C.text}}>Comment prospecter</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {([
                        ["#F97316","DPE récents","Un propriétaire qui réalise un DPE prépare une vente. C'est obligatoire avant toute mise en vente. Signal le plus fort."],
                        [C.amber,"DPE F/G","La loi Climat 2025-2028 interdit la location des passoires thermiques. Ces propriétaires sont contraints de rénover ou vendre."],
                        [C.blue,"DVF anciens","Transactions passées. Plus l'achat est ancien, plus la revente est probable. Signal complémentaire."],
                      ] as [string,string,string][]).map(([col,titre,desc])=>(
                        <div key={titre} style={{padding:"10px 12px",background:C.card,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7}}>
                          <div style={{fontSize:12,fontWeight:600,color:col,marginBottom:3}}>{titre}</div>
                          <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{desc}</div>
                        </div>
                      ))}
                      <div style={{fontSize:10,color:C.muted,marginTop:4,lineHeight:1.5}}>
                        Tapez une ville ci-dessus pour charger les prospects. Les noms de propriétaires sont recherchés automatiquement (SCI et entreprises uniquement — ~15% des cas).
                      </div>
                    </div>
                  </div>
                ):(()=>{
                  const allDpeRecents = prospects.filter(p=>p.source==="DPE"&&(p.age_jours??999)<=180);
                  const allDpeFGAnciens = prospects.filter(p=>p.source==="DPE"&&(p.age_jours??999)>180);
                  const allDvfList = prospects.filter(p=>p.source!=="DPE");

                  const filtered = prospFilter==="dpe-recent" ? allDpeRecents
                    : prospFilter==="dpe-fg" ? allDpeFGAnciens
                    : prospFilter==="dvf" ? allDvfList
                    : prospFilter==="contactes" ? prospects.filter(p=>!!prospCrm[String(p.id)])
                    : prospects;

                  const renderRow = (p: Prospect) => {
                    const isSel = selProspects.has(p.id);
                    const isActive = selProspect?.id===p.id;
                    const isDpeRecent = p.source==="DPE"&&(p.age_jours??999)<=180;
                    const isDpeFG = p.source==="DPE"&&(p.age_jours??999)>180;
                    const sigCol = isDpeRecent?"#F97316":isDpeFG?C.amber:C.blue;
                    const crmSt = prospCrm[String(p.id)];
                    const crmDot = crmSt==="repondu"?C.green:crmSt==="contacte"?C.amber:crmSt==="sans_suite"?C.muted:null;

                    // Signal explication en français clair
                    const age = p.age_jours??0;
                    const sigExplain = isDpeRecent
                      ? `DPE réalisé il y a ${age<30?age+"j":Math.round(age/30)+(age<60?" mois":" mois")} — prépare une vente`
                      : isDpeFG
                      ? `DPE classe ${p.classe_dpe} — obligation légale de rénover ou vendre`
                      : `Acheté en ${new Date().getFullYear()-(p.anciennete||0)} · ${p.anciennete||"?"} ans de détention`;

                    const sigBadge = isDpeRecent
                      ? `DPE ${age<30?"< 1 mois":age<90?"< 3 mois":"< 6 mois"}`
                      : isDpeFG ? `DPE ${p.classe_dpe||"F/G"}`
                      : `DVF ${new Date().getFullYear()-(p.anciennete||0)}`;

                    const metaLine = [
                      p.surface?`${p.surface}m²`:"",
                      p.type_local||(p.source==="DPE"?"":""),
                      p.pieces?`${p.pieces}p`:"",
                    ].filter(Boolean).join(" · ");

                    return(
                      <div key={p.id} id={"prospect-"+p.id}
                        onClick={()=>{
                          setSelProspect(isActive?null:p);
                          if(!isActive&&p.lat&&p.lng) setMapFlyTo({lat:p.lat,lng:p.lng,zoom:17,key:Date.now()});
                        }}
                        style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:isActive?C.accentBg:isSel?C.gold+"10":"transparent",transition:"background 0.15s",borderLeft:`3px solid ${isActive?C.accent:isSel?C.gold:sigCol}40`}}>

                        {/* Ligne 1 : checkbox + badge signal + statut CRM */}
                        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                          <div onClick={e=>{e.stopPropagation();setSelProspects(s=>{const n=new Set(s);isSel?n.delete(p.id):n.add(p.id);return n;})}}
                            style={{width:14,height:14,borderRadius:3,border:`1.5px solid ${isSel?C.gold:C.border}`,background:isSel?C.gold:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.15s"}}>
                            {isSel&&<div style={{width:6,height:6,borderRadius:1,background:"#fff"}}/>}
                          </div>
                          <span style={{fontSize:10,fontWeight:700,color:sigCol,background:sigCol+"18",border:`1px solid ${sigCol}35`,borderRadius:4,padding:"1px 6px",letterSpacing:"0.04em"}}>{sigBadge}</span>
                          {crmDot&&<div title={crmSt==="repondu"?"Répondu":crmSt==="contacte"?"Contacté":"Sans suite"} style={{width:7,height:7,borderRadius:"50%",background:crmDot,marginLeft:"auto",flexShrink:0}}/>}
                        </div>

                        {/* Ligne 2 : adresse */}
                        <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2,paddingLeft:21,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>

                        {/* Ligne 3 : explication signal */}
                        <div style={{fontSize:11,color:C.muted,paddingLeft:21,marginBottom:3,lineHeight:1.4}}>{sigExplain}</div>

                        {/* Ligne 4 : propriétaire + meta */}
                        <div style={{display:"flex",alignItems:"center",gap:5,paddingLeft:21,flexWrap:"wrap"}}>
                          {p.proprietaire_chargement?(
                            <span style={{fontSize:10,color:C.muted,fontStyle:"italic",animation:"pulse 1.5s infinite"}}>recherche propriétaire...</span>
                          ):p.proprietaire_nom?(
                            <span style={{fontSize:11,fontWeight:700,color:C.gold}}>{p.proprietaire_nom}</span>
                          ):null}
                          {metaLine&&<span style={{fontSize:10,color:C.muted}}>{metaLine}</span>}
                          {p.proprietaire_nom&&p.proprietaire_source&&p.proprietaire_source!=="inconnu"&&(
                            <span style={{fontSize:9,color:C.muted,background:C.card,border:`1px solid ${C.border}`,borderRadius:3,padding:"0 4px",lineHeight:"16px"}}>
                              {p.proprietaire_source==="sci+dirigeant"?"SCI":p.proprietaire_source==="vision-ia"?"Vision IA":"Sirene"}
                            </span>
                          )}
                        </div>

                        {/* Ligne 5 : actions quand sélectionné */}
                        {isActive&&(
                          <div style={{marginTop:8,paddingLeft:21,display:"flex",gap:5,flexWrap:"wrap"}}>
                            <button onClick={e=>{e.stopPropagation();setSelProspect(p);}}
                              style={{background:C.accent,color:dark?"#080808":"#fff",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                              Courrier
                            </button>
                            {p.lat&&p.lng&&(
                              <button onClick={e=>{e.stopPropagation();setSvModal({lat:p.lat as number,lng:p.lng as number,adresse:p.adresse});}}
                                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>
                                Street View
                              </button>
                            )}
                            <button onClick={e=>{e.stopPropagation();setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Analyse ce prospect : ${p.adresse}, ${p.ville}. ${sigExplain}. ${p.proprietaire_nom?"Propriétaire : "+p.proprietaire_nom+". ":""}Recommande une stratégie d'approche.`}]);}}
                              style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>
                              Lucas
                            </button>
                            {p.lat&&p.lng&&!propData[String(p.id)]&&(
                              <button onClick={async e=>{
                                e.stopPropagation();
                                const key=String(p.id); setPropLoading(key);
                                try{
                                  const r=await fetch(`/api/proprietaire?lat=${p.lat}&lng=${p.lng}&adresse=${encodeURIComponent(p.adresse+" "+p.ville)}`);
                                  const d=await r.json();
                                  setPropData(x=>({...x,[key]:d}));
                                }catch{}
                                setPropLoading(null);
                              }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>
                                {propLoading===String(p.id)?"...":"Cadastre"}
                              </button>
                            )}
                            {/* CRM status */}
                            <div style={{display:"flex",gap:3,marginLeft:"auto"}}>
                              {([["contacte","Contacté",C.amber],["repondu","Répondu",C.green],["sans_suite","Sans suite",C.muted]] as [string,string,string][]).map(([st,lbl,col])=>(
                                <button key={st} onClick={e=>{e.stopPropagation();setProspCrm(s=>({...s,[String(p.id)]:s[String(p.id)]===st?undefined as any:st as any}));}}
                                  style={{background:prospCrm[String(p.id)]===st?col+"25":"transparent",color:prospCrm[String(p.id)]===st?col:C.muted,border:`1px solid ${prospCrm[String(p.id)]===st?col:C.border}`,borderRadius:5,padding:"3px 7px",fontSize:10,cursor:"pointer",fontWeight:prospCrm[String(p.id)]===st?600:400}}>
                                  {lbl}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {isActive&&propData[String(p.id)]&&(
                          <div style={{marginTop:6,marginLeft:21,padding:"6px 10px",background:C.card,borderRadius:6,border:`1px solid ${C.border}`}}>
                            {propData[String(p.id)].parcelles?.length>0&&(
                              <div style={{marginBottom:3,fontSize:11,color:C.text}}>
                                <span style={{fontSize:9,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginRight:4}}>Cadastre</span>
                                Section {propData[String(p.id)].parcelles[0].section} n°{propData[String(p.id)].parcelles[0].numero} · {propData[String(p.id)].parcelles[0].contenance}m²
                                {propData[String(p.id)].deepLink&&<a href={propData[String(p.id)].deepLink} target="_blank" rel="noopener" style={{fontSize:10,color:C.blue,marginLeft:6}}>→</a>}
                              </div>
                            )}
                            {propData[String(p.id)].entreprises?.length>0&&(
                              <div style={{fontSize:11,color:C.text}}>
                                <span style={{fontSize:9,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginRight:4}}>Sirene</span>
                                {propData[String(p.id)].entreprises[0].nom}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  };

                  const SectionHeader = ({col,title,desc,list,onSelectAll}:{col:string;title:string;desc:string;list:Prospect[];onSelectAll:()=>void}) => (
                    <div>
                      <div style={{padding:"8px 14px 5px",background:col+"10",borderBottom:`1px solid ${col}20`,borderTop:`1px solid ${col}20`}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                          <span style={{fontSize:11,fontWeight:700,color:col,letterSpacing:"0.05em",textTransform:"uppercase"}}>{title} ({list.length})</span>
                          <button onClick={onSelectAll} style={{fontSize:10,color:col,background:"transparent",border:"none",cursor:"pointer",fontWeight:600,opacity:0.8}}>Tout sélectionner</button>
                        </div>
                        <div style={{fontSize:10,color:C.muted,lineHeight:1.4}}>{desc}</div>
                      </div>
                    </div>
                  );

                  const showInGroups = prospFilter==="tous";
                  return(
                    <>
                      {showInGroups?(
                        <>
                          {allDpeRecents.length>0&&(
                            <>
                              <SectionHeader col="#F97316" title="DPE récents — Vente imminente" desc="DPE obligatoire avant toute vente → ces propriétaires préparent une mise en vente." list={allDpeRecents} onSelectAll={()=>setSelProspects(s=>{const n=new Set(s);allDpeRecents.forEach(p=>n.add(p.id));return n;})}/>
                              {allDpeRecents.map(renderRow)}
                            </>
                          )}
                          {allDpeFGAnciens.length>0&&(
                            <>
                              <SectionHeader col={C.amber} title="DPE F/G — Obligation légale" desc="Loi Climat : interdiction de louer les passoires énergétiques. Contraints de rénover ou vendre." list={allDpeFGAnciens} onSelectAll={()=>setSelProspects(s=>{const n=new Set(s);allDpeFGAnciens.forEach(p=>n.add(p.id));return n;})}/>
                              {allDpeFGAnciens.map(renderRow)}
                            </>
                          )}
                          {allDvfList.length>0&&(
                            <>
                              <SectionHeader col={C.blue} title="DVF — Anciens acquéreurs" desc="Acheteurs de 2021-2024. Plus l'achat est ancien, plus la revente est statistiquement probable." list={allDvfList} onSelectAll={()=>setSelProspects(s=>{const n=new Set(s);allDvfList.slice(0,20).forEach(p=>n.add(p.id));return n;})}/>
                              {allDvfList.map(renderRow)}
                            </>
                          )}
                        </>
                      ):(
                        <>
                          {filtered.length===0?(
                            <div style={{padding:24,textAlign:"center",color:C.muted,fontSize:12}}>Aucun prospect dans cette catégorie</div>
                          ):filtered.map(renderRow)}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Footer */}
              {prospects.length>0&&(
                <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:C.card,gap:6}}>
                  <span style={{fontSize:11,color:C.muted,flex:1,minWidth:0}}>
                    {selProspects.size>0
                      ? <><span style={{color:C.gold,fontWeight:600}}>{selProspects.size} sélectionné{selProspects.size>1?"s":""}</span> · <button onClick={()=>setSelProspects(new Set())} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",padding:0}}>Effacer</button></>
                      : <>{prospects.length} prospects · {Object.keys(prospCrm).filter(k=>prospects.find(p=>String(p.id)===k)).length} contactés</>
                    }
                  </span>
                  {prospSecteur&&!radarVilles.includes(prospSecteur)&&(
                    <button onClick={()=>{setRadarVilles(v=>[...v,prospSecteur]);}} title="Ajouter au Radar pour suivi multi-villes"
                      style={{fontSize:10,color:C.muted,background:"transparent",border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 7px",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      + Radar
                    </button>
                  )}
                  <button onClick={()=>setNav("courriers")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",fontWeight:500,padding:0,whiteSpace:"nowrap",flexShrink:0}}>Suivi →</button>
                </div>
              )}
            </div>

            {/* MAP */}
            <div style={{flex:1,position:"relative"}}>
              <Suspense fallback={<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:13}}>Chargement de la carte...</div>}>
                <MapComponent
                  prospects={prospects.filter(p=>!prospMethod||p.source===prospMethod).filter((p:any)=>p.lat&&p.lng) as any}
                  onSelect={(p:any)=>{
                    const full = prospects.find(x => String(x.id) === String(p.id)) || p;
                    setSelProspect(full as any);
                    setMapFlyTo({lat:(p as any).lat,lng:(p as any).lng,zoom:17,key:Date.now()});
                    const el = document.getElementById("prospect-"+p.id);
                    if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
                  }}
                  center={mapCenter}
                  flyToTarget={mapFlyTo ?? undefined}
                  dark={dark}
                />
              </Suspense>
              {/* Stats overlay */}
              <div style={{position:"absolute",top:12,left:12,background:dark?"rgba(8,8,8,0.92)":"rgba(255,255,255,0.94)",border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",backdropFilter:"blur(10px)",zIndex:10}}>
                {dvfStats?(
                  <>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Analyse terminée</div>
                    <div style={{display:"flex",gap:12}}>
                      <div><span style={{fontSize:18,fontFamily:DISPLAY,fontWeight:600,color:C.text}}>{dvfStats.dvf}</span><div style={{fontSize:10,color:C.muted}}>DVF</div></div>
                      <div><span style={{fontSize:18,fontFamily:DISPLAY,fontWeight:600,color:C.amber}}>{dvfStats.dpe}</span><div style={{fontSize:10,color:C.muted}}>DPE</div></div>
                      <div><span style={{fontSize:18,fontFamily:DISPLAY,fontWeight:600,color:C.green}}>{prospects.filter(p=>p.score>=75).length}</span><div style={{fontSize:10,color:C.muted}}>Prioritaires</div></div>
                    </div>
                  </>
                ):(
                  <>
                    <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Prospects</div>
                    <div style={{fontSize:20,fontFamily:DISPLAY,fontWeight:600,color:C.text}}>{prospects.length}</div>
                  </>
                )}
              </div>
              {dvfLoading&&(
                <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:dark?"rgba(8,8,8,0.95)":"rgba(255,255,255,0.96)",border:`1px solid ${C.border}`,borderRadius:14,padding:"24px 32px",backdropFilter:"blur(12px)",zIndex:20,minWidth:280}}>
                  <div style={{fontFamily:DISPLAY,fontSize:22,fontWeight:400,fontStyle:"italic",color:C.text,marginBottom:16}}>Analyse en cours...</div>
                  {[
                    {key:"dvf",label:"DVF Etalab",sub:"Transactions immobilières"},
                    {key:"dpe",label:"DPE ADEME",sub:"Diagnostics F/G — signaux de vente"},
                    {key:"enrichir",label:"Sirene + Cadastre IGN",sub:"Identification des propriétaires"},
                  ].map(s=>{
                    const st = srcStatus[s.key as keyof typeof srcStatus];
                    return(
                      <div key={s.key} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                        <div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,
                          background:st==="ok"?C.green:st==="loading"?C.amber:st==="err"?C.red:C.border,
                          animation:st==="loading"?"pulse 1.2s infinite":"none"}}/>
                        <div>
                          <div style={{fontSize:12,fontWeight:600,color:st==="idle"?C.muted:C.text}}>{s.label}</div>
                          <div style={{fontSize:10,color:C.muted}}>{s.sub}</div>
                        </div>
                        {st==="ok"&&<div style={{marginLeft:"auto",fontSize:10,color:C.green,fontWeight:600}}>✓</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT PANEL — Prospect detail + auto-courrier */}
            {selProspect&&(
              <div style={{width:370,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",background:C.surface,flexShrink:0,animation:"fadeUp 0.2s ease"}}>
                {/* Header */}
                <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selProspect.adresse}</div>
                      <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{selProspect.ville}</div>
                      {/* Owner */}
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {selProspect.proprietaire_chargement?(
                          <span style={{fontSize:11,color:C.muted,fontStyle:"italic",animation:"pulse 1.5s infinite"}}>Identification...</span>
                        ):selProspect.proprietaire_nom?(
                          <>
                            <span style={{fontSize:12,fontWeight:700,color:C.text}}>{selProspect.proprietaire_nom}</span>
                            <span style={{fontSize:10,color:C.muted,background:C.card,border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 6px"}}>
                              {selProspect.proprietaire_source==="sci+dirigeant"?"SCI":selProspect.proprietaire_source==="vision-ia"?"Vision IA":selProspect.proprietaire_source==="bodacc"?"BODACC":"Sirene"}
                            </span>
                          </>
                        ):(
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            <span style={{fontSize:11,color:C.muted}}>Propriétaire non identifié</span>
                            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                              {(propData[String(selProspect.id)]?.pagesBlanchesUrl||propData[String(selProspect.id)]?.annuaireUrl)&&(
                                <>
                                  {propData[String(selProspect.id)]?.pagesBlanchesUrl&&(
                                    <a href={propData[String(selProspect.id)].pagesBlanchesUrl} target="_blank" rel="noopener" style={{fontSize:10,color:C.blue,textDecoration:"none",background:C.card,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Pages Blanches →</a>
                                  )}
                                  {propData[String(selProspect.id)]?.annuaireUrl&&(
                                    <a href={propData[String(selProspect.id)].annuaireUrl} target="_blank" rel="noopener" style={{fontSize:10,color:C.blue,textDecoration:"none",background:C.card,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>118712 →</a>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                      {(()=>{const col=selProspect.score>=85?C.green:selProspect.score>=70?C.amber:C.red;return(
                        <div style={{width:38,height:38,borderRadius:8,background:col+"15",border:`1px solid ${col}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:col}}>{selProspect.score}</div>
                      );})()}
                      <button onClick={()=>{setSelProspect(null);}} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1,padding:0}}>×</button>
                    </div>
                  </div>
                  {/* Score bar */}
                  <div style={{height:3,background:C.border,borderRadius:2,marginTop:10}}>
                    <div style={{width:`${selProspect.score}%`,height:"100%",background:selProspect.score>=85?C.green:selProspect.score>=70?C.amber:C.red,borderRadius:2}}/>
                  </div>
                  <div style={{marginTop:8,fontSize:11,color:C.muted}}>{selProspect.notes}</div>
                  {/* Quick actions */}
                  <div style={{display:"flex",gap:6,marginTop:10}}>
                    {(selProspect as any).lat&&(selProspect as any).lng&&(
                      <button onClick={()=>setSvModal({lat:(selProspect as any).lat,lng:(selProspect as any).lng,adresse:selProspect.adresse})} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 0",fontSize:11,color:C.text,cursor:"pointer",fontWeight:500}}>Street View</button>
                    )}
                    <button onClick={()=>{setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Analyse le prospect au ${selProspect.adresse}${selProspect.proprietaire_nom?" — propriétaire probable : "+selProspect.proprietaire_nom:""}. Score ${selProspect.score}/100. ${selProspect.notes}. Recommande une stratégie d'approche.`}]);}} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 0",fontSize:11,color:C.text,cursor:"pointer",fontWeight:500}}>Lucas</button>
                  </div>
                </div>

                {/* Courrier section */}
                <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>Courrier personnalisé</div>
                    <div style={{display:"flex",gap:4}}>
                      {[{id:"prospection",l:"Prosp."},{id:"relance",l:"Relance"},{id:"offre",l:"Offre"}].map(t=>(
                        <button key={t.id} onClick={()=>setAutoCourrierTemplate(t.id)} style={{padding:"2px 8px",background:autoCourrierTemplate===t.id?C.accent:C.card,color:autoCourrierTemplate===t.id?(dark?"#080808":"#fff"):C.muted,border:`1px solid ${autoCourrierTemplate===t.id?C.accent:C.border}`,borderRadius:5,fontSize:10,fontWeight:500,cursor:"pointer"}}>{t.l}</button>
                      ))}
                    </div>
                  </div>
                  {autoCourrierLoading?(
                    <div style={{padding:"14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,textAlign:"center"}}>
                      <div style={{fontSize:12,color:C.muted,fontStyle:"italic",animation:"pulse 1.5s infinite"}}>Lucas rédige votre courrier...</div>
                    </div>
                  ):(
                    <textarea
                      value={autoCourrierContent}
                      onChange={e=>setAutoCourrierContent(e.target.value)}
                      rows={8}
                      style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"12px",fontSize:12,lineHeight:1.65,resize:"none",fontFamily:BODY}}
                      onFocus={e=>e.target.style.borderColor=C.text}
                      onBlur={e=>e.target.style.borderColor=C.border}
                    />
                  )}
                </div>

                {/* Send actions */}
                <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0,display:"flex",gap:8}}>
                  <button onClick={()=>navigator.clipboard.writeText(autoCourrierContent)} disabled={!autoCourrierContent||autoCourrierLoading} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 0",fontSize:12,color:C.text,cursor:"pointer",fontWeight:500}}>Copier</button>
                  <button disabled={autoMfSending||!autoCourrierContent||autoCourrierLoading} onClick={async()=>{
                    if(!autoCourrierContent||autoMfSending) return;
                    const p = selProspect;
                    const cp = p.ville?.match(/\d{5}/)?.[0] || "33000";
                    const ville = p.ville?.replace(/\d{5}\s*/,"").trim() || p.ville;
                    setAutoMfSending(true); setAutoMfDone(null);
                    try {
                      const r = await fetch("/api/merci-facteur",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                        dest_nom: p.proprietaire_nom||"Madame, Monsieur",
                        dest_adresse: p.adresse,
                        dest_cp: cp,
                        dest_ville: ville,
                        exp_nom:`${agent.prenom} ${agent.nom}`,
                        exp_adresse:agent.email,
                        content:autoCourrierContent,
                      })});
                      const d = await r.json();
                      if(d.ok){
                        setAutoMfDone("ok");
                        const histo: CourrierHistorique = {id:Date.now(),prospect_id:p.id,prospect_adresse:p.adresse,prospect_ville:p.ville,date:new Date().toLocaleDateString("fr-FR"),template:autoCourrierTemplate,statut:"envoye",content:autoCourrierContent};
                        setCourrierHisto(h=>[histo,...h.filter(x=>!(x.prospect_id===p.id&&x.template===autoCourrierTemplate))]);
                      } else {
                        setAutoMfDone("err");
                      }
                    } catch { setAutoMfDone("err"); }
                    setAutoMfSending(false);
                  }} style={{flex:1,background:autoMfSending?C.border:C.gold,color:autoMfSending?"#888":"#000",border:"none",borderRadius:7,padding:"8px 0",fontSize:12,fontWeight:700,cursor:autoMfSending||!autoCourrierContent?"not-allowed":"pointer"}}>
                    {autoMfSending?"Envoi...":"Merci Facteur →"}
                  </button>
                </div>
                {autoMfDone&&(
                  <div style={{padding:"8px 20px",fontSize:11,color:autoMfDone==="ok"?C.green:C.red,background:autoMfDone==="ok"?C.green+"10":C.red+"10",flexShrink:0}}>
                    {autoMfDone==="ok"?"Courrier envoyé via Merci Facteur.":"Erreur Merci Facteur — configurez MERCI_FACTEUR_TOKEN dans Vercel."}
                  </div>
                )}

                {/* Suivi courriers pour ce prospect */}
                {(()=>{
                  const histo = courrierHisto.filter(h=>h.prospect_id===selProspect.id);
                  if(!histo.length) return null;
                  return (
                    <div style={{flex:1,overflowY:"auto",padding:"14px 20px"}}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Suivi</div>
                      {histo.map(h=>(
                        <div key={h.id} style={{padding:"10px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:8}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                            <span style={{fontSize:12,fontWeight:500,color:C.text,textTransform:"capitalize"}}>{h.template}</span>
                            <span style={{fontSize:10,fontWeight:600,color:h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue,background:(h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue)+"15",borderRadius:4,padding:"1px 6px"}}>
                              {h.statut==="repondu"?"Répondu":h.statut==="relance"?"Relance":"Envoyé"}
                            </span>
                          </div>
                          <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{h.date}</div>
                          <div style={{display:"flex",gap:4}}>
                            {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"repondu"}:x))} style={{fontSize:10,background:C.green+"15",color:C.green,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Répondu</button>}
                            {h.statut!=="relance"&&<button onClick={()=>{ setAutoCourrierTemplate("relance"); }} style={{fontSize:10,background:C.amber+"15",color:C.amber,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Relancer</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* MANDATS */}
        {nav==="mandats"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            <div style={{width:260,borderRight:`1px solid ${C.border}`,overflowY:"auto",flexShrink:0,background:C.surface}}>
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>Mandats</div>
                <button onClick={()=>setMandats(m=>[...m,{id:Date.now(),adresse:"",nom_propriete:"Nouveau mandat",ville:"",prix:0,surface:0,terrain:0,chambres:3,dpe:"C",type:"Maison",statut:"en_cours",pipeline:"prospect",proprietaire:"",tel:"",email:"",honoraires:5,exclusif:true,fin_mandat:"",description:""}])} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:7,padding:"5px 12px",fontSize:12,fontWeight:500,cursor:"pointer"}}>
                  Nouveau
                </button>
              </div>
              {mandats.map(m=>(
                <div key={m.id} onClick={()=>setSelM(m)} style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:selM?.id===m.id?C.accentBg:"transparent",transition:"background 0.15s"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{m.nom_propriete}</div>
                    <div style={{fontSize:10,color:m.exclusif?C.green:C.muted,fontWeight:600,flexShrink:0,marginLeft:8}}>{m.exclusif?"EXC":""}</div>
                  </div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{m.proprietaire}</div>
                  <div style={{fontFamily:DISPLAY,fontSize:14,fontWeight:600,color:C.text}}>{fmt(m.prix)} €</div>
                </div>
              ))}
            </div>
            {selM?(
              <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.25s ease"}}>
                {/* Helper: editable field */}
                {(()=>{
                  const upd = (k:string,v:any)=>{const nm={...selM,[k]:v};setMandats(ms=>ms.map(m=>m.id===selM.id?nm:m));setSelM(nm);};
                  const inp = (k:string,type="text",label="") => (
                    <div>
                      {label&&<div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>{label}</div>}
                      <input type={type} value={(selM as any)[k]||""} onChange={e=>upd(k,type==="number"?Number(e.target.value):e.target.value)} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                    </div>
                  );
                  return (
                    <>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
                        <div style={{flex:1,marginRight:20}}>
                          <input value={selM.nom_propriete} onChange={e=>upd("nom_propriete",e.target.value)} style={{fontFamily:DISPLAY,fontSize:28,fontWeight:500,color:C.text,letterSpacing:"-0.01em",background:"transparent",border:"none",width:"100%",marginBottom:4,padding:0,fontStyle:"italic"}} onFocus={e=>e.target.style.borderBottom=`1px solid ${C.border}`} onBlur={e=>e.target.style.borderBottom="none"}/>
                          <div style={{fontSize:12,color:C.muted,letterSpacing:"0.02em"}}>{selM.adresse}, {selM.ville}</div>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",flexShrink:0}}>
                          <button onClick={()=>{setEstForm({type:selM.type,surface:String(selM.surface),adresse:`${selM.adresse}, ${selM.ville}`,etat:"bon"});setEstResult(null);setNav("estimation");}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 12px",fontSize:12,color:C.text,cursor:"pointer",fontWeight:500}}>Estimer</button>
                          <button onClick={()=>setEmailModal({to:selM.email,sujet:`${selM.nom_propriete} — `,corps:"",loading:false})} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontWeight:500}}>Email</button>
                          {(()=>{
                            const sig = sigState[selM.id];
                            const signed = selM.signature_status==="done";
                            return(
                              <button disabled={sig?.loading||signed} onClick={async()=>{
                                if(signed) return;
                                setSigState(s=>({...s,[selM.id]:{loading:true}}));
                                try{
                                  const r=await fetch("/api/yousign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mandat:selM})});
                                  const d=await r.json();
                                  if(d.error){setSigState(s=>({...s,[selM.id]:{loading:false,error:d.error}}));}
                                  else{
                                    setSigState(s=>({...s,[selM.id]:{loading:false,url:d.signing_url,sandbox:d.sandbox}}));
                                    const nm={...selM,signature_request_id:d.signature_request_id,signature_status:"pending"};
                                    setMandats(ms=>ms.map(m=>m.id===selM.id?nm:m));setSelM(nm);
                                  }
                                }catch(e:any){setSigState(s=>({...s,[selM.id]:{loading:false,error:e.message}}));}
                              }} style={{background:signed?C.green+"15":sig?.loading?C.border:C.purple+"15",color:signed?C.green:sig?.loading?C.muted:C.purple,border:`1px solid ${signed?C.green+"30":C.purple+"30"}`,borderRadius:8,padding:"7px 12px",fontSize:12,cursor:signed?"default":"pointer",fontWeight:500}}>
                                {signed?"Signé":sig?.loading?"...":"Signer"}
                              </button>
                            );
                          })()}
                          <button onClick={()=>{if(confirm(`Supprimer ${selM.nom_propriete} ?`)){setMandats(ms=>ms.filter(m=>m.id!==selM.id));setSelM(null);}}} style={{background:C.red+"15",color:C.red,border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontWeight:500}}>Supprimer</button>
                        </div>
                      </div>
                      {/* Yousign status banner */}
                      {sigState[selM.id]&&(
                        <div style={{marginBottom:16,padding:"12px 16px",background:sigState[selM.id].error?C.red+"10":C.purple+"10",border:`1px solid ${sigState[selM.id].error?C.red+"30":C.purple+"30"}`,borderRadius:10,display:"flex",alignItems:"center",gap:12}}>
                          {sigState[selM.id].error?(
                            <span style={{fontSize:12,color:C.red}}>{sigState[selM.id].error}</span>
                          ):(
                            <>
                              <div style={{flex:1}}>
                                <div style={{fontSize:12,fontWeight:600,color:C.purple,marginBottom:2}}>Demande de signature envoyée{sigState[selM.id].sandbox?" (sandbox)":""}</div>
                                {sigState[selM.id].url&&<div style={{fontSize:11,color:C.muted,wordBreak:"break-all"}}>{sigState[selM.id].url}</div>}
                              </div>
                              {sigState[selM.id].url&&<a href={sigState[selM.id].url} target="_blank" rel="noopener" style={{background:C.purple,color:"#fff",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,textDecoration:"none",flexShrink:0}}>Signer →</a>}
                            </>
                          )}
                        </div>
                      )}
                      <div style={{...card(),padding:"20px",marginBottom:16}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:14}}>Informations du bien</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                          {inp("prix","number","Prix (€)")}
                          {inp("surface","number","Surface (m²)")}
                          {inp("terrain","number","Terrain (m²)")}
                          {inp("chambres","number","Chambres")}
                          <div>
                            <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Type</div>
                            <select value={selM.type} onChange={e=>upd("type",e.target.value)} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,cursor:"pointer"}}>
                              {["Maison","Appartement","Local commercial","Terrain"].map(t=><option key={t} value={t} style={{background:C.card}}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>DPE</div>
                            <select value={selM.dpe} onChange={e=>upd("dpe",e.target.value)} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,cursor:"pointer"}}>
                              {["A","B","C","D","E","F","G"].map(d=><option key={d} value={d} style={{background:C.card}}>{d}</option>)}
                            </select>
                          </div>
                          {inp("honoraires","number","Honoraires (%)")}
                          <div>
                            <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Mandat</div>
                            <select value={selM.exclusif?"exclusif":"simple"} onChange={e=>upd("exclusif",e.target.value==="exclusif")} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,cursor:"pointer"}}>
                              <option value="exclusif" style={{background:C.card}}>Exclusif</option>
                              <option value="simple" style={{background:C.card}}>Simple</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div style={{...card(),padding:"20px",marginBottom:16}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:14}}>Propriétaire</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                          {inp("proprietaire","text","Nom")}
                          {inp("tel","text","Téléphone")}
                          {inp("email","email","Email")}
                        </div>
                      </div>
                      <div style={{...card(),padding:"20px"}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:10}}>Description</div>
                        <textarea value={selM.description||""} onChange={e=>upd("description",e.target.value)} rows={4} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 12px",fontSize:13,lineHeight:1.6,resize:"vertical"}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                      </div>
                    </>
                  );
                })()}
              </div>
            ):(
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Aucun mandat sélectionné</div>
                  <div style={{fontSize:12}}>Cliquez sur un mandat pour voir les détails</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PIPELINE */}
        {nav==="pipeline"&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"16px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em"}}>Pipeline</div>
              <div style={{fontSize:13,color:C.muted}}>CA signé <span style={{color:C.green,fontWeight:600}}>{fmt(mandats.filter(m=>m.pipeline==="signe"||m.pipeline==="vendu").reduce((a,m)=>a+Math.round(m.prix*m.honoraires/100),0))} €</span></div>
            </div>
            <div style={{flex:1,overflowX:"auto",display:"flex",gap:12,padding:20}}>
              {PIPELINE_COLS.map(col=>{
                const colMs = mandats.filter(m=>(m.pipeline||"prospect")===col.id);
                return(
                  <div key={col.id} onDragOver={e=>{e.preventDefault();setDragOver(col.id);}} onDragLeave={()=>setDragOver(null)} onDrop={e=>{e.preventDefault();if(drag){setMandats(ms=>ms.map(m=>m.id===drag?{...m,pipeline:col.id}:m));setDrag(null);setDragOver(null);}}} style={{width:210,minWidth:210,background:dragOver===col.id?col.color+"08":C.surface,border:`1px solid ${dragOver===col.id?col.color+"30":C.border}`,borderRadius:12,display:"flex",flexDirection:"column",flexShrink:0,transition:"all 0.2s"}}>
                    <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:col.color}}/>
                      <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{col.label}</span>
                      <span style={{fontSize:11,color:C.muted}}>{colMs.length}</span>
                    </div>
                    <div style={{flex:1,overflowY:"auto",padding:8}}>
                      {colMs.map(m=>(
                        <div key={m.id} draggable onDragStart={()=>setDrag(m.id)} onDragEnd={()=>{setDrag(null);setDragOver(null);}} onClick={()=>{setNav("mandats");setSelM(m);}} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px",marginBottom:8,cursor:"grab",opacity:drag===m.id?0.4:1,transition:"opacity 0.15s"}}>
                          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{m.proprietaire}</div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{fontSize:12,fontWeight:600,color:C.text}}>{fmt(m.prix)}€</span>
                            {m.exclusif&&<span style={{fontSize:10,color:C.green,fontWeight:600}}>EXC</span>}
                          </div>
                        </div>
                      ))}
                      {colMs.length===0&&<div style={{height:60,border:`1px dashed ${C.border}`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.muted}}>Déposer ici</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ACHETEURS */}
        {nav==="acheteurs"&&(
          <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
              <div>
                <h1 style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em",marginBottom:6}}>Acheteurs</h1>
                <p style={{color:C.muted,fontSize:15}}>{acheteurs.length} acheteurs actifs</p>
              </div>
              <button onClick={()=>setAcheteurForm({types:["Maison"],villes:[],budget_min:200000,budget_max:400000,surface_min:80,chambres_min:3})} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:500,cursor:"pointer"}}>Ajouter</button>
            </div>
            {acheteurForm&&(
              <div style={{...card(),padding:"24px",marginBottom:24,animation:"fadeUp 0.2s ease"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16}}>Nouvel acheteur</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
                  {[{l:"Nom complet",k:"nom",p:"Thomas Lefebvre"},{l:"Email",k:"email",p:"t.lefebvre@gmail.com"},{l:"Téléphone",k:"tel",p:"06 XX XX XX XX"},{l:"Budget min (€)",k:"budget_min",p:"200000"},{l:"Budget max (€)",k:"budget_max",p:"400000"},{l:"Surface min (m²)",k:"surface_min",p:"80"}].map(f=>(
                    <div key={f.k}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{f.l}</div>
                      <input value={(acheteurForm as any)[f.k]||""} onChange={e=>setAcheteurForm(x=>({...x,[f.k]:["budget_min","budget_max","surface_min","chambres_min"].includes(f.k)?Number(e.target.value):e.target.value}))} placeholder={f.p} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 11px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Type recherché</div>
                  <div style={{display:"flex",gap:8}}>
                    {["Maison","Appartement"].map(t=>{
                      const sel=(acheteurForm.types||[]).includes(t);
                      return <button key={t} onClick={()=>setAcheteurForm(x=>x?({...x,types:sel?(x.types||[]).filter(v=>v!==t):[...(x.types||[]),t]}):x)} style={{padding:"5px 14px",background:sel?C.accent:C.surface,color:sel?(dark?"#080808":"#FAFAFA"):C.muted,border:`1px solid ${sel?C.accent:C.border}`,borderRadius:20,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{t}</button>;
                    })}
                  </div>
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Villes cibles</div>
                  <input value={(acheteurForm.villes||[]).join(", ")} onChange={e=>setAcheteurForm(x=>({...x,villes:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)}))} placeholder="Bordeaux, Mérignac, Pessac" style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 11px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{
                    if(!acheteurForm.nom) return;
                    setAcheteurs(a=>[...a,{id:Date.now(),nom:acheteurForm.nom!,email:acheteurForm.email||"",tel:acheteurForm.tel||"",budget_min:acheteurForm.budget_min||0,budget_max:acheteurForm.budget_max||0,surface_min:acheteurForm.surface_min||0,chambres_min:acheteurForm.chambres_min||0,types:acheteurForm.types||[],villes:acheteurForm.villes||[],notes:""}]);
                    setAcheteurForm(null);
                  }} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:500,cursor:"pointer"}}>Ajouter</button>
                  <button onClick={()=>setAcheteurForm(null)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 14px",fontSize:13,color:C.muted,cursor:"pointer"}}>Annuler</button>
                </div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
              {acheteurs.map(a=>{
                const matches = mandats.filter(m=>m.prix>=a.budget_min&&m.prix<=a.budget_max&&m.surface>=a.surface_min&&a.types.includes(m.type));
                return(
                  <div key={a.id} style={{...card(),padding:"24px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:C.border2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{a.nom[0]}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:600,color:C.text}}>{a.nom}</div>
                        <div style={{fontSize:12,color:C.muted}}>{a.email}</div>
                      </div>
                      {matches.length>0&&<div style={{background:C.green+"15",color:C.green,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>{matches.length} match</div>}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:matches.length>0?14:0}}>
                      {[{l:"Budget",v:`${fmt(a.budget_min)}–${fmt(a.budget_max)}€`},{l:"Surface",v:`≥ ${a.surface_min}m²`},{l:"Chambres",v:`≥ ${a.chambres_min}`},{l:"Type",v:a.types.join(", ")}].map(i=>(
                        <div key={i.l} style={{background:C.surface,borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{i.l}</div>
                          <div style={{fontSize:12,fontWeight:500,color:C.text}}>{i.v}</div>
                        </div>
                      ))}
                    </div>
                    {matches.length>0&&(
                      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                        {matches.map(m=>(
                          <div key={m.id} onClick={()=>{setNav("mandats");setSelM(m);}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",cursor:"pointer"}}>
                            <div style={{width:4,height:4,borderRadius:"50%",background:C.green,flexShrink:0}}/>
                            <span style={{fontSize:12,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</span>
                            <span style={{fontSize:11,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(m.prix)}€</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AGENDA */}
        {nav==="agenda"&&(
          <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
              <div>
                <h1 style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em",marginBottom:6}}>Agenda</h1>
                <p style={{color:C.muted,fontSize:15}}>Vos prochains rendez-vous</p>
              </div>
              <button onClick={()=>setRdvForm({type:"visite",duree:60,date:new Date().toISOString().slice(0,10),heure:"10:00"})} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:500,cursor:"pointer"}}>
                Nouveau RDV
              </button>
            </div>
            {rdvForm&&(
              <div style={{...card(),padding:"24px",marginBottom:24,animation:"fadeUp 0.2s ease"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16}}>Nouveau rendez-vous</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
                  {[{l:"Titre",k:"titre",type:"text",p:"Ex: Visite appartement"},{l:"Client",k:"client",type:"text",p:"Nom du client"},{l:"Téléphone",k:"tel",type:"text",p:"06 XX XX XX XX"},{l:"Date",k:"date",type:"date",p:""},{l:"Heure",k:"heure",type:"time",p:""},{l:"Durée (min)",k:"duree",type:"number",p:"60"}].map(f=>(
                    <div key={f.k}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{f.l}</div>
                      <input type={f.type} value={(rdvForm as any)[f.k]||""} onChange={e=>setRdvForm(x=>({...x,[f.k]:f.type==="number"?parseInt(e.target.value):e.target.value}))} placeholder={f.p} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 11px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Type</div>
                  <div style={{display:"flex",gap:8}}>
                    {["visite","signature","estimation","appel"].map(t=>(
                      <button key={t} onClick={()=>setRdvForm(x=>({...x,type:t}))} style={{padding:"5px 12px",background:rdvForm.type===t?C.accent:C.surface,color:rdvForm.type===t?(dark?"#080808":"#FAFAFA"):C.muted,border:`1px solid ${rdvForm.type===t?C.accent:C.border}`,borderRadius:20,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{
                    if(!rdvForm.titre||!rdvForm.client) return;
                    setRdvs(rs=>[...rs,{id:Date.now(),titre:rdvForm.titre!,client:rdvForm.client!,tel:rdvForm.tel||"",date:rdvForm.date||"",heure:rdvForm.heure||"",duree:rdvForm.duree||60,type:rdvForm.type||"visite",bien:rdvForm.bien||""}]);
                    setRdvForm(null);
                  }} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:500,cursor:"pointer"}}>Ajouter</button>
                  <button onClick={()=>setRdvForm(null)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 14px",fontSize:13,color:C.muted,cursor:"pointer"}}>Annuler</button>
                </div>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {rdvs.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>(
                <div key={r.id} style={{...card(),padding:"20px 24px",display:"flex",alignItems:"center",gap:20}}>
                  <div style={{width:3,alignSelf:"stretch",borderRadius:2,background:r.type==="visite"?C.green:r.type==="signature"?C.amber:r.type==="estimation"?C.purple:C.blue,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:3}}>{r.titre}</div>
                    <div style={{fontSize:13,color:C.muted}}>{r.client}{r.tel&&` · ${r.tel}`}{r.bien&&` · ${r.bien}`}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{new Date(r.date+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}</div>
                    <div style={{fontSize:13,color:C.muted}}>{r.heure} · {r.duree}min</div>
                  </div>
                  <button onClick={()=>setRdvs(rs=>rs.filter(x=>x.id!==r.id))} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",flexShrink:0,padding:"4px 8px"}}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ESTIMATION */}
        {nav==="estimation"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* LEFT: form */}
            <div style={{width:300,borderRight:`1px solid ${C.border}`,background:C.surface,display:"flex",flexDirection:"column",flexShrink:0}}>
              <div style={{padding:"20px 20px 16px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em",marginBottom:4}}>Avis de valeur</div>
                <div style={{fontSize:12,color:C.muted}}>Estimation par comparables DVF géolocalisés</div>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:20,display:"flex",flexDirection:"column",gap:14}}>
                {([
                  {l:"Type de bien",k:"type",type:"select",opts:["Maison","Appartement"]},
                  {l:"Surface habitable (m²)",k:"surface",type:"number",placeholder:"Ex: 120"},
                  {l:"Adresse précise",k:"adresse",type:"text",placeholder:"14 rue des Acacias, Bordeaux"},
                  {l:"État général",k:"etat",type:"select",opts:["neuf","bon","moyen","travaux"]},
                ] as any[]).map((f:any)=>(
                  <div key={f.k}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{f.l}</div>
                    {f.type==="select"?(
                      <select value={(estForm as any)[f.k]} onChange={e=>setEstForm(x=>({...x,[f.k]:e.target.value}))} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,cursor:"pointer"}}>
                        {f.opts!.map((o:string)=><option key={o} value={o} style={{background:C.card}}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}
                      </select>
                    ):(
                      <input type={f.type} value={(estForm as any)[f.k]} onChange={e=>setEstForm(x=>({...x,[f.k]:e.target.value}))} placeholder={f.placeholder} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                    )}
                  </div>
                ))}
                {estError&&<div style={{fontSize:12,color:C.red,padding:"8px 12px",background:C.red+"10",borderRadius:8}}>{estError}</div>}
                <button disabled={estLoading||!estForm.surface||!estForm.adresse} onClick={async()=>{
                  setEstLoading(true); setEstError(""); setEstResult(null);
                  try {
                    const r = await lancerEstimation(estForm.type, parseFloat(estForm.surface), estForm.adresse, estForm.etat);
                    setEstResult(r);
                  } catch(e:any){setEstError(e.message);}
                  setEstLoading(false);
                }} style={{marginTop:8,background:estLoading||!estForm.surface||!estForm.adresse?C.border:C.accent,color:estLoading||!estForm.surface||!estForm.adresse?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:estLoading||!estForm.surface||!estForm.adresse?"default":"pointer",transition:"all 0.15s"}}>
                  {estLoading?"Géolocalisation et analyse...":"Estimer le bien"}
                </button>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5,marginTop:4}}>
                  Comparables DVF dans un rayon progressif autour de l&apos;adresse exacte
                </div>
              </div>
            </div>
            {/* RIGHT: result */}
            <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
              {!estResult&&!estLoading&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.muted,textAlign:"center"}}>
                  <div>
                    <div style={{fontFamily:DISPLAY,fontSize:24,fontWeight:500,color:C.text,marginBottom:8}}>Avis de valeur</div>
                    <div style={{fontSize:13,marginBottom:4}}>Saisissez une adresse précise pour obtenir</div>
                    <div style={{fontSize:13}}>une estimation basée sur les ventes DVF les plus proches</div>
                  </div>
                </div>
              )}
              {estResult&&(()=>{
                const fmtDist = (m:number|null) => {
                  if(!m) return null;
                  return m < 1000 ? `${m} m` : `${(m/1000).toFixed(1)} km`;
                };
                const distColor = (m:number|null) => {
                  if(!m) return C.muted;
                  if(m<500) return C.green;
                  if(m<1500) return C.amber;
                  return C.muted;
                };
                const printPdf = () => {
                  const w = window.open("","_blank");
                  if(!w) return;
                  const dateStr = new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"});
                  const rows = estResult.comparables.map((c:any,i:number)=>{
                    const d = fmtDist(c.distance_m);
                    const dc = c.distance_m<500?"#2A6647":c.distance_m<1500?"#B5762A":"#8A8372";
                    const bg = i%2===0?"#FFFFFF":"#F8F6F1";
                    return `<tr style="background:${bg}"><td>${c.adresse}</td><td style="color:${dc};font-weight:500">${d||"—"}</td><td>${c.surface} m²</td><td style="font-weight:600">${fmt(c.prix)} €</td><td>${fmt(c.prix_m2)} €/m²</td><td style="color:#8A8372">${c.date}</td></tr>`;
                  }).join("");
                  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Avis de Valeur — ${estResult.adresse}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',-apple-system,sans-serif;color:#14213D;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{background:linear-gradient(135deg,#14213D 0%,#1C2D52 100%);min-height:100vh;padding:52px 60px;display:flex;flex-direction:column;color:#fff;page-break-after:always}
.cover-agency{font-family:'Cormorant Garamond',serif;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#C4A35A;margin-bottom:auto;padding-bottom:40px}
.cover-badge{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#C4A35A;margin-bottom:14px;font-weight:500}
.cover-title{font-family:'Cormorant Garamond',serif;font-size:56px;font-weight:300;line-height:1.05;color:#fff;margin-bottom:6px}
.cover-sub{font-size:14px;color:rgba(255,255,255,0.55);margin-bottom:4px}
.cover-type{font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:44px}
.price-box{display:inline-flex;flex-direction:column;gap:8px;background:rgba(196,163,90,0.12);border:1px solid rgba(196,163,90,0.35);border-radius:12px;padding:28px 36px;margin-bottom:52px}
.price-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#C4A35A;font-weight:500}
.price-main{font-family:'Cormorant Garamond',serif;font-size:52px;font-weight:500;color:#fff;letter-spacing:-0.01em}
.price-range{font-size:13px;color:rgba(255,255,255,0.55);margin-top:2px}
.cover-footer{border-top:1px solid rgba(255,255,255,0.08);padding-top:22px;display:flex;justify-content:space-between;align-items:flex-end}
.cover-agent{font-size:14px;font-weight:500;color:#fff}
.cover-date{font-size:11px;color:rgba(255,255,255,0.35)}
.page{padding:48px 60px}
.section{margin-bottom:40px}
.section-title{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:500;color:#14213D;border-bottom:1px solid #EAE5D8;padding-bottom:10px;margin-bottom:20px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{border:1px solid #EAE5D8;border-radius:10px;padding:18px 20px;background:#F8F6F1}
.kpi-label{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8372;margin-bottom:6px;font-weight:500}
.kpi-val{font-size:18px;font-weight:700;color:#14213D}
.est-row{display:flex;gap:0;border:1px solid #EAE5D8;border-radius:10px;overflow:hidden;margin-bottom:0}
.est-cell{flex:1;padding:22px 24px;border-right:1px solid #EAE5D8;background:#F8F6F1}
.est-cell:last-child{border-right:none}
.est-cell.center{background:#14213D;text-align:center}
.est-cell.center .ec-label{color:rgba(255,255,255,0.5)}
.est-cell.center .ec-val{color:#C4A35A;font-size:28px}
.ec-label{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#8A8372;margin-bottom:6px;display:block;font-weight:500}
.ec-val{font-size:20px;font-weight:700;color:#14213D;display:block}
table{width:100%;border-collapse:collapse}
th{font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#8A8372;font-weight:600;padding:0 12px 10px;text-align:left}
td{padding:11px 12px;font-size:12px;color:#14213D}
.source-note{font-size:10px;color:#8A8372;margin-top:12px;font-style:italic}
.doc-footer{border-top:1px solid #EAE5D8;padding:18px 60px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#8A8372}
@page{margin:0;size:A4}@media print{.cover{min-height:100vh;page-break-after:always}}</style>
</head><body>
<div class="cover">
  <div class="cover-agency">${agent.agence}</div>
  <div>
    <div class="cover-badge">Avis de valeur immobilière — Confidentiel</div>
    <div class="cover-title">Estimation<br>de votre bien</div>
    <div class="cover-sub">${estResult.adresse}</div>
    <div class="cover-type">${estForm.type} · ${estForm.surface} m² · État : ${estForm.etat}</div>
    <div class="price-box">
      <span class="price-label">Valeur de marché estimée</span>
      <span class="price-main">${fmt(estResult.estimation)} €</span>
      <span class="price-range">Fourchette : ${fmt(estResult.fourchette_bas)} — ${fmt(estResult.fourchette_haut)} €</span>
    </div>
    <div class="cover-footer">
      <div><div class="cover-agent">${agent.prenom} ${agent.nom}</div><div class="cover-date">${agent.agence}</div></div>
      <div class="cover-date">Établi le ${dateStr}</div>
    </div>
  </div>
</div>
<div class="page">
  <div class="section">
    <div class="section-title">Synthèse du marché local</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Prix/m² médian</div><div class="kpi-val">${fmt(estResult.prix_m2_median)} €</div></div>
      <div class="kpi"><div class="kpi-label">Fourchette marché</div><div class="kpi-val">${fmt(estResult.prix_m2_min)}–${fmt(estResult.prix_m2_max)} €</div></div>
      <div class="kpi"><div class="kpi-label">Ventes analysées</div><div class="kpi-val">${estResult.nb_comparables}</div></div>
      <div class="kpi"><div class="kpi-label">Rayon d'analyse</div><div class="kpi-val">${estResult.rayon_km < 1 ? estResult.rayon_km*1000+" m" : estResult.rayon_km+" km"}</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Estimation détaillée</div>
    <div class="est-row">
      <div class="est-cell"><span class="ec-label">Prix bas</span><span class="ec-val">${fmt(estResult.fourchette_bas)} €</span></div>
      <div class="est-cell center"><span class="ec-label">Valeur marché</span><span class="ec-val">${fmt(estResult.estimation)} €</span></div>
      <div class="est-cell"><span class="ec-label">Prix optimisé</span><span class="ec-val">${fmt(estResult.fourchette_haut)} €</span></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Ventes comparables — DVF (Demandes de Valeurs Foncières)</div>
    <table>
      <thead><tr><th>Adresse</th><th>Distance</th><th>Surface</th><th>Prix de vente</th><th>€/m²</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="source-note">Source : Demandes de Valeurs Foncières (DVF) — données officielles de la Direction Générale des Finances Publiques (DGFIP), republication Etalab.</div>
  </div>
</div>
<div class="doc-footer">
  <span>${agent.agence} — ${agent.prenom} ${agent.nom}</span>
  <span>Avis de valeur établi le ${dateStr}</span>
  <span>Document confidentiel — Usage exclusif du destinataire</span>
</div>
<script>window.print();</script>
</body></html>`);
                  w.document.close();
                };
                return (
                  <>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32}}>
                      <div>
                        <div style={{fontSize:11,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:500}}>Avis de valeur</div>
                        <div style={{fontSize:13,color:C.muted,marginBottom:10}}>{estResult.adresse}</div>
                        <div style={{fontFamily:DISPLAY,fontSize:52,fontWeight:500,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>{fmt(estResult.estimation)} €</div>
                        <div style={{fontSize:14,color:C.muted,marginTop:8}}>Fourchette {fmt(estResult.fourchette_bas)} — {fmt(estResult.fourchette_haut)} €</div>
                        <div style={{fontSize:12,color:C.muted,marginTop:6}}>
                          {estResult.nb_comparables} vente{estResult.nb_comparables>1?"s":""} comparable{estResult.nb_comparables>1?"s":""} · rayon {estResult.rayon_km < 1 ? estResult.rayon_km*1000+"m" : estResult.rayon_km+"km"}
                        </div>
                      </div>
                      <button onClick={printPdf} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:500,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
                        Rapport PDF
                      </button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:28}}>
                      {[
                        {l:"Prix/m² médian",v:fmt(estResult.prix_m2_median)+" €/m²"},
                        {l:"Fourchette marché",v:`${fmt(estResult.prix_m2_min)}–${fmt(estResult.prix_m2_max)} €/m²`},
                        {l:"Comparables DVF",v:`${estResult.nb_comparables} ventes`},
                        {l:"Rayon d'analyse",v:estResult.rayon_km < 1 ? estResult.rayon_km*1000+"m" : estResult.rayon_km+"km"},
                      ].map(i=>(
                        <div key={i.l} style={{...card(),padding:"16px 18px"}}>
                          <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{i.l}</div>
                          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{i.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{...card(),padding:"24px",marginBottom:24}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:0,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                        {[
                          {l:"Prix bas",v:fmt(estResult.fourchette_bas)+" €",h:false},
                          {l:"Valeur marché",v:fmt(estResult.estimation)+" €",h:true},
                          {l:"Prix optimisé",v:fmt(estResult.fourchette_haut)+" €",h:false},
                        ].map((it,i)=>(
                          <div key={i} style={{padding:"20px 24px",background:it.h?C.accent:C.surface,borderRight:i<2?`1px solid ${C.border}`:"none"}}>
                            <div style={{fontSize:10,color:it.h?(dark?"#080808":"rgba(255,255,255,0.7)"):C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{it.l}</div>
                            <div style={{fontSize:20,fontWeight:700,color:it.h?(dark?"#080808":"#FFFFFF"):C.text}}>{it.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{...card(),padding:"24px"}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16}}>Ventes comparables — DVF</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 90px 80px 70px",gap:8,marginBottom:8}}>
                        {["Adresse","Distance","Surface","Prix","€/m²","Date"].map(h=><div key={h} style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>)}
                      </div>
                      {estResult.comparables.map((c:any,i:number)=>(
                        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 90px 80px 70px",gap:8,padding:"10px 0",borderTop:`1px solid ${C.border}`,alignItems:"center"}}>
                          <div style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.adresse}</div>
                          <div style={{fontSize:11,fontWeight:600,color:distColor(c.distance_m)}}>{fmtDist(c.distance_m)||"—"}</div>
                          <div style={{fontSize:12,color:C.muted}}>{c.surface}m²</div>
                          <div style={{fontSize:12,color:C.text,fontWeight:500}}>{fmt(c.prix)}€</div>
                          <div style={{fontSize:12,color:C.text}}>{fmt(c.prix_m2)}</div>
                          <div style={{fontSize:12,color:C.muted}}>{c.date}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* COMPTABILITÉ */}
        {nav==="compta"&&(()=>{
          const total = transacs.reduce((a,t)=>a+t.montant,0);
          const encaisse = transacs.filter(t=>t.statut==="encaisse").reduce((a,t)=>a+t.montant,0);
          const attente = transacs.filter(t=>t.statut==="en_attente").reduce((a,t)=>a+t.montant,0);
          return(
            <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
                <div>
                  <h1 style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em",marginBottom:6}}>Comptabilité</h1>
                  <p style={{color:C.muted,fontSize:15}}>Suivi des honoraires</p>
                </div>
                <button onClick={()=>{
                  const rows = transacs.map(t=>`"${t.label}","${t.adresse}","${t.montant}","${t.statut}","${t.date_encaissement}"`).join("\n");
                  const blob = new Blob([`Mandat,Adresse,Honoraires,Statut,Date\n${rows}`],{type:"text/csv"});
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href=url; a.download="honoraires-mandatly.csv"; a.click();
                }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 16px",fontSize:13,color:C.text,cursor:"pointer",fontWeight:500}}>
                  Exporter CSV
                </button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:32}}>
                {[{l:"CA prévisionnel",v:fmt(total)+" €",c:C.text},{l:"Encaissé",v:fmt(encaisse)+" €",c:C.green},{l:"En attente",v:fmt(attente)+" €",c:C.amber}].map(k=>(
                  <div key={k.l} style={{...card(),padding:"20px 24px"}}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{k.l}</div>
                    <div style={{fontSize:28,fontWeight:700,color:k.c,letterSpacing:"-0.02em"}}>{k.v}</div>
                  </div>
                ))}
              </div>
              <div style={{...card()}}>
                <div style={{padding:"16px 24px",borderBottom:`1px solid ${C.border}`,display:"grid",gridTemplateColumns:"1fr 1fr 110px 120px 140px",gap:12}}>
                  {["Mandat","Adresse","Honoraires","Statut","Action"].map(h=>(
                    <div key={h} style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                  ))}
                </div>
                {transacs.map((t,i)=>(
                  <div key={t.id} style={{padding:"16px 24px",borderBottom:i<transacs.length-1?`1px solid ${C.border}`:"none",display:"grid",gridTemplateColumns:"1fr 1fr 110px 120px 140px",gap:12,alignItems:"center"}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.text}}>{t.label}</div>
                    <div style={{fontSize:12,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.adresse}</div>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt(t.montant)} €</div>
                    <div>
                      <span style={{background:t.statut==="encaisse"?C.green+"15":t.statut==="annule"?C.red+"15":C.amber+"15",color:t.statut==="encaisse"?C.green:t.statut==="annule"?C.red:C.amber,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600}}>
                        {t.statut==="encaisse"?"Encaissé":t.statut==="annule"?"Annulé":"En attente"}
                      </span>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      {t.statut==="en_attente"&&(
                        <button onClick={()=>setTransacs(ts=>ts.map(x=>x.id===t.id?{...x,statut:"encaisse",date_encaissement:new Date().toLocaleDateString("fr-FR")}:x))} style={{background:C.green+"15",color:C.green,border:"none",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:500,cursor:"pointer"}}>Encaisser</button>
                      )}
                      {t.statut!=="annule"&&(
                        <button onClick={()=>setTransacs(ts=>ts.map(x=>x.id===t.id?{...x,statut:"annule"}:x))} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",fontSize:11,color:C.muted,cursor:"pointer"}}>Annuler</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:16,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>{
                  const nm = mandats.find(m=>!transacs.find(t=>t.mandat_id===m.id));
                  if(!nm) return;
                  setTransacs(ts=>[...ts,{id:Date.now(),mandat_id:nm.id,label:nm.nom_propriete,adresse:`${nm.adresse}, ${nm.ville}`,montant:Math.round(nm.prix*nm.honoraires/100),statut:"en_attente",date_encaissement:""}]);
                }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 14px",fontSize:13,color:C.muted,cursor:"pointer"}}>
                  + Ajouter un mandat
                </button>
              </div>
            </div>
          );
        })()}

        {/* COURRIERS */}
        {nav==="courriers"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* LEFT: prospects list */}
            <div style={{width:300,borderRight:`1px solid ${C.border}`,background:C.surface,display:"flex",flexDirection:"column",flexShrink:0}}>
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em",marginBottom:8}}>Suivi courriers</div>
                {(()=>{
                  const now = Date.now();
                  const sent = courrierHisto.length;
                  const replied = courrierHisto.filter(h=>h.statut==="repondu").length;
                  const overdue = courrierHisto.filter(h=>{
                    if(h.statut!=="envoye") return false;
                    const d = new Date(h.date.split("/").reverse().join("-")).getTime();
                    return (now-d)>21*24*60*60*1000;
                  }).length;
                  if(!sent) return <div style={{fontSize:12,color:C.muted}}>Aucun courrier envoyé</div>;
                  return(
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <div style={{background:C.blue+"15",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:600,color:C.blue}}>{sent} envoyés</div>
                      {replied>0&&<div style={{background:C.green+"15",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:600,color:C.green}}>{replied} répondus</div>}
                      {overdue>0&&<div style={{background:C.amber+"15",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:600,color:C.amber}}>{overdue} à relancer</div>}
                    </div>
                  );
                })()}
              </div>
              <div style={{flex:1,overflowY:"auto"}}>
                {/* Historique global - indépendant des prospects chargés */}
                {courrierHisto.length>0&&(
                  <>
                    <div style={{padding:"6px 16px",background:C.surface,borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>Historique</div>
                    {courrierHisto.map(h=>{
                      const overdue = h.statut==="envoye"&&(Date.now()-new Date(h.date.split("/").reverse().join("-")).getTime())>21*24*60*60*1000;
                      return(
                        <div key={h.id} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,background:overdue?C.amber+"08":"transparent"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.prospect_adresse}</div>
                              <div style={{fontSize:10,color:C.muted}}>{h.prospect_ville} · {h.date}</div>
                            </div>
                            <span style={{fontSize:9,fontWeight:600,padding:"2px 6px",borderRadius:4,flexShrink:0,
                              color:h.statut==="repondu"?C.green:overdue?C.amber:C.blue,
                              background:(h.statut==="repondu"?C.green:overdue?C.amber:C.blue)+"15"}}>
                              {h.statut==="repondu"?"Répondu":overdue?"À relancer":"Envoyé"}
                            </span>
                          </div>
                          <div style={{display:"flex",gap:4}}>
                            {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"repondu"}:x))} style={{fontSize:10,background:C.green+"15",color:C.green,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontWeight:500}}>Répondu</button>}
                            {(h.statut==="envoye"||overdue)&&(
                              <button onClick={()=>{
                                const p = prospects.find(x=>String(x.id)===String(h.prospect_id));
                                if(p){setCourrier({prospect:p,template:"relance",content:"",loading:false});}
                              }} style={{fontSize:10,background:C.amber+"15",color:C.amber,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontWeight:500}}>Relancer</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {/* Prospects pas encore contactés */}
                {prospects.length>0&&(
                  <>
                    <div style={{padding:"6px 16px",background:C.surface,borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:courrierHisto.length>0?0:0}}>Prospects chargés — nouveau courrier</div>
                    {prospects.map(p=>{
                      const col=p.score>=85?C.green:p.score>=70?C.amber:C.red;
                      const sel=courrier?.prospect?.id===p.id;
                      const hasHisto=courrierHisto.some(h=>h.prospect_id===p.id);
                      return(
                        <div key={p.id} onClick={()=>setCourrier({prospect:p,template:"prospection",content:"",loading:false})} style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentBg:"transparent",transition:"background 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:24,height:24,borderRadius:5,background:col+"15",border:`1px solid ${col}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:col,flexShrink:0}}>{p.score}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:11,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>
                              <div style={{fontSize:10,color:C.muted}}>{p.proprietaire_nom||p.ville}</div>
                            </div>
                            {hasHisto&&<div style={{width:6,height:6,borderRadius:"50%",background:courrierHisto.find(h=>h.prospect_id===p.id)?.statut==="repondu"?C.green:C.amber,flexShrink:0}}/>}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {prospects.length===0&&courrierHisto.length===0&&(
                  <div style={{padding:20,textAlign:"center",color:C.muted,fontSize:12}}>
                    <div style={{marginBottom:6}}>Lancez une prospection pour générer des courriers</div>
                    <button onClick={()=>setNav("prospects")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",fontWeight:500}}>Aller à Prospection →</button>
                  </div>
                )}
              </div>
            </div>
            {/* RIGHT: courrier composer */}
            <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
              {!courrier?(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.muted,textAlign:"center"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Sélectionnez un prospect</div>
                    <div style={{fontSize:12}}>Mandatly génère un courrier personnalisé via DVF</div>
                  </div>
                </div>
              ):(
                <>
                  <div style={{marginBottom:24}}>
                    <div style={{fontFamily:DISPLAY,fontSize:22,fontWeight:500,color:C.text,letterSpacing:"0",marginBottom:4,fontStyle:"italic"}}>{courrier.prospect.adresse}</div>
                    <div style={{fontSize:13,color:C.muted,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <span>{courrier.prospect.ville} · Score {courrier.prospect.score}/100</span>
                      {courrier.prospect.proprietaire_nom&&(
                        <span style={{fontSize:12,fontWeight:500,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 8px"}}>{courrier.prospect.proprietaire_nom}</span>
                      )}
                      {courrier.prospect.proprietaire_source&&(
                        <span style={{fontSize:10,color:C.muted}}>via {courrier.prospect.proprietaire_source==="sci+dirigeant"?"SCI":courrier.prospect.proprietaire_source==="sirene+dirigeant"?"Sirene":"Sirene"}</span>
                      )}
                    </div>
                  </div>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Type de courrier</div>
                    <div style={{display:"flex",gap:8}}>
                      {[{id:"prospection",l:"Prospection initiale",d:"Premier contact propriétaire"},{id:"relance",l:"Relance",d:"Suivi après 3 semaines"},{id:"offre",l:"Offre d'achat",d:"Proposition d'un acheteur"}].map(t=>(
                        <div key={t.id} onClick={()=>setCourrier(c=>c?{...c,template:t.id,content:""}:null)} style={{flex:1,padding:"12px 14px",background:courrier.template===t.id?C.accentBg:C.card,border:`1px solid ${courrier.template===t.id?C.border2:C.border}`,borderRadius:10,cursor:"pointer",transition:"all 0.15s"}}>
                          <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:3}}>{t.l}</div>
                          <div style={{fontSize:11,color:C.muted}}>{t.d}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button disabled={courrier.loading} onClick={async()=>{
                    setCourrier(c=>c?{...c,loading:true,content:""}:null);
                    const p = courrier.prospect;
                    const nomCtx = p.proprietaire_nom ? ` Le propriétaire identifié est ${p.proprietaire_nom}${p.proprietaire_source?"  (source : "+p.proprietaire_source+")":""}.` : "";
                    const templates:Record<string,string> = {
                      prospection:`Rédige un courrier de prospection immobilière pour un propriétaire habitant au ${p.adresse}, ${p.ville}. Le bien a été acheté il y a environ ${p.anciennete||"plusieurs"} années. ${p.notes}.${nomCtx} Ton nom est ${agent.prenom} ${agent.nom} de ${agent.agence}. Sois professionnel, personnalisé, 3 paragraphes maximum. Commence OBLIGATOIREMENT par "Madame, Monsieur," sur la première ligne.`,
                      relance:`Rédige un courrier de relance pour un propriétaire au ${p.adresse}, ${p.ville} que j'ai déjà contacté il y a 3 semaines sans réponse. ${p.notes}.${nomCtx} Signe en tant que ${agent.prenom} ${agent.nom}, ${agent.agence}. Bref et percutant, 2 paragraphes. Commence par "Madame, Monsieur,".`,
                      offre:`Rédige un courrier informant le propriétaire au ${p.adresse}, ${p.ville} qu'un acheteur sérieux recherche exactement son type de bien dans ce secteur. ${p.notes}.${nomCtx} Signe: ${agent.prenom} ${agent.nom}, ${agent.agence}. Commence par "Madame, Monsieur,".`,
                    };
                    try {
                      const res = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                        system:`Tu es un assistant immobilier expert en rédaction de courriers de prospection. Réponds uniquement avec le texte du courrier, sans introduction ni explication.`,
                        messages:[{role:"user",content:templates[courrier.template]}],
                        max_tokens:600
                      })});
                      const d = await res.json();
                      setCourrier(c=>c?{...c,loading:false,content:d.content?.[0]?.text||"Erreur"}:null);
                    } catch {
                      setCourrier(c=>c?{...c,loading:false,content:"Erreur de connexion"}:null);
                    }
                  }} style={{marginBottom:20,background:courrier.loading?C.border:C.accent,color:courrier.loading?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"11px 20px",fontSize:13,fontWeight:600,cursor:courrier.loading?"default":"pointer",transition:"all 0.15s"}}>
                    {courrier.loading?"Génération en cours...":"Générer avec Lucas"}
                  </button>
                  {courrier.content&&(
                    <div style={{...card(),padding:"24px",marginBottom:20}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Courrier généré</div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>navigator.clipboard.writeText(courrier.content)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,color:C.muted,cursor:"pointer"}}>Copier</button>
                          <button onClick={()=>{
                            const histo: CourrierHistorique = {id:Date.now(),prospect_id:courrier.prospect.id,prospect_adresse:courrier.prospect.adresse,prospect_ville:courrier.prospect.ville,date:new Date().toLocaleDateString("fr-FR"),template:courrier.template,statut:"envoye",content:courrier.content};
                            setCourrierHisto(h=>[histo,...h.filter(x=>!(x.prospect_id===courrier.prospect.id&&x.template===courrier.template))]);
                            const w=window.open("","_blank");
                            if(!w) return;
                            w.document.write(`<!DOCTYPE html><html><head><title>Courrier — ${courrier.prospect.adresse}</title><style>body{font-family:Georgia,serif;max-width:600px;margin:60px auto;color:#111;line-height:1.7;font-size:14px}pre{white-space:pre-wrap;font-family:inherit}@media print{button{display:none}}</style></head><body><pre>${courrier.content}</pre><br><br><p style="font-size:11px;color:#888">Généré le ${new Date().toLocaleDateString("fr-FR")} par Mandatly · ${agent.prenom} ${agent.nom} — ${agent.agence}</p><script>window.print();</script></body></html>`);
                            w.document.close();
                          }} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer"}}>Imprimer + Enregistrer</button>
                        </div>
                      </div>
                      <div style={{fontSize:13,color:C.text,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{courrier.content}</div>
                    </div>
                  )}
                  {/* Historique courriers pour ce prospect */}
                  {(()=>{
                    const hist = courrierHisto.filter(h=>h.prospect_id===courrier.prospect.id);
                    if(!hist.length) return null;
                    return(
                      <div style={{...card(),padding:"20px"}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>Historique</div>
                        {hist.map(h=>(
                          <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,color:C.text,fontWeight:500}}>{h.template==="prospection"?"Prospection":h.template==="relance"?"Relance":"Offre d'achat"}</div>
                              <div style={{fontSize:11,color:C.muted}}>{h.date}</div>
                            </div>
                            <div style={{display:"flex",gap:6,alignItems:"center"}}>
                              <span style={{fontSize:10,fontWeight:600,color:h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue,background:(h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue)+"15",borderRadius:4,padding:"2px 7px"}}>
                                {h.statut==="repondu"?"Répondu":h.statut==="relance"?"Relance":"Envoyé"}
                              </span>
                              {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"repondu"}:x))} style={{fontSize:10,background:C.green+"15",color:C.green,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Répondu</button>}
                              {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"relance"}:x))} style={{fontSize:10,background:C.amber+"15",color:C.amber,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Relancer</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}

        {/* VEILLE CONCURRENCE */}
        {nav==="veille"&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Header + mode toggle */}
            <div style={{padding:"20px 28px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.surface}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:14}}>
                <div>
                  <h1 style={{fontSize:22,fontWeight:600,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>Veille</h1>
                  <div style={{fontSize:13,color:C.muted}}>{veilleMode==="recherche"?"Annonces en vente · Source : Bien'ici":"Identifier un bien depuis une annonce quelconque"}</div>
                </div>
                <div style={{display:"flex",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:3,gap:2}}>
                  {([["recherche","Rechercher annonces"],["analyser","Analyser une annonce"]] as [string,string][]).map(([id,lbl])=>(
                    <button key={id} onClick={()=>{setVeilleMode(id as any);setAnalyserResult(null);}} style={{padding:"5px 12px",borderRadius:5,border:"none",background:veilleMode===id?"rgba(255,255,255,0.15)":"transparent",color:veilleMode===id?C.text:C.muted,fontSize:11,fontWeight:veilleMode===id?600:400,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"}}>{lbl}</button>
                  ))}
                </div>
              </div>
              {veilleMode==="recherche"&&(<>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={annonceVille} onChange={e=>setAnnonceVille(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter") handleAnnonces(annonceVille);}}
                      placeholder="Ex : Bordeaux, Mérignac..." style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,width:220}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button disabled={annoncesLoading||!annonceVille.trim()} onClick={()=>handleAnnonces(annonceVille)}
                    style={{background:annoncesLoading?C.border:C.accent,color:annoncesLoading?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:annoncesLoading?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                    {annoncesLoading?"...":"Analyser"}
                  </button>
                </div>
                {annoncesError&&<div style={{fontSize:12,color:C.red,marginTop:8}}>{annoncesError}</div>}
                {annonces.length>0&&(()=>{
                  const maisons = annonces.filter(a=>a.type==="Maison");
                  const apparts = annonces.filter(a=>a.type==="Appartement");
                  const withPrixM2 = annonces.filter(a=>a.prix&&a.surface&&a.surface>0);
                  const avgPrixM2 = withPrixM2.length ? Math.round(withPrixM2.reduce((s,a)=>s+a.prix/a.surface,0)/withPrixM2.length) : 0;
                  const avgPrix = Math.round(annonces.reduce((s,a)=>s+(a.prix||0),0)/annonces.length);
                  return (
                    <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
                      {[
                        {l:`${annonces.length} annonces`},
                        {l:`${maisons.length} maisons`,c:C.green},
                        {l:`${apparts.length} apparts`,c:C.blue},
                        ...(avgPrixM2>0?[{l:`~${avgPrixM2.toLocaleString("fr-FR")} €/m²`,c:C.amber}]:[]),
                        ...(avgPrix>0?[{l:`moy. ${avgPrix.toLocaleString("fr-FR")} €`}]:[]),
                      ].map(s=>(
                        <div key={s.l} style={{fontSize:11,color:(s as any).c||C.muted,background:C.card,border:`1px solid ${(s as any).c?((s as any).c+"30"):C.border}`,borderRadius:6,padding:"3px 10px",fontWeight:(s as any).c?600:400}}>
                          {s.l}
                        </div>
                      ))}
                      {/* Filters */}
                      <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
                        {(["","Maison","Appartement"] as const).map(f=>(
                          <button key={f} onClick={()=>setAnnoncesTypeFilter(f)} style={{padding:"3px 9px",background:annoncesTypeFilter===f?C.accent:C.card,color:annoncesTypeFilter===f?(dark?"#080808":"#fff"):C.muted,border:`1px solid ${annoncesTypeFilter===f?C.accent:C.border}`,borderRadius:20,fontSize:11,fontWeight:annoncesTypeFilter===f?600:400,cursor:"pointer"}}>
                            {f||"Tous"}
                          </button>
                        ))}
                        <select value={annoncesSort} onChange={e=>setAnnoncesSort(e.target.value as typeof annoncesSort)}
                          style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"3px 8px",fontSize:11,cursor:"pointer"}}>
                          <option value="prix_asc">Prix ↑</option>
                          <option value="prix_desc">Prix ↓</option>
                          <option value="surface_desc">Surface ↓</option>
                        </select>
                      </div>
                    </div>
                  );
                })()}
              </>)}
              {veilleMode==="analyser"&&(
                <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Ville</label>
                    <input value={analyserForm.ville} onChange={e=>setAnalyserForm(f=>({...f,ville:e.target.value}))}
                      placeholder="Ex : Bordeaux" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,width:160}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Code postal</label>
                    <input value={analyserForm.cp} onChange={e=>setAnalyserForm(f=>({...f,cp:e.target.value}))}
                      placeholder="33000" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,width:90}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Type</label>
                    <select value={analyserForm.type} onChange={e=>setAnalyserForm(f=>({...f,type:e.target.value as any}))}
                      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,cursor:"pointer"}}>
                      <option value="Maison">Maison</option>
                      <option value="Appartement">Appartement</option>
                    </select>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Surface m²</label>
                    <input value={analyserForm.surface} onChange={e=>setAnalyserForm(f=>({...f,surface:e.target.value}))}
                      placeholder="120" type="number" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,width:90}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Terrain m²</label>
                    <input value={analyserForm.terrain} onChange={e=>setAnalyserForm(f=>({...f,terrain:e.target.value}))}
                      placeholder="600" type="number" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,width:90}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  </div>
                  <button disabled={analyserLoading||!analyserForm.ville.trim()||!analyserForm.surface} onClick={handleAnalyserAnnonce}
                    style={{background:analyserLoading||!analyserForm.ville.trim()||!analyserForm.surface?C.border:C.accent,color:analyserLoading||!analyserForm.ville.trim()||!analyserForm.surface?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:analyserLoading||!analyserForm.ville.trim()||!analyserForm.surface?"not-allowed":"pointer",alignSelf:"flex-end"}}>
                    {analyserLoading?"...":"Identifier"}
                  </button>
                </div>
              )}
            </div>

            {/* Content */}
            {veilleMode==="analyser"&&(
            <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
              {/* Description + photoUrls */}
              <div style={{maxWidth:680,display:"flex",flexDirection:"column",gap:14}}>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Description de l'annonce</label>
                  <textarea value={analyserForm.description} onChange={e=>setAnalyserForm(f=>({...f,description:e.target.value}))}
                    placeholder="Collez ici le descriptif de l'annonce (adresse approximative, caractéristiques, quartier...)"
                    rows={4}
                    style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 12px",fontSize:13,resize:"vertical",fontFamily:"inherit",lineHeight:1.5}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <label style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>URLs des photos</label>
                  <textarea value={analyserForm.photoUrls} onChange={e=>setAnalyserForm(f=>({...f,photoUrls:e.target.value}))}
                    placeholder={"Collez les URLs des photos, une par ligne\nhttps://...photo1.jpg\nhttps://...photo2.jpg"}
                    rows={3}
                    style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 12px",fontSize:12,resize:"vertical",fontFamily:"monospace",lineHeight:1.5}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <div style={{fontSize:11,color:C.muted}}>Les photos sont utilisées par l'IA pour identifier visuellement le bien (piscine, toiture, façade...).</div>
                </div>
              </div>
              {analyserLoading&&(
                <div style={{marginTop:32,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
                  <div style={{fontFamily:DISPLAY,fontSize:18,fontStyle:"italic",color:C.text}}>Analyse IA en cours...</div>
                  <div style={{fontSize:12,color:C.muted}}>Cadastre · DVF · Vision · ~15 secondes</div>
                </div>
              )}
              {analyserResult&&!analyserResult.error&&analyserResult.matched&&(
                <div style={{marginTop:24,maxWidth:680}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>Bien identifié</div>
                    {analyserResult.method==="dvf"&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.green+"18",border:`1px solid ${C.green}35`,borderRadius:4,padding:"1px 6px"}}>DVF — haute fiabilité</span>}
                    {analyserResult.method?.startsWith("pappers")&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.green+"18",border:`1px solid ${C.green}35`,borderRadius:4,padding:"1px 6px"}}>Cadastre — fiable</span>}
                    {analyserResult.method==="dvf_vision"&&!analyserResult.low_confidence&&<span style={{fontSize:10,color:C.green,background:C.green+"15",border:`1px solid ${C.green}30`,borderRadius:4,padding:"1px 6px"}}>Vision IA — fiable</span>}
                    {analyserResult.method==="dvf_vision"&&analyserResult.low_confidence&&<span style={{fontSize:10,color:C.amber,background:C.amber+"15",border:`1px solid ${C.amber}30`,borderRadius:4,padding:"1px 6px"}}>Vision IA — à vérifier</span>}
                  </div>
                  {analyserResult.lat&&analyserResult.lng&&analyserResult.method!=="dvf"&&(
                    <div style={{marginBottom:14,borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,position:"relative"}}>
                      <img src={`https://data.geopf.fr/wms-r/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&WIDTH=600&HEIGHT=240&SRS=EPSG:4326&BBOX=${analyserResult.lng-0.002},${analyserResult.lat-0.001},${analyserResult.lng+0.002},${analyserResult.lat+0.001}`}
                        alt="Vue aérienne" style={{width:"100%",height:200,objectFit:"cover",display:"block"}}/>
                      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.45)",padding:"5px 10px",fontSize:11,color:"#fff",fontWeight:600}}>Vue aérienne IGN</div>
                    </div>
                  )}
                  {analyserResult.parcel&&(
                    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>Parcelle {analyserResult.parcel.section}{analyserResult.parcel.numero}</div>
                      <div style={{fontSize:12,color:C.muted}}>{analyserResult.parcel.contenance} m² · {analyserResult.parcel.commune}</div>
                      {analyserResult.adresse&&<div style={{fontSize:12,color:C.text,marginTop:4,fontWeight:500}}>{analyserResult.adresse}</div>}
                    </div>
                  )}
                  {analyserResult.pappers_immo?.proprietaires?.length>0?(
                    <div style={{background:C.green+"12",border:`1px solid ${C.green}35`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.green,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>
                        {analyserResult.pappers_immo.proprietaires.length>1?"Propriétaires":"Propriétaire"}
                      </div>
                      {analyserResult.pappers_immo.proprietaires.map((p:any,i:number)=>(
                        <div key={i} style={{marginBottom:i<analyserResult.pappers_immo.proprietaires.length-1?6:0}}>
                          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{p.nom}</div>
                          {p.siren&&<a href={`https://www.pappers.fr/entreprise/${p.siren}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.blue,textDecoration:"none",fontWeight:600}}>SIREN {p.siren} →</a>}
                        </div>
                      ))}
                    </div>
                  ):analyserResult.owner?.nom?(
                    <div style={{background:C.green+"12",border:`1px solid ${C.green}35`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.green,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Propriétaire</div>
                      <div style={{fontSize:14,fontWeight:700,color:C.text}}>{analyserResult.owner.nom}</div>
                      {analyserResult.owner.entreprise&&analyserResult.owner.entreprise!==analyserResult.owner.nom&&<div style={{fontSize:12,color:C.muted,marginTop:1}}>{analyserResult.owner.entreprise}</div>}
                      {analyserResult.owner.siren&&<a href={`https://www.pappers.fr/entreprise/${analyserResult.owner.siren}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",marginTop:4,fontSize:11,color:C.blue,textDecoration:"none",fontWeight:600}}>SIREN {analyserResult.owner.siren} →</a>}
                    </div>
                  ):(
                    <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Propriétaire non identifié</div>
                  )}
                  <div style={{display:"flex",gap:8,marginTop:4}}>
                    {analyserResult.geoportailUrl&&(
                      <a href={analyserResult.geoportailUrl} target="_blank" rel="noopener noreferrer"
                        style={{flex:1,display:"block",padding:"9px 0",background:C.blue+"15",border:`1px solid ${C.blue}30`,borderRadius:8,fontSize:12,color:C.blue,textAlign:"center",textDecoration:"none",fontWeight:600}}>
                        Satellite IGN →
                      </a>
                    )}
                    {analyserResult.parcel&&(
                      <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent((analyserResult.parcel.commune||"")+" section "+analyserResult.parcel.section+" "+analyserResult.parcel.numero)}`} target="_blank" rel="noopener noreferrer"
                        style={{flex:1,display:"block",padding:"9px 0",background:"#f0f7ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:12,color:"#1d4ed8",textAlign:"center",textDecoration:"none",fontWeight:600}}>
                        Pappers Immo →
                      </a>
                    )}
                  </div>
                  {analyserResult.vision_score>0&&(
                    <div style={{fontSize:11,color:C.muted,marginTop:10}}>Score correspondance : {analyserResult.vision_score}%{analyserResult.vision_reason&&<span style={{display:"block",marginTop:1}}>{analyserResult.vision_reason}</span>}</div>
                  )}
                  <button onClick={()=>setAnalyserResult(null)} style={{marginTop:12,background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 16px",fontSize:12,cursor:"pointer"}}>Réessayer</button>
                </div>
              )}
              {analyserResult&&!analyserResult.error&&!analyserResult.matched&&(
                <div style={{marginTop:24,maxWidth:680}}>
                  <div style={{fontSize:12,color:C.amber,fontWeight:600,marginBottom:12}}>Bien non identifié avec certitude — comparez les candidats ci-dessous</div>
                  {analyserResult.descriptor&&(
                    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.text,lineHeight:1.6}}>
                      <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Descriptif IA</div>
                      {[
                        analyserResult.descriptor.piscine&&"Piscine",
                        analyserResult.descriptor.tennis&&"Tennis",
                        analyserResult.descriptor.etages&&`${analyserResult.descriptor.etages} étage(s)`,
                        analyserResult.descriptor.toiture&&`Toit ${analyserResult.descriptor.toiture.replace(/_/g," ")}`,
                        analyserResult.descriptor.facade_couleur&&`Façade ${analyserResult.descriptor.facade_couleur}`,
                      ].filter(Boolean).join(" · ")}
                      {analyserResult.descriptor.descriptif&&<div style={{color:C.muted,marginTop:2,fontStyle:"italic"}}>{analyserResult.descriptor.descriptif}</div>}
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                    {(analyserResult.dvf_candidates||[]).map((c:any,i:number)=>{
                      const ignUrl=c.lat&&c.lng?`https://data.geopf.fr/wms-r/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&WIDTH=320&HEIGHT=160&SRS=EPSG:4326&BBOX=${c.lng-0.0018},${c.lat-0.001},${c.lng+0.0018},${c.lat+0.001}`:null;
                      return (
                        <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
                          {ignUrl&&(
                            <div style={{position:"relative",height:130,background:C.surface}}>
                              <img src={ignUrl} alt="Vue satellite" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                              {c.vision_score>0&&<div style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.6)",color:"#fff",fontSize:10,fontWeight:700,borderRadius:4,padding:"2px 6px"}}>Score {c.vision_score}%</div>}
                            </div>
                          )}
                          <div style={{padding:"10px 12px"}}>
                            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2}}>{c.adresse}</div>
                            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{c.surface_bati}m² bâti{c.surface_terrain>0?` · ${c.surface_terrain}m² terrain`:""}</div>
                            <div style={{display:"flex",gap:8}}>
                              {c.geoportailUrl&&<a href={c.geoportailUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.blue,textDecoration:"none",fontWeight:600}}>Satellite →</a>}
                              <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent(c.adresse)}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#1d4ed8",textDecoration:"none",fontWeight:600}}>Pappers →</a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={()=>setAnalyserResult(null)} style={{marginTop:14,background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 16px",fontSize:12,cursor:"pointer"}}>Réessayer</button>
                </div>
              )}
              {analyserResult?.error&&(
                <div style={{marginTop:20,fontSize:13,color:C.red}}>{analyserResult.error}</div>
              )}
              {!analyserResult&&!analyserLoading&&(
                <div style={{marginTop:40,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <div style={{fontFamily:DISPLAY,fontSize:20,fontStyle:"italic",color:C.text}}>Collez les infos de l'annonce</div>
                  <div style={{fontSize:13,color:C.muted,textAlign:"center",maxWidth:420}}>Ville, surface, description et photos — l'IA identifie le bien, la parcelle et le propriétaire</div>
                </div>
              )}
            </div>
            )}
            {veilleMode==="recherche"&&(
            <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
              {annoncesLoading?(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200}}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontFamily:DISPLAY,fontSize:20,fontStyle:"italic",color:C.text,marginBottom:8}}>Chargement des annonces...</div>
                    <div style={{fontSize:12,color:C.muted}}>Bien'ici · Votre secteur</div>
                  </div>
                </div>
              ):annonces.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:60}}>
                  <div style={{fontFamily:DISPLAY,fontSize:22,fontStyle:"italic",color:C.text,marginBottom:8,textAlign:"center"}}>Aucune annonce</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:32,textAlign:"center"}}>Entrez une ville pour voir les biens actuellement en vente</div>
                  {/* Portal links */}
                  <div style={{width:"100%",maxWidth:600}}>
                    <div style={{fontSize:11,color:C.amber,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Prestige & Luxe</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
                      {[
                        {name:"Barnes",url:"https://www.barnesparis.com/fr/recherche?typeannonce=vente"},
                        {name:"Sotheby's Realty",url:"https://www.sothebysrealty.com/fra/buy/"},
                        {name:"Savills",url:"https://www.savills.fr/property/recherche?Tenure=For+sale"},
                        {name:"Collectionniste",url:"https://www.collectionniste.fr/achat/"},
                        {name:"Knight Frank",url:"https://www.knightfrank.fr/proprietes-de-prestige/"},
                        {name:"Belles Demeures",url:"https://www.belles-demeures.fr/annonces-immobilieres/vente/"},
                        {name:"Green Acres",url:"https://www.green-acres.fr/fr/proprietes/a-vendre/france"},
                        {name:"Propriétés Figaro",url:"https://immobilier.lefigaro.fr/annonces/annonces-vente.html"},
                      ].map(p=>(
                        <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:5,padding:"9px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,color:C.text,textDecoration:"none",fontWeight:500}}>
                          <span style={{fontSize:8,color:C.amber}}>★</span>{p.name} →
                        </a>
                      ))}
                    </div>
                    <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Grands portails</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                      {[
                        {name:"SeLoger",url:"https://www.seloger.com/list.htm?types=2,4&projects=2&enterprise=0&natures=1,2,4"},
                        {name:"Bien'ici",url:"https://www.bienici.com/recherche/achat/france"},
                        {name:"PAP",url:"https://www.pap.fr/annonce/ventes-maisons-appartements"},
                        {name:"LeBonCoin",url:"https://www.leboncoin.fr/recherche?category=9"},
                        {name:"Logic-immo",url:"https://www.logic-immo.com/vente-immobilier-france/"},
                        {name:"MeilleursAgents",url:"https://www.meilleursagents.com/"},
                      ].map(p=>(
                        <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"9px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,fontSize:12,color:C.muted,textDecoration:"none",fontWeight:500}}>
                          {p.name} →
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ):(()=>{
                const filtered = annonces
                  .filter(a=>!annoncesTypeFilter||a.type===annoncesTypeFilter)
                  .sort((a,b)=>annoncesSort==="prix_desc"?(b.prix||0)-(a.prix||0):annoncesSort==="surface_desc"?(b.surface||0)-(a.surface||0):(a.prix||0)-(b.prix||0));
                return (
                <div style={{display:"flex",gap:20,alignItems:"flex-start"}}>
                  {/* Grid + portal links */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14,marginBottom:24}}>
                      {filtered.map(a=>{
                        const prixM2 = a.prix && a.surface && a.surface > 0 ? Math.round(a.prix / a.surface) : null;
                        const isSel = selAnnonce?.id === a.id;
                        return (
                        <div key={a.id} onClick={()=>{setSelAnnonce(isSel?null:a);setMatchResult(null);setFullDossierResult(null);setAnnoncePhotoIdx(0);setAnnonceShowDesc(false);}} style={{background:C.card,border:`1px solid ${isSel?C.accent:C.border}`,borderRadius:12,overflow:"hidden",transition:"box-shadow 0.15s,border-color 0.15s",cursor:"pointer",boxShadow:isSel?`0 0 0 2px ${C.accent}30`:undefined}} onMouseOver={e=>{if(!isSel)e.currentTarget.style.boxShadow=`0 4px 20px ${C.shadow}`;}} onMouseOut={e=>{if(!isSel)e.currentTarget.style.boxShadow="none";}}>
                          {a.photos?.length>0?(
                            <div style={{height:150,background:`url(${a.photos[cardPhotoIdx[a.id]||0]}) center/cover no-repeat`,flexShrink:0,position:"relative"}}>
                              {a.isNew&&<div style={{position:"absolute",top:8,left:8,background:C.amber,color:"#000",fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 6px",letterSpacing:"0.06em"}}>NEUF</div>}
                              {a.photos.length>1&&(
                                <>
                                  <button onClick={e=>{e.stopPropagation();setCardPhotoIdx(m=>({...m,[a.id]:((m[a.id]||0)-1+a.photos.length)%a.photos.length}));}}
                                    style={{position:"absolute",left:5,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:16,width:24,height:24,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>‹</button>
                                  <button onClick={e=>{e.stopPropagation();setCardPhotoIdx(m=>({...m,[a.id]:((m[a.id]||0)+1)%a.photos.length}));}}
                                    style={{position:"absolute",right:5,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:16,width:24,height:24,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>›</button>
                                  <div style={{position:"absolute",bottom:5,right:8,fontSize:9,color:"rgba(255,255,255,0.85)",fontWeight:600,background:"rgba(0,0,0,0.35)",borderRadius:4,padding:"1px 5px"}}>
                                    {(cardPhotoIdx[a.id]||0)+1}/{a.photos.length}
                                  </div>
                                </>
                              )}
                            </div>
                          ):(
                            <div style={{height:150,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                              {a.isNew&&<div style={{position:"absolute",top:8,left:8,background:C.amber,color:"#000",fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 6px",letterSpacing:"0.06em"}}>NEUF</div>}
                              <span style={{fontSize:11,color:C.muted}}>Pas de photo</span>
                            </div>
                          )}
                          <div style={{padding:"12px 14px"}}>
                            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:4}}>
                              <div>
                                <div style={{fontSize:14,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>
                                  {a.prix ? `${a.prix.toLocaleString("fr-FR")} €` : "Prix NC"}
                                </div>
                                <div style={{fontSize:11,color:C.muted,marginTop:2}}>
                                  {a.surface ? `${a.surface} m²` : "?"}{a.pieces ? ` · ${a.pieces} p.` : ""}{prixM2 ? <span style={{color:C.amber,fontWeight:600}}> · {prixM2.toLocaleString("fr-FR")} €/m²</span> : ""}
                                </div>
                              </div>
                              <span style={{fontSize:10,background:a.type==="Maison"?C.green+"18":C.blue+"15",color:a.type==="Maison"?C.green:C.blue,border:`1px solid ${a.type==="Maison"?C.green+"35":C.blue+"30"}`,borderRadius:5,padding:"2px 6px",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>
                                {a.type}
                              </span>
                            </div>
                            <div style={{fontSize:11,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {a.ville}{a.cp ? ` ${a.cp}` : ""}{a.agence ? ` · ${a.agence}` : ""}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <div style={{borderTop:`1px solid ${C.border}`,paddingTop:20}}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Portails prestige & luxe</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
                        {[
                          {name:"Barnes",url:`https://www.barnesparis.com/fr/recherche?typeannonce=vente&localisation=${encodeURIComponent(annonceVille)}`},
                          {name:"Sotheby's Realty",url:`https://www.sothebysrealty.com/fra/buy/${annonceVille.toLowerCase().replace(/\s+/g,"-")}-fra`},
                          {name:"Savills",url:`https://www.savills.fr/property/recherche?Tenure=For+sale&ResidentialTypes=House,Flat&SearchList=${encodeURIComponent(annonceVille)}`},
                          {name:"Collectionniste",url:`https://www.collectionniste.fr/achat/maison/${annonceVille.toLowerCase().replace(/\s+/g,"-").normalize("NFD").replace(/[̀-ͯ]/g,"")}/`},
                          {name:"Knight Frank",url:`https://www.knightfrank.fr/proprietes-de-prestige/resultat?localisation=${encodeURIComponent(annonceVille)}&transaction=achat`},
                          {name:"Belles Demeures",url:`https://www.belles-demeures.fr/annonces-immobilieres/vente/?localisation=${encodeURIComponent(annonceVille)}`},
                          {name:"Green Acres",url:`https://www.green-acres.fr/fr/proprietes/a-vendre/france?keywords=${encodeURIComponent(annonceVille)}`},
                          {name:"Propriétés Figaro",url:`https://immobilier.lefigaro.fr/annonces/annonces-vente.html?localisation_ville=${encodeURIComponent(annonceVille)}&localisation_type=ville&naturebien=maison,appartement`},
                        ].map(p=>(
                          <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",textDecoration:"none",fontWeight:500,display:"flex",alignItems:"center",gap:4}}>
                            <span style={{fontSize:9,color:C.amber}}>★</span>{p.name} →
                          </a>
                        ))}
                      </div>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Grands portails</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {[
                          {name:"SeLoger",url:`https://www.seloger.com/list.htm?types=2,4&projects=2&enterprise=0&natures=1,2,4&localisation=${encodeURIComponent(annonceVille)}`},
                          {name:"PAP",url:`https://www.pap.fr/annonce/ventes-maisons-appartements-${annonceVille.toLowerCase().replace(/\s+/g,"-").normalize("NFD").replace(/[̀-ͯ]/g,"")}`},
                          {name:"LeBonCoin",url:`https://www.leboncoin.fr/recherche?category=9&real_estate_type=1,2&locations=${encodeURIComponent(annonceVille)}`},
                          {name:"Logic-immo",url:`https://www.logic-immo.com/vente-immobilier-${annonceVille.toLowerCase().replace(/\s+/g,"-").normalize("NFD").replace(/[̀-ͯ]/g,"")},5_1/`},
                          {name:"MeilleursAgents",url:`https://www.meilleursagents.com/prix-immobilier/${annonceVille.toLowerCase().replace(/\s+/g,"-").normalize("NFD").replace(/[̀-ͯ]/g,"")}/`},
                        ].map(p=>(
                          <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",textDecoration:"none",fontWeight:500}}>
                            {p.name} →
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* Detail panel */}
                  {selAnnonce&&(
                    <div style={{width:320,flexShrink:0,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:20,position:"sticky",top:16,maxHeight:"calc(100vh - 40px)",overflowY:"auto"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                        <div style={{fontSize:13,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>Bien sélectionné</div>
                        <button onClick={()=>{setSelAnnonce(null);setMatchResult(null);setFullDossierResult(null);setAnnoncePhotoIdx(0);setAnnonceShowDesc(false);}} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                      </div>
                      {/* Carousel photos */}
                      {selAnnonce.photos?.length>0&&(
                        <div style={{position:"relative",height:180,borderRadius:10,overflow:"hidden",marginBottom:12,background:C.surface}}>
                          <div style={{height:"100%",background:`url(${selAnnonce.photos[annoncePhotoIdx]}) center/cover no-repeat`}}/>
                          {selAnnonce.photos.length>1&&(
                            <>
                              <button onClick={e=>{e.stopPropagation();setAnnoncePhotoIdx(i=>(i-1+selAnnonce.photos.length)%selAnnonce.photos.length);}}
                                style={{position:"absolute",left:6,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:20,width:28,height:28,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
                              <button onClick={e=>{e.stopPropagation();setAnnoncePhotoIdx(i=>(i+1)%selAnnonce.photos.length);}}
                                style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:20,width:28,height:28,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
                              <div style={{position:"absolute",bottom:6,left:0,right:0,textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.85)",fontWeight:600}}>
                                {annoncePhotoIdx+1}/{selAnnonce.photos.length}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:4}}>
                        {selAnnonce.prix ? `${selAnnonce.prix.toLocaleString("fr-FR")} €` : "Prix NC"}
                      </div>
                      <div style={{fontSize:12,color:C.muted,marginBottom:4}}>
                        {selAnnonce.surface ? `${selAnnonce.surface} m²` : "?"}
                        {selAnnonce.pieces ? ` · ${selAnnonce.pieces} pièces` : ""}
                        {selAnnonce.type ? ` · ${selAnnonce.type}` : ""}
                      </div>
                      <div style={{fontSize:12,color:C.muted,marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {selAnnonce.ville}{selAnnonce.cp ? ` ${selAnnonce.cp}` : ""}
                        {selAnnonce.agence ? ` · ${selAnnonce.agence}` : ""}
                      </div>
                      {/* Descriptif toggle */}
                      {selAnnonce.description&&(
                        <div style={{marginBottom:10}}>
                          <button onClick={()=>setAnnonceShowDesc(v=>!v)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.muted,cursor:"pointer",fontWeight:500}}>
                            {annonceShowDesc?"Masquer le descriptif":"Voir le descriptif"}
                          </button>
                          {annonceShowDesc&&(
                            <div style={{marginTop:8,fontSize:12,color:C.text,lineHeight:1.7,background:C.surface,borderRadius:8,padding:"12px 14px",maxHeight:200,overflowY:"auto"}}>
                              {selAnnonce.description
                                .replace(/([.!?])\s+/g,"$1\n")
                                .split("\n")
                                .filter((s:string)=>s.trim().length>0)
                                .map((s:string,i:number)=>(
                                  <p key={i} style={{margin:0,marginBottom:6}}>{s.trim()}</p>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                      {selAnnonce.url&&(
                        <a href={selAnnonce.url} target="_blank" rel="noopener noreferrer" style={{display:"block",fontSize:12,color:C.accent,marginBottom:14,textDecoration:"none",fontWeight:600}}>
                          Voir l'annonce complète →
                        </a>
                      )}
                      {/* Identify button */}
                      {!matchResult&&(
                        <button
                          disabled={matchLoading||(!selAnnonce.lat&&!selAnnonce.lng)}
                          onClick={()=>handleMatchAnnonce(selAnnonce)}
                          style={{width:"100%",background:matchLoading?C.border:C.accent,color:matchLoading?C.muted:(dark?"#080808":"#fff"),border:"none",borderRadius:9,padding:"10px 0",fontSize:13,fontWeight:700,cursor:matchLoading||(!selAnnonce.lat&&!selAnnonce.lng)?"not-allowed":"pointer",letterSpacing:"-0.01em",transition:"background 0.15s"}}
                        >
                          {matchLoading?"Identification en cours...":"Identifier ce bien"}
                        </button>
                      )}
                      {matchLoading&&(
                        <div style={{marginTop:12,fontSize:11,color:C.muted,textAlign:"center",lineHeight:1.5}}>
                          Comparaison cadastre + vue aérienne IGN + IA...
                          <br/>~10 secondes
                        </div>
                      )}
                      {/* Match result — bien identifié */}
                      {matchResult&&!matchResult.error&&matchResult.matched&&(
                        <div style={{marginTop:4}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                            <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Résultat</div>
                            {matchResult.method==="dvf"&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.green+"18",border:`1px solid ${C.green}35`,borderRadius:4,padding:"1px 6px"}}>DVF — haute fiabilité</span>}
                            {matchResult.method==="pappers_vision_high"&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.green+"18",border:`1px solid ${C.green}35`,borderRadius:4,padding:"1px 6px"}}>Cadastre — haute fiabilité</span>}
                            {matchResult.method==="pappers_vision"&&!matchResult.low_confidence&&<span style={{fontSize:10,color:C.green,background:C.green+"15",border:`1px solid ${C.green}30`,borderRadius:4,padding:"1px 6px"}}>Cadastre — fiable</span>}
                            {matchResult.method==="pappers_vision"&&matchResult.low_confidence&&<span style={{fontSize:10,color:C.amber,background:C.amber+"15",border:`1px solid ${C.amber}30`,borderRadius:4,padding:"1px 6px"}}>Cadastre — à vérifier</span>}
                            {matchResult.method==="dvf_vision"&&!matchResult.low_confidence&&<span style={{fontSize:10,color:C.green,background:C.green+"15",border:`1px solid ${C.green}30`,borderRadius:4,padding:"1px 6px"}}>Vision IA — fiable</span>}
                            {matchResult.method==="dvf_vision"&&matchResult.low_confidence&&<span style={{fontSize:10,color:C.amber,background:C.amber+"15",border:`1px solid ${C.amber}30`,borderRadius:4,padding:"1px 6px"}}>Vision IA — à vérifier</span>}
                            {matchResult.method==="dvf_surface"&&<span style={{fontSize:10,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 6px"}}>Surface DVF — à confirmer</span>}
                          </div>
                          {/* Vue aérienne inline — confirmer visuellement que c'est le bon bien */}
                          {matchResult.lat&&matchResult.lng&&matchResult.method!=="dvf"&&matchResult.method!=="dvf_surface"&&(
                            <div style={{marginBottom:10,borderRadius:9,overflow:"hidden",border:`1px solid ${C.border}`,position:"relative"}}>
                              <img
                                src={`https://data.geopf.fr/wms-r/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&WIDTH=320&HEIGHT=180&SRS=EPSG:4326&BBOX=${matchResult.lng-0.0014},${matchResult.lat-0.0008},${matchResult.lng+0.0014},${matchResult.lat+0.0008}`}
                                alt="Vue aérienne"
                                style={{width:"100%",height:160,objectFit:"cover",display:"block"}}
                              />
                              <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.45)",padding:"4px 8px",fontSize:10,color:"#fff",fontWeight:600}}>
                                Vue aérienne IGN — vérifiez que c'est bien ce bien
                              </div>
                            </div>
                          )}
                          {matchResult.parcel&&(
                            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                              <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:3}}>Parcelle {matchResult.parcel.section}{matchResult.parcel.numero}</div>
                              <div style={{fontSize:11,color:C.muted}}>{matchResult.parcel.contenance} m² · {matchResult.parcel.commune}</div>
                              {matchResult.adresse&&<div style={{fontSize:11,color:C.text,marginTop:4,fontWeight:500}}>{matchResult.adresse}</div>}
                            </div>
                          )}
                          {/* Propriétaires */}
                          {matchResult.pappers_immo?.proprietaires?.length>0?(
                            <div style={{background:C.green+"12",border:`1px solid ${C.green}35`,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                              <div style={{fontSize:11,fontWeight:700,color:C.green,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>
                                {matchResult.pappers_immo.proprietaires.length>1?"Propriétaires":"Propriétaire"}
                              </div>
                              {matchResult.pappers_immo.proprietaires.map((p:any,i:number)=>(
                                <div key={i} style={{marginBottom:i<matchResult.pappers_immo.proprietaires.length-1?6:0}}>
                                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{p.nom}</div>
                                  {p.siren&&<a href={`https://www.pappers.fr/entreprise/${p.siren}`} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.blue,textDecoration:"none",fontWeight:600}}>SIREN {p.siren} →</a>}
                                </div>
                              ))}
                              {matchResult.pappers_immo.adresse&&(
                                <div style={{fontSize:10,color:C.muted,marginTop:6,paddingTop:6,borderTop:`1px solid ${C.green}25`}}>
                                  Fichiers Fonciers : {matchResult.pappers_immo.adresse}
                                </div>
                              )}
                            </div>
                          ):matchResult.owner?.nom?(
                            <div style={{background:C.green+"12",border:`1px solid ${C.green}35`,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                              <div style={{fontSize:11,fontWeight:700,color:C.green,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Propriétaire</div>
                              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{matchResult.owner.nom}</div>
                              {matchResult.owner.entreprise&&matchResult.owner.entreprise!==matchResult.owner.nom&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>{matchResult.owner.entreprise}</div>}
                              {matchResult.owner.siren&&<a href={`https://www.pappers.fr/entreprise/${matchResult.owner.siren}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",marginTop:4,fontSize:10,color:C.blue,textDecoration:"none",fontWeight:600}}>SIREN {matchResult.owner.siren} →</a>}
                            </div>
                          ):(
                            <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Propriétaire non identifié</div>
                          )}
                          {/* Dossier complet Pappers Immo (10 crédits, à la demande) */}
                          {matchResult.lat&&matchResult.lng&&!fullDossierResult&&(
                            <button
                              disabled={fullDossierLoading}
                              onClick={async()=>{
                                setFullDossierLoading(true);
                                try {
                                  const r = await fetch(`/api/pappers-immo-full?lat=${matchResult.lat}&lng=${matchResult.lng}`);
                                  const d = await r.json();
                                  setFullDossierResult(d.error?null:d);
                                } catch {}
                                setFullDossierLoading(false);
                              }}
                              style={{width:"100%",marginBottom:8,background:"none",border:`1px solid ${C.border}`,color:fullDossierLoading?C.muted:C.blue,borderRadius:8,padding:"8px 0",fontSize:12,fontWeight:600,cursor:fullDossierLoading?"not-allowed":"pointer",letterSpacing:"-0.01em"}}
                            >
                              {fullDossierLoading?"Chargement du dossier...":"Voir le dossier complet"}
                            </button>
                          )}
                          {fullDossierResult&&(
                            <div style={{marginBottom:8}}>
                              {fullDossierResult.ventes?.length>0&&(
                                <div style={{border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                                  <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Historique ventes</div>
                                  {fullDossierResult.ventes.map((v:any,i:number)=>(
                                    <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.text,padding:"3px 0",borderBottom:i<fullDossierResult.ventes.length-1?`1px solid ${C.border}`:"none"}}>
                                      <span style={{color:C.muted}}>{v.date}</span>
                                      <span style={{fontWeight:600}}>{v.prix?.toLocaleString("fr-FR")} €</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(fullDossierResult.batiments?.length>0||fullDossierResult.dpe?.length>0)&&(
                                <div style={{border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                                  <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Bâtiment</div>
                                  {fullDossierResult.batiments?.[0]&&(
                                    <div style={{fontSize:11,color:C.text,lineHeight:1.6}}>
                                      {[
                                        fullDossierResult.batiments[0].surface&&`${fullDossierResult.batiments[0].surface} m²`,
                                        fullDossierResult.batiments[0].annee_construction&&`Construit en ${fullDossierResult.batiments[0].annee_construction}`,
                                        fullDossierResult.batiments[0].usage,
                                      ].filter(Boolean).join(" · ")}
                                    </div>
                                  )}
                                  {fullDossierResult.dpe?.[0]&&(
                                    <div style={{marginTop:4,display:"flex",alignItems:"center",gap:6}}>
                                      <span style={{fontSize:11,color:C.muted}}>DPE</span>
                                      <span style={{fontSize:12,fontWeight:700,padding:"1px 7px",borderRadius:4,background:fullDossierResult.dpe[0].classe_bilan==="A"||fullDossierResult.dpe[0].classe_bilan==="B"?"#dcfce7":fullDossierResult.dpe[0].classe_bilan==="F"||fullDossierResult.dpe[0].classe_bilan==="G"?"#fee2e2":"#fef9c3",color:"#374151"}}>
                                        {fullDossierResult.dpe[0].classe_bilan}
                                      </span>
                                      {fullDossierResult.dpe[0].classe_ges&&<span style={{fontSize:11,color:C.muted}}>GES {fullDossierResult.dpe[0].classe_ges}</span>}
                                    </div>
                                  )}
                                </div>
                              )}
                              {fullDossierResult.permis?.length>0&&(
                                <div style={{border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
                                  <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Permis de construire</div>
                                  {fullDossierResult.permis.map((pm:any,i:number)=>(
                                    <div key={i} style={{fontSize:11,color:C.text,padding:"2px 0"}}>{pm.statut}{pm.date?` — ${pm.date}`:""}{pm.nature?` (${pm.nature})`:""}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {matchResult.surface_warning&&(
                            <div style={{fontSize:11,color:"#c8730a",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:6,padding:"5px 8px",marginBottom:8}}>
                              ⚠ {matchResult.surface_warning}
                            </div>
                          )}
                          {matchResult.vision_score>0&&(
                            <div style={{fontSize:11,color:C.muted,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
                              Score correspondance : {matchResult.vision_score}%
                              {matchResult.vision_reason&&<span style={{display:"block",marginTop:1}}>{matchResult.vision_reason}</span>}
                            </div>
                          )}
                          <div style={{display:"flex",gap:8,marginTop:8}}>
                            {matchResult.geoportailUrl&&(
                              <a href={matchResult.geoportailUrl} target="_blank" rel="noopener noreferrer"
                                style={{flex:1,display:"block",padding:"8px 0",background:C.blue+"15",border:`1px solid ${C.blue}30`,borderRadius:8,fontSize:12,color:C.blue,textAlign:"center",textDecoration:"none",fontWeight:600}}>
                                Satellite IGN →
                              </a>
                            )}
                            {matchResult.adresse&&(
                              <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent(matchResult.adresse)}`} target="_blank" rel="noopener noreferrer"
                                style={{flex:1,display:"block",padding:"8px 0",background:"#f0f7ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:12,color:"#1d4ed8",textAlign:"center",textDecoration:"none",fontWeight:600}}>
                                Pappers Immo →
                              </a>
                            )}
                          </div>
                          {matchResult.parcel&&(
                            <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent((matchResult.parcel.commune||"")+" section "+matchResult.parcel.section+" "+matchResult.parcel.numero)}`} target="_blank" rel="noopener noreferrer"
                              style={{display:"block",marginTop:6,padding:"7px 0",background:"#f0f7ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:11,color:"#1d4ed8",textAlign:"center",textDecoration:"none"}}>
                              Voir parcelle {matchResult.parcel.section}{matchResult.parcel.numero} sur Pappers Immobilier →
                            </a>
                          )}
                          <button onClick={()=>{setMatchResult(null);setFullDossierResult(null);}} style={{marginTop:8,width:"100%",background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 0",fontSize:12,cursor:"pointer"}}>Réessayer</button>
                        </div>
                      )}
                      {/* Match result — bien non identifié : candidats DVF à comparer */}
                      {matchResult&&!matchResult.error&&!matchResult.matched&&(
                        <div style={{marginTop:4}}>
                          <div style={{fontSize:11,color:C.amber,fontWeight:600,marginBottom:8}}>
                            Bien non identifié — comparez les candidats ci-dessous avec les photos de l'annonce
                          </div>
                          {matchResult.descriptor&&(
                            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:11,color:C.text,lineHeight:1.5}}>
                              <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.05em"}}>Descriptif IA de l'annonce</div>
                              {[
                                matchResult.descriptor.piscine&&`Piscine ${matchResult.descriptor.piscine_forme||""}`,
                                matchResult.descriptor.tennis&&"Tennis",
                                matchResult.descriptor.etages&&`${matchResult.descriptor.etages} étage(s)`,
                                matchResult.descriptor.toiture&&`Toit ${matchResult.descriptor.toiture.replace(/_/g," ")}`,
                                matchResult.descriptor.facade_couleur&&`Façade ${matchResult.descriptor.facade_couleur}`,
                                matchResult.descriptor.volets&&matchResult.descriptor.volets!=="aucun"&&`Volets ${matchResult.descriptor.volets.replace(/_/g," ")}`,
                              ].filter(Boolean).join(" · ")}
                              {matchResult.descriptor.descriptif&&<div style={{color:C.muted,marginTop:2,fontStyle:"italic"}}>{matchResult.descriptor.descriptif}</div>}
                            </div>
                          )}
                          {(matchResult.dvf_candidates||[]).map((c:any,i:number)=>{
                            const ignUrl = c.lat&&c.lng
                              ? `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&WIDTH=280&HEIGHT=160&SRS=EPSG:4326&BBOX=${c.lng-0.0018},${c.lat-0.001},${c.lng+0.0018},${c.lat+0.001}`
                              : null;
                            return (
                              <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",marginBottom:10}}>
                                {ignUrl&&(
                                  <div style={{position:"relative",height:120,background:C.surface}}>
                                    <img src={ignUrl} alt="Vue satellite" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                    {c.vision_score!==null&&c.vision_score>0&&(
                                      <div style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,0.6)",color:"#fff",fontSize:10,fontWeight:700,borderRadius:4,padding:"2px 6px"}}>
                                        Score {c.vision_score}%
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div style={{padding:"8px 10px"}}>
                                  <div style={{fontSize:11,fontWeight:600,color:C.text,marginBottom:2}}>{c.adresse}</div>
                                  <div style={{fontSize:10,color:C.muted,marginBottom:6}}>
                                    {c.surface_bati}m² bâti{c.surface_terrain>0?` · ${c.surface_terrain}m² terrain`:""}
                                  </div>
                                  <div style={{display:"flex",gap:8}}>
                                    {c.geoportailUrl&&(
                                      <a href={c.geoportailUrl} target="_blank" rel="noopener noreferrer"
                                        style={{fontSize:10,color:C.blue,textDecoration:"none",fontWeight:600}}>
                                        Satellite →
                                      </a>
                                    )}
                                    <a href={`https://immobilier.pappers.fr/?q=${encodeURIComponent(c.adresse)}`} target="_blank" rel="noopener noreferrer"
                                      style={{fontSize:10,color:"#1d4ed8",textDecoration:"none",fontWeight:600}}>
                                      Pappers Immo →
                                    </a>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <button onClick={()=>{setMatchResult(null);setFullDossierResult(null);}} style={{marginTop:4,width:"100%",background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 0",fontSize:12,cursor:"pointer"}}>Réessayer</button>
                        </div>
                      )}
                      {matchResult?.error&&(
                        <div style={{marginTop:8,fontSize:12,color:C.red}}>{matchResult.error}</div>
                      )}
                      {!selAnnonce.lat&&!selAnnonce.lng&&(
                        <div style={{fontSize:11,color:C.muted,marginTop:8}}>Coordonnées GPS non disponibles pour ce bien.</div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
            )}
          </div>
        )}

        {/* AGENT IA PANEL */}
        {chat&&(
          <div style={{width:320,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",background:C.surface,flexShrink:0}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite"}}/>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>{agent.prenom||"Agent IA"}</span>
              </div>
              <button onClick={()=>setChat(false)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:8}}>
              {msgs.map(m=>(
                <div key={m.id} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{maxWidth:"88%",padding:"10px 14px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?C.accent:C.card,color:m.role==="user"?(dark?"#080808":"#FAFAFA"):C.text,fontSize:13,lineHeight:1.55,border:m.role==="agent"?`1px solid ${C.border}`:"none"}}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing&&(
                <div style={{display:"flex",gap:4,padding:"10px 14px",background:C.card,borderRadius:"16px 16px 16px 4px",width:"fit-content",border:`1px solid ${C.border}`}}>
                  {[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:C.muted,animation:`pulse 1.2s infinite ${i*0.2}s`}}/>)}
                </div>
              )}
              <div ref={chatEnd}/>
            </div>
            <div style={{padding:12,borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()} placeholder="Posez votre question..." style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 13px",fontSize:13,transition:"border-color 0.15s"}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
              <button onClick={sendMsg} style={{background:C.accent,border:"none",color:dark?"#080808":"#FAFAFA",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>→</button>
            </div>
          </div>
        )}

        {/* EMAIL MODAL */}
        {emailModal&&(
          <div onClick={()=>setEmailModal(null)} style={{position:"absolute",inset:0,zIndex:200,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} style={{width:560,background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:28,boxShadow:`0 24px 64px ${C.shadow}`,animation:"fadeUp 0.2s ease"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
                <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em"}}>Nouveau message</div>
                <button onClick={()=>setEmailModal(null)} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
                <div>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>À</div>
                  <input value={emailModal.to} onChange={e=>setEmailModal(x=>x?{...x,to:e.target.value}:null)} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>Objet</div>
                  <input value={emailModal.sujet} onChange={e=>setEmailModal(x=>x?{...x,sujet:e.target.value}:null)} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                </div>
              </div>
              <button disabled={emailModal.loading} onClick={async()=>{
                setEmailModal(x=>x?{...x,loading:true}:null);
                try{
                  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                    system:`Tu es un assistant expert en communication immobilière professionnelle. Rédige uniquement le corps de l'email, sans "Objet:" ni en-tête. Signe: ${agent.prenom} ${agent.nom}, ${agent.agence}.`,
                    messages:[{role:"user",content:`Rédige un email professionnel avec l'objet "${emailModal.sujet}" à envoyer à "${emailModal.to}". Contexte: ${emailModal.corps||"email professionnel immobilier"}. 3-4 paragraphes concis.`}],
                    max_tokens:500
                  })});
                  const d=await res.json();
                  setEmailModal(x=>x?{...x,loading:false,corps:d.content?.[0]?.text||""}:null);
                }catch{setEmailModal(x=>x?{...x,loading:false}:null);}
              }} style={{width:"100%",background:emailModal.corps?C.surface:emailModal.loading?C.border:C.accent,color:emailModal.corps?C.muted:emailModal.loading?C.muted:(dark?"#080808":"#FAFAFA"),border:emailModal.corps?`1px solid ${C.border}`:"none",borderRadius:8,padding:"10px",fontSize:13,fontWeight:500,cursor:emailModal.loading?"default":"pointer",marginBottom:12,transition:"all 0.15s"}}>
                {emailModal.loading?"Génération en cours...":emailModal.corps?"Regénérer":"Générer avec Lucas"}
              </button>
              {emailModal.corps&&(
                <textarea value={emailModal.corps} onChange={e=>setEmailModal(x=>x?{...x,corps:e.target.value}:null)} rows={8} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"12px",fontSize:13,lineHeight:1.6,resize:"vertical",marginBottom:14}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
              )}
              {emailModal.sendError&&<div style={{fontSize:12,color:C.red,background:C.red+"10",borderRadius:8,padding:"8px 12px",marginBottom:10}}>{emailModal.sendError}</div>}
              {emailModal.sent&&<div style={{fontSize:12,color:C.green,background:C.green+"10",borderRadius:8,padding:"8px 12px",marginBottom:10}}>Email envoyé.</div>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                {emailModal.corps&&(
                  <button disabled={emailModal.sending} onClick={async()=>{
                    setEmailModal(x=>x?{...x,sending:true,sent:false,sendError:undefined}:null);
                    try{
                      const r=await fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:emailModal.to,sujet:emailModal.sujet,corps:emailModal.corps})});
                      const d=await r.json();
                      if(d.error)setEmailModal(x=>x?{...x,sending:false,sendError:d.error}:null);
                      else setEmailModal(x=>x?{...x,sending:false,sent:true}:null);
                    }catch(e:any){setEmailModal(x=>x?{...x,sending:false,sendError:e.message}:null);}
                  }} style={{background:emailModal.sending?C.border:C.green,color:emailModal.sending?C.muted:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:emailModal.sending?"default":"pointer"}}>
                    {emailModal.sending?"Envoi...":"Envoyer"}
                  </button>
                )}
                {emailModal.corps&&<button onClick={()=>{const m=`mailto:${emailModal.to}?subject=${encodeURIComponent(emailModal.sujet)}&body=${encodeURIComponent(emailModal.corps)}`;window.open(m);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 14px",fontSize:13,color:C.text,cursor:"pointer"}}>Messagerie</button>}
                {emailModal.corps&&<button onClick={()=>navigator.clipboard.writeText(emailModal!.corps)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 14px",fontSize:13,color:C.text,cursor:"pointer"}}>Copier</button>}
              </div>
            </div>
          </div>
        )}

        {/* STRIPE MODAL */}
        {stripeModal&&(
          <div onClick={()=>{setStripeModal(false);setStripeMsg("");}} style={{position:"absolute",inset:0,zIndex:200,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} style={{...card(),width:400,padding:32,position:"relative",borderColor:C.gold+"40"}}>
              <button onClick={()=>{setStripeModal(false);setStripeMsg("");}} style={{position:"absolute",top:16,right:16,background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer"}}>×</button>
              <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:4,letterSpacing:"-0.02em"}}>Mandatly Pro</div>
              <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Accès illimité à toutes les fonctionnalités</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
                {["Prospection DVF + DPE illimitée","Identification propriétaires Vision IA","Signature électronique Yousign","Données synchronisées Supabase","Lucas IA illimité","Courriers postaux Merci Facteur"].map(f=>(
                  <div key={f} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:C.text}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:C.gold,flexShrink:0}}/>
                    {f}
                  </div>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:24}}>
                <span style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em"}}>49 €</span>
                <span style={{fontSize:13,color:C.muted}}>/mois · 14 jours d'essai gratuit</span>
              </div>
              {stripeMsg?(
                <div style={{padding:"12px 16px",background:C.green+"15",border:`1px solid ${C.green}30`,borderRadius:8,fontSize:13,color:C.green,textAlign:"center"}}>{stripeMsg}</div>
              ):(
                <button disabled={stripeLoading} onClick={async()=>{
                  setStripeLoading(true);
                  const email = user?.email;
                  if(!email){setStripeLoading(false);setStripeModal(false);router.push("/login");return;}
                  const r = await fetch("/api/stripe/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,userId:user?.id})});
                  const d = await r.json();
                  setStripeLoading(false);
                  if(d.url) window.location.href = d.url;
                  else if(d.error){
                    if(d.error.includes("non configuré")||d.error.includes("STRIPE_")){
                      setStripeMsg("Stripe non configuré — ajoutez STRIPE_SECRET_KEY et STRIPE_PRICE_ID dans Vercel.");
                    } else {
                      setStripeMsg("Erreur : "+d.error);
                    }
                  }
                }} style={{width:"100%",padding:"14px 0",background:stripeLoading?C.border:C.gold,color:stripeLoading?C.muted:"#000",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:stripeLoading?"not-allowed":"pointer",transition:"all 0.15s"}}>
                  {stripeLoading?"Redirection...":"Commencer l'essai gratuit"}
                </button>
              )}
              <div style={{fontSize:10,color:C.muted,textAlign:"center",marginTop:12}}>Résiliable à tout moment · Paiement sécurisé Stripe</div>
            </div>
          </div>
        )}

        {/* PROFILE DROPDOWN */}
        {profile&&(
          <div onClick={()=>setProfile(false)} style={{position:"absolute",inset:0,zIndex:90}}>
            <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:56,right:16,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:8,minWidth:200,zIndex:100,boxShadow:`0 16px 48px ${C.shadow}`}}>
              <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,marginBottom:4}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{agent.prenom} {agent.nom}</div>
                <div style={{fontSize:12,color:C.muted}}>{agent.agence}</div>
              </div>
              {[["Radar","radar"],["Carte","prospects"],["Mandats","mandats"],["Comptabilité","compta"],["Estimation","estimation"],["Courriers","courriers"],["Agenda","agenda"]].map(([l,id])=>(
                <button key={l} onClick={()=>{setNav(id);setProfile(false);}} style={{width:"100%",display:"flex",padding:"8px 14px",background:"none",border:"none",color:C.text,fontSize:13,textAlign:"left",borderRadius:8,cursor:"pointer"}}>
                  {l}
                </button>
              ))}
              <div style={{borderTop:`1px solid ${C.border}`,marginTop:4,paddingTop:4}}>
                <button onClick={()=>{localStorage.removeItem("m_setup");setOnboarding(true);setProfile(false);}} style={{width:"100%",display:"flex",padding:"8px 14px",background:"none",border:"none",color:C.red,fontSize:13,textAlign:"left",borderRadius:8,cursor:"pointer"}}>
                  Réinitialiser
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
