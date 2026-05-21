"use client";
import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { getSupabase } from "../lib/supabase";

const MapComponent = lazy(() => import("./map-component"));

// ── Estimation & Avis de valeur via DVF ──────────────────────
async function lancerEstimation(type: string, surface: number, ville: string, etat: string) {
  const dvfRes = await fetch(
    `/api/dvf?ville=${encodeURIComponent(ville)}&mode=estimation&type=${encodeURIComponent(type)}&surface=${surface}`
  );
  if (!dvfRes.ok) throw new Error("API DVF indisponible");
  const dvfData = await dvfRes.json();
  const comparables: any[] = dvfData.transactions || [];

  const prixM2s = comparables
    .map((t: any) => t.valeur_fonciere / t.surface_reelle_bati)
    .filter((p: number) => p > 500 && p < 25000)
    .sort((a: number, b: number) => a - b);

  if (prixM2s.length < 3) throw new Error(`Seulement ${prixM2s.length} comparable(s) DVF — élargissez le rayon ou changez de ville`);

  const mid = Math.floor(prixM2s.length / 2);
  const median = prixM2s.length % 2 ? prixM2s[mid] : (prixM2s[mid-1] + prixM2s[mid]) / 2;
  const facteur = etat==="neuf"?1.12:etat==="bon"?1.0:etat==="moyen"?0.91:0.77;
  const base = median * surface * facteur;

  return {
    ville: dvfData.ville, nb_comparables: comparables.length,
    prix_m2_median: Math.round(median),
    prix_m2_min: Math.round(prixM2s[0]),
    prix_m2_max: Math.round(prixM2s[prixM2s.length-1]),
    estimation: Math.round(base),
    fourchette_bas: Math.round(base * 0.91),
    fourchette_haut: Math.round(base * 1.09),
    comparables: comparables.slice(0, 6).map((t: any) => ({
      adresse: `${t.adresse_numero||""} ${t.adresse_nom_voie||""}`.trim() || "—",
      surface: t.surface_reelle_bati, prix: t.valeur_fonciere,
      prix_m2: Math.round(t.valeur_fonciere / t.surface_reelle_bati),
      date: t.date_mutation?.slice(0, 7) || "",
    })),
  };
}

type Mandat = { id:number; adresse:string; nom_propriete:string; ville:string; prix:number; surface:number; terrain:number; chambres:number; dpe:string; type:string; statut:string; pipeline:string; proprietaire:string; tel:string; email:string; honoraires:number; exclusif:boolean; fin_mandat:string; description:string; signature_request_id?:string; signature_status?:string; };
type SignatureState = { loading:boolean; url?:string; error?:string; sandbox?:boolean; };
type Prospect = { id:any; nom?:string; adresse:string; ville:string; score:number; source:string; status:string; notes:string; lat?:number; lng?:number; anciennete?:number; prix_achat?:number; proprietaire_nom?:string; civilite?:string; proprietaire_source?:string; proprietaire_chargement?:boolean; };
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
  const [dark, setDark] = useState(false);
  const [nav, setNav] = useState("dashboard");
  const [mandats, setMandats] = useState<Mandat[]>(()=>{
    if(typeof window==="undefined") return MANDATS;
    try{const s=localStorage.getItem("m_mandats");return s?JSON.parse(s):MANDATS;}catch{return MANDATS;}
  });
  const [prospects, setProspects] = useState<Prospect[]>(PROSPECTS);
  const [dvfLoading, setDvfLoading] = useState(false);
  const [dvfError, setDvfError] = useState("");
  const [mapCenter, setMapCenter] = useState<[number,number]>([44.837, -0.579]);
  const [selProspect, setSelProspect] = useState<Prospect|null>(null);
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
  const [profile, setProfile] = useState(false);
  // Estimation
  const [estForm, setEstForm] = useState({type:"Maison",surface:"",ville:"",etat:"bon"});
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
  // Email modal
  type EmailModal = {to:string; sujet:string; corps:string; loading:boolean; sending?:boolean; sent?:boolean; sendError?:string};
  const [emailModal, setEmailModal] = useState<EmailModal|null>(null);
  // Supabase auth
  const [user, setUser] = useState<any>(null);
  const [authModal, setAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  // Yousign signature
  const [sigState, setSigState] = useState<Record<number,SignatureState>>({});
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

  // Supabase: init auth listener + load data on login
  useEffect(()=>{
    const sb = getSupabase();
    if(!sb) return;
    sb.auth.getUser().then(({data:{user}})=>{
      if(user){ setUser(user); loadSupabase(sb, user.id); }
    });
    const {data:{subscription}} = sb.auth.onAuthStateChange((_,session)=>{
      const u = session?.user ?? null;
      setUser(u);
      if(u) loadSupabase(sb, u.id);
    });
    return ()=>subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function loadSupabase(sb: NonNullable<ReturnType<typeof getSupabase>>, userId: string) {
    const {data} = await sb.from("user_data").select("*").eq("user_id", userId).single();
    if(!data) return;
    if(data.mandats?.length) setMandats(data.mandats);
    if(data.acheteurs?.length) setAcheteurs(data.acheteurs);
    if(data.rdvs?.length) setRdvs(data.rdvs);
    if(data.transacs?.length) setTransacs(data.transacs);
    if(data.courriers?.length) setCourrierHisto(data.courriers);
    if(data.agent?.prenom) setAgent(data.agent);
  }

  // Supabase: debounced sync on any data change
  const syncTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    const sb = getSupabase();
    if(!sb||!user) return;
    if(syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async()=>{
      await sb.from("user_data").upsert({
        user_id: user.id, mandats, acheteurs, rdvs, transacs,
        courriers: courrierHisto, agent, updated_at: new Date().toISOString()
      });
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mandats, acheteurs, rdvs, transacs, courrierHisto, agent]);

  // Auto-generate courrier when a prospect is selected in prospection tab
  useEffect(()=>{
    if(!selProspect) { setAutoCourrierContent(""); setAutoCourrierLoading(false); setAutoMfDone(null); return; }
    setAutoCourrierLoading(true); setAutoCourrierContent(""); setAutoMfDone(null);
    const p = selProspect;
    const nomCtx = p.proprietaire_nom ? ` Le propriétaire identifié est ${p.proprietaire_nom}${p.proprietaire_source ? " (source : "+p.proprietaire_source+")" : ""}.` : "";
    const templatePrompts: Record<string,string> = {
      prospection: `Rédige un courrier de prospection immobilière pour un propriétaire habitant au ${p.adresse}, ${p.ville}. Le bien a été acheté il y a environ ${(p as any).anciennete||"plusieurs"} années. ${p.notes}.${nomCtx} Ton nom est ${agent.prenom} ${agent.nom} de ${agent.agence}. Sois professionnel, personnalisé, 3 paragraphes maximum. Commence OBLIGATOIREMENT par "Madame, Monsieur," sur la première ligne.`,
      relance: `Rédige un courrier de relance pour un propriétaire au ${p.adresse}, ${p.ville} que j'ai déjà contacté il y a 3 semaines sans réponse. ${p.notes}.${nomCtx} Signe en tant que ${agent.prenom} ${agent.nom}, ${agent.agence}. Bref et percutant, 2 paragraphes. Commence par "Madame, Monsieur,".`,
      offre: `Rédige un courrier informant le propriétaire au ${p.adresse}, ${p.ville} qu'un acheteur sérieux recherche exactement son type de bien dans ce secteur. ${p.notes}.${nomCtx} Signe: ${agent.prenom} ${agent.nom}, ${agent.agence}. Commence par "Madame, Monsieur,".`,
    };
    fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      system:`Tu es Lucas, assistant IA de ${agent.prenom} ${agent.nom} chez ${agent.agence}. Tu rédiges uniquement le texte du courrier, sans introduction ni explication supplémentaire.`,
      messages:[{role:"user",content:templatePrompts[autoCourrierTemplate]||templatePrompts.prospection}],
      max_tokens:700
    })})
    .then(r=>r.json())
    .then(d=>{ setAutoCourrierContent(d.content?.[0]?.text||d.error||"Erreur de génération"); setAutoCourrierLoading(false); })
    .catch(()=>{ setAutoCourrierContent("Erreur de connexion — vérifiez ANTHROPIC_API_KEY dans Vercel."); setAutoCourrierLoading(false); });
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
          const r = await fetch(`/api/proprietaire?lat=${p.lat}&lng=${p.lng}&adresse=${encodeURIComponent(p.adresse + " " + p.ville)}`);
          if (!r.ok) return;
          const d = await r.json();
          setProspects(prev => prev.map(x => x.id === p.id ? {
            ...x,
            proprietaire_nom: d.proprietaire_nom || "",
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
  const handleProspect = useCallback(async (ville: string) => {
    if (!ville.trim()) return;
    setDvfLoading(true);
    setDvfError("");
    setSelProspect(null);
    setProspects([]);
    setSelProspects(new Set());
    setDvfStats(null);
    setSrcStatus({dvf:"loading", dpe:"loading", enrichir:"idle"});

    // Lance DVF + DPE en parallèle
    const [dvfResult, dpeResult] = await Promise.allSettled([
      fetch(`/api/dvf?ville=${encodeURIComponent(ville)}`).then(r => r.json()),
      fetch(`/api/dpe?commune=${encodeURIComponent(ville)}`).then(r => r.json()),
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
      const r = await fetch(`/api/annonces?ville=${encodeURIComponent(ville)}&size=60`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAnnonces(d.annonces || []);
    } catch (err: any) { setAnnoncesError(err.message || "Erreur"); }
    setAnnoncesLoading(false);
  }, [annoncesLoading]);

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
      setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:d.content?.[0]?.text||"Désolé, je n'ai pas pu répondre."}]);
    } catch {
      setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:"Erreur de connexion."}]);
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
  const NAVS = [{id:"dashboard",label:"Vue d'ensemble"},{id:"prospects",label:"Prospection"},{id:"veille",label:"Veille"},{id:"mandats",label:"Mandats"},{id:"pipeline",label:"Pipeline"},{id:"acheteurs",label:"Acheteurs"},{id:"agenda",label:"Agenda"},{id:"estimation",label:"Estimation"},{id:"compta",label:"Comptabilité"},{id:"courriers",label:"Courriers"}];

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
          {getSupabase()&&(
            user?(
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:C.green+"15",border:`1px solid ${C.green}25`,borderRadius:8}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:C.green}}/>
                <span style={{fontSize:11,color:C.green,fontWeight:500}}>{user.email?.split("@")[0]}</span>
                <button onClick={async()=>{const sb=getSupabase();if(sb){await sb.auth.signOut();setUser(null);}}} style={{background:"none",border:"none",color:C.muted,fontSize:11,cursor:"pointer",marginLeft:2}}>×</button>
              </div>
            ):(
              <button onClick={()=>setAuthModal(true)} style={{padding:"5px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.muted,cursor:"pointer",fontWeight:500}}>Connexion</button>
            )
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

        {/* DASHBOARD */}
        {nav==="dashboard"&&(
          <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
            <div style={{marginBottom:36}}>
              <div style={{fontSize:11,color:C.gold,fontWeight:600,letterSpacing:"0.18em",textTransform:"uppercase",marginBottom:8}}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
              <h1 style={{fontFamily:DISPLAY,fontSize:40,fontWeight:400,color:C.text,letterSpacing:"-0.01em",lineHeight:1.1,fontStyle:"italic"}}>Bonjour, {agent.prenom}</h1>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:32}}>
              {[{l:"Mandats",v:mandats.length,sub:"actifs",nav:"mandats"},{l:"CA encaissé",v:fmt(transacs.filter(t=>t.statut==="encaisse").reduce((a,t)=>a+t.montant,0))+" €",sub:`/ ${fmt(transacs.reduce((a,t)=>a+t.montant,0))} prévu`,nav:"compta"},{l:"Prospects",v:prospects.length,sub:"identifiés",nav:"prospects"},{l:"Courriers",v:courrierHisto.length,sub:`${courrierHisto.filter(h=>h.statut==="repondu").length} répondu(s)`,nav:"courriers"},{l:"Rendez-vous",v:rdvs.length,sub:"à venir",nav:"agenda"}].map(k=>(
                <div key={k.l} onClick={()=>setNav((k as any).nav)} style={{...card(),padding:"20px 24px",cursor:"pointer",transition:"transform 0.15s, box-shadow 0.15s"}} onMouseOver={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 4px 20px ${C.shadow}`;}} onMouseOut={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=`0 1px 3px ${C.shadow}`;}} >
                  <div style={{fontSize:10,color:C.gold,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:10}}>{k.l}</div>
                  <div style={{fontFamily:DISPLAY,fontSize:30,fontWeight:600,color:C.text,letterSpacing:"-0.01em",marginBottom:4,lineHeight:1}}>{k.v}</div>
                  <div style={{fontSize:11,color:C.muted,letterSpacing:"0.01em"}}>{k.sub}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,marginBottom:20}}>
              <div style={{...card(),padding:"24px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
                  <div style={{fontFamily:DISPLAY,fontSize:16,fontWeight:600,color:C.text,letterSpacing:"0.01em"}}>Mandats</div>
                  <button onClick={()=>setNav("mandats")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",letterSpacing:"0.06em",fontWeight:500}}>Voir tout →</button>
                </div>
                {mandats.map((m,i)=>(
                  <div key={m.id} onClick={()=>{setNav("mandats");setSelM(m);}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<mandats.length-1?`1px solid ${C.border}`:"none",cursor:"pointer"}} onMouseOver={e=>e.currentTarget.style.opacity="0.7"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:PIPELINE_COLS.find(p=>p.id===m.pipeline)?.color||C.muted,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                      <div style={{fontSize:11,color:C.muted}}>{m.proprietaire}</div>
                    </div>
                    <div style={{fontFamily:DISPLAY,fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(m.prix)} €</div>
                  </div>
                ))}
              </div>
              <div style={{...card(),padding:"24px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
                  <div style={{fontFamily:DISPLAY,fontSize:16,fontWeight:600,color:C.text,letterSpacing:"0.01em"}}>Prospects prioritaires</div>
                  <button onClick={()=>setNav("prospects")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",letterSpacing:"0.06em",fontWeight:500}}>Prospecter →</button>
                </div>
                {prospects.filter(p=>p.score>=75).slice(0,5).map((p,i,arr)=>{
                  const col=p.score>=85?C.green:C.amber;
                  return(
                    <div key={p.id} onClick={()=>{setNav("prospects");setSelProspect(p as any);}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",cursor:"pointer"}} onMouseOver={e=>e.currentTarget.style.opacity="0.7"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
                      <div style={{width:24,height:24,borderRadius:5,background:col+"15",border:`1px solid ${col}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:col,flexShrink:0}}>{p.score}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>
                        <div style={{fontSize:11,color:C.muted}}>{p.source}</div>
                      </div>
                    </div>
                  );
                })}
                {prospects.filter(p=>p.score>=75).length===0&&<div style={{fontSize:12,color:C.muted,textAlign:"center",paddingTop:16}}>Lancez une prospection DVF</div>}
              </div>
              <div style={{...card(),padding:"24px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
                  <div style={{fontFamily:DISPLAY,fontSize:16,fontWeight:600,color:C.text,letterSpacing:"0.01em"}}>Agenda</div>
                  <button onClick={()=>setNav("agenda")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",letterSpacing:"0.06em",fontWeight:500}}>Voir tout →</button>
                </div>
                {rdvs.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4).map((r,i,arr)=>(
                  <div key={r.id} style={{display:"flex",gap:12,padding:"9px 0",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{width:3,minHeight:36,borderRadius:2,background:r.type==="visite"?C.green:r.type==="signature"?C.amber:C.blue,flexShrink:0,alignSelf:"stretch"}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:1}}>{r.titre}</div>
                      <div style={{fontSize:11,color:C.muted}}>{new Date(r.date+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})} · {r.heure}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* COURRIERS ROW */}
            <div style={{...card(),padding:"24px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
                <div style={{fontFamily:DISPLAY,fontSize:16,fontWeight:600,color:C.text,letterSpacing:"0.01em"}}>Suivi courriers</div>
                <button onClick={()=>setNav("courriers")} style={{fontSize:11,color:C.gold,background:"none",border:"none",cursor:"pointer",letterSpacing:"0.06em",fontWeight:500}}>Gérer →</button>
              </div>
              {courrierHisto.length===0?(
                <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:12}}>Aucun courrier envoyé — générez votre premier courrier dans l&apos;onglet Courriers</div>
              ):(
                <>
                  {/* KPI mini-stats */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
                    {[
                      {l:"Envoyés",v:courrierHisto.length,color:C.blue},
                      {l:"En attente",v:courrierHisto.filter(h=>h.statut==="envoye").length,color:C.amber},
                      {l:"Répondus",v:courrierHisto.filter(h=>h.statut==="repondu").length,color:C.green},
                    ].map(s=>(
                      <div key={s.l} style={{background:s.color+"0D",border:`1px solid ${s.color}20`,borderRadius:10,padding:"12px 16px"}}>
                        <div style={{fontSize:10,color:s.color,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{s.l}</div>
                        <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Recent history */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:8}}>
                    {["Adresse","Type","Date","Statut","Action"].map(h=>(
                      <div key={h} style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                    ))}
                  </div>
                  {courrierHisto.slice(0,6).map(h=>(
                    <div key={h.id} style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,padding:"9px 0",borderTop:`1px solid ${C.border}`,alignItems:"center"}}>
                      <div style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.prospect_adresse}</div>
                      <div style={{fontSize:12,color:C.muted}}>{h.template==="prospection"?"Prospection":h.template==="relance"?"Relance":"Offre"}</div>
                      <div style={{fontSize:12,color:C.muted}}>{h.date}</div>
                      <div>
                        <span style={{fontSize:10,fontWeight:600,color:h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue,background:(h.statut==="repondu"?C.green:h.statut==="relance"?C.amber:C.blue)+"15",borderRadius:4,padding:"2px 7px"}}>
                          {h.statut==="repondu"?"Répondu":h.statut==="relance"?"Relance":"Envoyé"}
                        </span>
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"repondu"}:x))} style={{fontSize:10,background:C.green+"15",color:C.green,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Répondu</button>}
                        {h.statut==="envoye"&&<button onClick={()=>setCourrierHisto(hs=>hs.map(x=>x.id===h.id?{...x,statut:"relance"}:x))} style={{fontSize:10,background:C.amber+"15",color:C.amber,border:"none",borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Relancer</button>}
                        {h.statut!=="envoye"&&<button onClick={()=>{setCourrier({prospect:{id:h.prospect_id,adresse:h.prospect_adresse,ville:h.prospect_ville,score:0,source:"DVF",status:"",notes:""},template:h.template==="relance"?"relance":"relance",content:"",loading:false});setNav("courriers");}} style={{fontSize:10,background:C.surface,border:`1px solid ${C.border}`,color:C.muted,borderRadius:4,padding:"2px 7px",cursor:"pointer"}}>Courrier →</button>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

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
            <div style={{width:340,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",background:C.surface,flexShrink:0}}>
              {/* Search header */}
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                <div style={{fontFamily:DISPLAY,fontSize:17,fontWeight:500,color:C.text,marginBottom:12}}>Prospecter une ville</div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <input value={prospSecteur} onChange={e=>setProspSecteur(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&!dvfLoading) handleProspect(prospSecteur);}}
                    placeholder="Ex : 33000 ou Bordeaux..." style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,fontFamily:BODY}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button disabled={dvfLoading||!prospSecteur} onClick={()=>handleProspect(prospSecteur)}
                    style={{background:dvfLoading?C.border:C.accent,color:dvfLoading?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:dvfLoading?"not-allowed":"pointer",flexShrink:0,transition:"all 0.15s"}}>
                    {dvfLoading?"...":"Analyser"}
                  </button>
                </div>
                {dvfError&&<div style={{fontSize:12,color:C.red,marginBottom:6}}>{dvfError}</div>}
                {/* Per-source status */}
                {(dvfLoading||dvfStats)&&(
                  <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                    {[
                      {id:"dvf",label:"DVF",count:dvfStats?.dvf,desc:"transactions"},
                      {id:"dpe",label:"DPE F/G",count:dvfStats?.dpe,desc:"signaux vente"},
                      {id:"enrichir",label:"Sirene",count:null,desc:"propriétaires"},
                    ].map(s=>{
                      const st = srcStatus[s.id as keyof typeof srcStatus];
                      const col = st==="ok"?C.green:st==="loading"?C.amber:st==="err"?C.red:C.border;
                      return(
                        <div key={s.id} style={{fontSize:11,color:C.muted,background:C.card,border:`1px solid ${col}40`,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:4}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:col,flexShrink:0,animation:st==="loading"?"pulse 1.2s infinite":"none"}}/>
                          {st==="ok"&&s.count!=null?<><span style={{fontWeight:600,color:C.text}}>{s.count}</span>{" "}</>:null}
                          <span>{s.label}</span>
                        </div>
                      );
                    })}
                    {dvfStats&&<div style={{fontSize:11,color:C.muted,background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 8px"}}><span style={{fontWeight:600,color:C.text}}>{prospects.length}</span> total</div>}
                  </div>
                )}
                {/* Filters */}
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {[{id:"",l:"Tous"},{id:"DVF",l:"DVF"},{id:"DPE",l:"DPE F/G"}].map(f=>(
                    <button key={f.id} onClick={()=>setProspMethod(f.id)} style={{padding:"3px 9px",background:prospMethod===f.id?C.accent:C.card,color:prospMethod===f.id?(dark?"#080808":"#FAFAFA"):C.muted,border:`1px solid ${prospMethod===f.id?C.accent:C.border}`,borderRadius:20,fontSize:11,fontWeight:prospMethod===f.id?600:400,cursor:"pointer"}}>{f.l}</button>
                  ))}
                </div>
              </div>

              {/* Batch action bar */}
              {selProspects.size>0&&(
                <div style={{padding:"10px 16px",borderBottom:`1px solid ${C.border}`,background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                  <span style={{fontSize:12,color:C.text,fontWeight:500}}>{selProspects.size} sélectionné{selProspects.size>1?"s":""}</span>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>{
                      const ps = prospects.filter(p=>selProspects.has(p.id));
                      if(ps.length>0){setCourrier({prospect:ps[0],template:"prospection",content:"",loading:false});setNav("courriers");}
                    }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer",fontWeight:500}}>Courrier digital</button>
                    <button disabled={mfSending} onClick={async()=>{
                      if(mfSending) return;
                      const ps = prospects.filter(p=>selProspects.has(p.id) && p.adresse && p.ville);
                      if(!ps.length) return;
                      setMfSending(true); setMfResult(null);
                      let ok=0, err=0;
                      for(const p of ps){
                        const adresseParts = p.adresse.match(/^(.*?)\s+(\d{5})\s+(.*)$/)||[];
                        const cp = p.ville?.match(/\d{5}/)?.[0] || adresseParts[2] || "";
                        const ville = p.ville?.replace(/\d{5}\s*/,"").trim() || adresseParts[3] || p.ville;
                        const content = `Madame, Monsieur,\n\nNous représentons ${agent.agence} et sommes spécialisés dans les transactions immobilières de votre secteur.\n\nVotre bien situé au ${p.adresse}, ${p.ville} nous intéresse particulièrement. Nous disposons actuellement d'acheteurs qualifiés à la recherche d'un bien correspondant à votre propriété.\n\nNous serions heureux de vous proposer une estimation gratuite et sans engagement.\n\nCordialement,\n${agent.prenom} ${agent.nom}\n${agent.agence}`;
                        const r = await fetch("/api/merci-facteur",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                          dest_nom: p.proprietaire_nom || "Madame, Monsieur",
                          dest_adresse: p.adresse,
                          dest_cp: cp || "33000",
                          dest_ville: ville,
                          exp_nom: `${agent.prenom} ${agent.nom}`,
                          exp_adresse: agent.email,
                          content,
                        })});
                        (await r.json()).ok ? ok++ : err++;
                      }
                      setMfSending(false);
                      setMfResult({ok,err});
                      if(ok>0){
                        const now = new Date().toISOString().slice(0,10);
                        const newHisto = prospects.filter(p=>selProspects.has(p.id)).map(p=>({
                          id:Date.now()+Math.random(), prospect_id:p.id,
                          prospect_adresse:p.adresse, prospect_ville:p.ville,
                          date:now, template:"prospection", statut:"envoye" as const,
                          content:"Courrier papier via Merci Facteur",
                        }));
                        setCourrierHisto(h=>[...newHisto,...h]);
                        setSelProspects(new Set());
                      }
                    }} style={{background:C.gold,color:"#000",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:mfSending?"not-allowed":"pointer"}}>
                      {mfSending?"Envoi...":"Merci Facteur →"}
                    </button>
                  </div>
                </div>
              )}
              {mfResult&&(
                <div style={{padding:"8px 16px",background:mfResult.err>0?C.red+"15":C.green+"15",borderBottom:`1px solid ${C.border}`,fontSize:11,color:mfResult.err>0?C.red:C.green,flexShrink:0}}>
                  {mfResult.ok>0&&`${mfResult.ok} courrier(s) envoyé(s). `}
                  {mfResult.err>0&&`${mfResult.err} erreur(s) — configurez MERCI_FACTEUR_TOKEN dans Vercel.`}
                </div>
              )}

              {/* Prospects list */}
              <div style={{flex:1,overflowY:"auto"}}>
                {prospects.filter(p=>!prospMethod||p.source===prospMethod).length===0?(
                  <div style={{padding:24,textAlign:"center",color:C.muted}}>
                    <div style={{fontFamily:DISPLAY,fontSize:20,fontWeight:400,fontStyle:"italic",marginBottom:8,color:C.text}}>Aucun prospect</div>
                    <div style={{fontSize:12}}>Entrez un code postal ou une commune et cliquez Analyser</div>
                    <div style={{fontSize:11,marginTop:8,color:C.muted}}>Sources : DVF Etalab (transactions) + DPE ADEME (diagnostics F/G)</div>
                  </div>
                ):(
                  prospects.filter(p=>!prospMethod||p.source===prospMethod).map(p=>{
                    const col = p.score>=85?C.green:p.score>=70?C.amber:C.red;
                    const isSel = selProspects.has(p.id);
                    return(
                      <div key={p.id} id={"prospect-"+p.id} onClick={()=>setSelProspect(selProspect?.id===p.id?null:p)} style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:selProspect?.id===p.id?C.accentBg:isSel?C.accentBg+"80":"transparent",transition:"background 0.15s"}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:3}}>
                          {/* Checkbox */}
                          <div onClick={e=>{e.stopPropagation();setSelProspects(s=>{const n=new Set(s);isSel?n.delete(p.id):n.add(p.id);return n;})}} style={{width:16,height:16,borderRadius:4,border:`1.5px solid ${isSel?C.gold:C.border}`,background:isSel?C.gold:"transparent",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.15s"}}>
                            {isSel&&<div style={{width:8,height:8,borderRadius:2,background:"#fff"}}/>}
                          </div>
                          {/* Score badge */}
                          <div style={{width:30,height:30,borderRadius:6,background:col+"18",border:`1px solid ${col}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:col,flexShrink:0}}>{p.score}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>
                            <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
                              <span style={{fontSize:10,color:C.muted}}>{p.ville}</span>
                              <span style={{fontSize:10,background:p.source==="DPE"?C.amber+"20":C.blue+"15",color:p.source==="DPE"?C.amber:C.blue,border:`1px solid ${p.source==="DPE"?C.amber+"40":C.blue+"30"}`,borderRadius:4,padding:"0px 5px",fontWeight:600}}>{p.source}{(p as any).classe_dpe?" "+((p as any).classe_dpe):""}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{fontSize:11,color:C.muted,marginLeft:54,marginBottom:4}}>{p.notes}</div>
                        {/* Score bar */}
                        <div style={{marginLeft:54,height:3,background:C.border,borderRadius:2,marginBottom:4}}>
                          <div style={{width:`${p.score}%`,height:"100%",background:col,borderRadius:2,transition:"width 0.5s"}}/>
                        </div>
                        {/* Proprietaire */}
                        <div style={{marginLeft:54,display:"flex",alignItems:"center",gap:6}}>
                          {p.proprietaire_chargement?(
                            <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>Identification propriétaire...</span>
                          ):p.proprietaire_nom?(
                            <>
                              <span style={{fontSize:11,fontWeight:600,color:C.text}}>{p.proprietaire_nom}</span>
                              <span style={{fontSize:10,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,padding:"0px 5px"}}>
                                {p.proprietaire_source==="sci+dirigeant"?"SCI":p.proprietaire_source==="sirene+dirigeant"?"Sirene":p.proprietaire_source==="cadastre"?"Cadastre":"Source"}
                              </span>
                            </>
                          ):p.proprietaire_source&&p.proprietaire_source!=="inconnu"?(
                            <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>Particulier</span>
                          ):null}
                        </div>
                        {/* Expanded actions */}
                        {selProspect?.id===p.id&&(
                          <>
                            {propData[String(p.id)]&&(
                              <div style={{marginTop:8,marginLeft:54,padding:"8px 10px",background:C.card,borderRadius:7,border:`1px solid ${C.border}`}}>
                                {propData[String(p.id)].parcelles?.length>0&&(
                                  <div style={{marginBottom:4}}>
                                    <span style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Cadastre — </span>
                                    <span style={{fontSize:11,color:C.text}}>Section {propData[String(p.id)].parcelles[0].section} n°{propData[String(p.id)].parcelles[0].numero} · {propData[String(p.id)].parcelles[0].contenance}m²</span>
                                    {propData[String(p.id)].deepLink&&<a href={propData[String(p.id)].deepLink} target="_blank" rel="noopener" style={{fontSize:10,color:C.blue,marginLeft:6}}>carte →</a>}
                                  </div>
                                )}
                                {propData[String(p.id)].entreprises?.length>0&&(
                                  <div>
                                    <span style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Sirene — </span>
                                    <span style={{fontSize:11,color:C.text}}>{propData[String(p.id)].entreprises[0].nom}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            <div style={{marginTop:8,marginLeft:54,display:"flex",gap:5,flexWrap:"wrap"}}>
                              <button onClick={e=>{e.stopPropagation();setCourrier({prospect:p,template:"prospection",content:"",loading:false});setNav("courriers");}} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Courrier</button>
                              <button onClick={e=>{e.stopPropagation();setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Analyse le prospect au ${p.adresse} (score ${p.score}/100, ${p.notes}). Recommande une stratégie.`}]);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>Lucas</button>
                              {(p as any).lat&&(p as any).lng&&(
                                <button onClick={e=>{e.stopPropagation();setSvModal({lat:(p as any).lat,lng:(p as any).lng,adresse:p.adresse});}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>Street View</button>
                              )}
                              {(p as any).lat&&(p as any).lng&&!propData[String(p.id)]&&(
                                <button onClick={async e=>{
                                  e.stopPropagation();
                                  const key=String(p.id); setPropLoading(key);
                                  try{
                                    const r=await fetch(`/api/proprietaire?lat=${(p as any).lat}&lng=${(p as any).lng}&adresse=${encodeURIComponent(p.adresse+" "+p.ville)}`);
                                    const d=await r.json();
                                    setPropData(x=>({...x,[key]:d}));
                                  }catch{}
                                  setPropLoading(null);
                                }} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:C.text,cursor:"pointer"}}>
                                  {propLoading===String(p.id)?"...":"Cadastre"}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Select all bar */}
              {prospects.length>0&&(
                <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:C.card}}>
                  <button onClick={()=>{
                    const filtered = prospects.filter(p=>!prospMethod||p.source===prospMethod);
                    if(selProspects.size===filtered.length) setSelProspects(new Set());
                    else setSelProspects(new Set(filtered.map(p=>p.id)));
                  }} style={{fontSize:11,color:C.muted,background:"transparent",border:"none",cursor:"pointer",padding:0}}>
                    {selProspects.size>0?"Tout désélectionner":"Tout sélectionner"}
                  </button>
                  <span style={{fontSize:11,color:C.muted}}>{selProspects.size}/{prospects.filter(p=>!prospMethod||p.source===prospMethod).length}</span>
                </div>
              )}
            </div>

            {/* MAP */}
            <div style={{flex:1,position:"relative"}}>
              <Suspense fallback={<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:13}}>Chargement de la carte...</div>}>
                <MapComponent
                  prospects={prospects.filter(p=>!prospMethod||p.source===prospMethod).filter((p:any)=>p.lat&&p.lng) as any}
                  onSelect={(p:any)=>{
                    setSelProspect(p as any);
                    const el = document.getElementById("prospect-"+p.id);
                    if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
                  }}
                  center={mapCenter}
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
                              {selProspect.proprietaire_source==="sci+dirigeant"?"SCI":selProspect.proprietaire_source==="sirene+dirigeant"?"Sirene":"Sirene"}
                            </span>
                          </>
                        ):(
                          <span style={{fontSize:11,color:C.muted}}>Propriétaire non identifié</span>
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
                          <button onClick={()=>{setEstForm({type:selM.type,surface:String(selM.surface),ville:selM.ville,etat:"bon"});setEstResult(null);setNav("estimation");}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 12px",fontSize:12,color:C.text,cursor:"pointer",fontWeight:500}}>Estimer</button>
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
            <div style={{width:320,borderRight:`1px solid ${C.border}`,background:C.surface,display:"flex",flexDirection:"column",flexShrink:0}}>
              <div style={{padding:"20px 20px 16px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em",marginBottom:4}}>Estimation</div>
                <div style={{fontSize:12,color:C.muted}}>Avis de valeur basé sur les ventes DVF</div>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:20,display:"flex",flexDirection:"column",gap:14}}>
                {[{l:"Type de bien",k:"type",type:"select",opts:["Maison","Appartement"]},{l:"Surface habitable (m²)",k:"surface",type:"number",placeholder:"Ex: 120"},{l:"Ville ou code postal",k:"ville",type:"text",placeholder:"Ex: Bordeaux"},{l:"État général",k:"etat",type:"select",opts:["neuf","bon","moyen","travaux"]}].map(f=>(
                  <div key={f.k}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{f.l}</div>
                    {f.type==="select"?(
                      <select value={(estForm as any)[f.k]} onChange={e=>setEstForm(x=>({...x,[f.k]:e.target.value}))} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,cursor:"pointer"}}>
                        {f.opts!.map(o=><option key={o} value={o} style={{background:C.card}}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}
                      </select>
                    ):(
                      <input type={f.type} value={(estForm as any)[f.k]} onChange={e=>setEstForm(x=>({...x,[f.k]:e.target.value}))} placeholder={(f as any).placeholder} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                    )}
                  </div>
                ))}
                {estError&&<div style={{fontSize:12,color:C.red,padding:"8px 12px",background:C.red+"10",borderRadius:8}}>{estError}</div>}
                <button disabled={estLoading||!estForm.surface||!estForm.ville} onClick={async()=>{
                  setEstLoading(true); setEstError(""); setEstResult(null);
                  try {
                    const r = await lancerEstimation(estForm.type, parseFloat(estForm.surface), estForm.ville, estForm.etat);
                    setEstResult(r);
                  } catch(e:any){setEstError(e.message);}
                  setEstLoading(false);
                }} style={{marginTop:8,background:estLoading||!estForm.surface||!estForm.ville?C.border:C.accent,color:estLoading||!estForm.surface||!estForm.ville?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:estLoading||!estForm.surface||!estForm.ville?"default":"pointer",transition:"all 0.15s"}}>
                  {estLoading?"Analyse en cours...":"Estimer le bien"}
                </button>
              </div>
            </div>
            {/* RIGHT: result */}
            <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
              {!estResult&&!estLoading&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.muted,textAlign:"center"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Remplissez le formulaire</div>
                    <div style={{fontSize:12}}>{"L'estimation s'appuie sur les ventes réelles DVF dans un rayon de 5 km"}</div>
                  </div>
                </div>
              )}
              {estResult&&(
                <>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28}}>
                    <div>
                      <div style={{fontSize:12,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:500}}>Avis de valeur — {estResult.ville}</div>
                      <div style={{fontFamily:DISPLAY,fontSize:48,fontWeight:500,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>{fmt(estResult.estimation)} €</div>
                      <div style={{fontSize:14,color:C.muted,marginTop:6}}>Fourchette {fmt(estResult.fourchette_bas)} — {fmt(estResult.fourchette_haut)} €</div>
                    </div>
                    <button onClick={()=>{
                      const w = window.open("","_blank");
                      if(!w) return;
                      w.document.write(`<!DOCTYPE html><html><head><title>Avis de Valeur — ${estResult.ville}</title><style>body{font-family:-apple-system,sans-serif;max-width:700px;margin:40px auto;color:#111;line-height:1.5}h1{font-size:28px;font-weight:700;margin-bottom:4px}h2{font-size:16px;font-weight:600;margin:24px 0 10px}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px}.card{border:1px solid #eee;border-radius:8px;padding:14px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px}.val{font-size:18px;font-weight:700}.fourchette{background:#f5f5f5;border-radius:8px;padding:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}table{width:100%;border-collapse:collapse}td,th{padding:8px 12px;border-bottom:1px solid #eee;font-size:12px}th{text-align:left;font-weight:600;color:#888;text-transform:uppercase;font-size:10px;letter-spacing:.06em}.footer{margin-top:40px;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:12px}@media print{button{display:none}}</style></head><body>
                      <h1>Avis de Valeur</h1><p style="color:#888">${estForm.type} · ${estForm.surface} m² · État ${estForm.etat} · ${estResult.ville}</p>
                      <div class="fourchette"><div><div class="label">Estimation centrale</div><div style="font-size:32px;font-weight:700">${fmt(estResult.estimation)} €</div></div><div style="text-align:right"><div class="label">Fourchette</div><div style="font-size:20px;font-weight:600">${fmt(estResult.fourchette_bas)} — ${fmt(estResult.fourchette_haut)} €</div></div></div>
                      <div class="grid"><div class="card"><div class="label">Prix/m² médian</div><div class="val">${fmt(estResult.prix_m2_median)} €/m²</div></div><div class="card"><div class="label">Comparables analysés</div><div class="val">${estResult.nb_comparables}</div></div><div class="card"><div class="label">Surface évaluée</div><div class="val">${estForm.surface} m²</div></div></div>
                      <h2>Ventes comparables (DVF)</h2><table><tr><th>Adresse</th><th>Surface</th><th>Prix</th><th>€/m²</th><th>Date</th></tr>${estResult.comparables.map((c:any)=>`<tr><td>${c.adresse}</td><td>${c.surface}m²</td><td>${fmt(c.prix)}€</td><td>${fmt(c.prix_m2)}€</td><td>${c.date}</td></tr>`).join("")}</table>
                      <div class="footer">Avis de valeur généré le ${new Date().toLocaleDateString("fr-FR")} · Source : DVF Etalab (données officielles) · ${agent.prenom} ${agent.nom} — ${agent.agence}</div>
                      <script>window.print();</script></body></html>`);
                      w.document.close();
                    }} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:500,cursor:"pointer",flexShrink:0}}>
                      Imprimer PDF
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:28}}>
                    {[{l:"Prix/m² médian",v:fmt(estResult.prix_m2_median)+" €/m²"},{l:"Fourchette marché",v:`${fmt(estResult.prix_m2_min)} — ${fmt(estResult.prix_m2_max)} €/m²`},{l:"Comparables DVF",v:`${estResult.nb_comparables} ventes`}].map(i=>(
                      <div key={i.l} style={{...card(),padding:"16px 20px"}}>
                        <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{i.l}</div>
                        <div style={{fontSize:15,fontWeight:700,color:C.text}}>{i.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{...card(),padding:"24px"}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16}}>Ventes comparables DVF</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 60px 90px 80px 80px",gap:8,marginBottom:8}}>
                      {["Adresse","Surface","Prix","€/m²","Date"].map(h=><div key={h} style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>)}
                    </div>
                    {estResult.comparables.map((c:any,i:number)=>(
                      <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 60px 90px 80px 80px",gap:8,padding:"10px 0",borderTop:`1px solid ${C.border}`}}>
                        <div style={{fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.adresse}</div>
                        <div style={{fontSize:12,color:C.muted}}>{c.surface}m²</div>
                        <div style={{fontSize:12,color:C.text,fontWeight:500}}>{fmt(c.prix)}€</div>
                        <div style={{fontSize:12,color:C.text}}>{fmt(c.prix_m2)}</div>
                        <div style={{fontSize:12,color:C.muted}}>{c.date}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
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
              <div style={{padding:"20px",borderBottom:`1px solid ${C.border}`}}>
                <div style={{fontFamily:DISPLAY,fontSize:18,fontWeight:500,color:C.text,letterSpacing:"0.01em",marginBottom:4}}>Courriers</div>
                <div style={{fontSize:12,color:C.muted}}>Prospection postale personnalisée</div>
              </div>
              <div style={{flex:1,overflowY:"auto"}}>
                {prospects.length===0?(
                  <div style={{padding:20,textAlign:"center",color:C.muted,fontSize:12}}>Lancez une prospection DVF pour voir les prospects</div>
                ):(
                  prospects.map(p=>{
                    const col=p.score>=85?C.green:p.score>=70?C.amber:C.red;
                    const sel=courrier?.prospect?.id===p.id;
                    return(
                      <div key={p.id} onClick={()=>setCourrier({prospect:p,template:"prospection",content:"",loading:false})} style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentBg:"transparent",transition:"background 0.15s"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:26,height:26,borderRadius:6,background:col+"15",border:`1px solid ${col}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:col,flexShrink:0}}>{p.score}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>
                            <div style={{fontSize:11,color:C.muted}}>{p.proprietaire_nom||p.ville}</div>
                          </div>
                          {courrierHisto.some(h=>h.prospect_id===p.id)&&(
                            <div style={{width:7,height:7,borderRadius:"50%",background:courrierHisto.find(h=>h.prospect_id===p.id)?.statut==="repondu"?C.green:C.amber,flexShrink:0}}/>
                          )}
                        </div>
                      </div>
                    );
                  })
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
            {/* Header + search */}
            <div style={{padding:"20px 28px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.surface}}>
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
                <div>
                  <h1 style={{fontSize:22,fontWeight:600,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>Veille concurrence</h1>
                  <div style={{fontSize:13,color:C.muted}}>Annonces en vente sur votre secteur · Source : Bien'ici</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={annonceVille} onChange={e=>setAnnonceVille(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter") handleAnnonces(annonceVille);}}
                    placeholder="Ex : Bordeaux, Mérignac..." style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,width:220}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button disabled={annoncesLoading||!annonceVille.trim()} onClick={()=>handleAnnonces(annonceVille)}
                    style={{background:annoncesLoading?C.border:C.accent,color:annoncesLoading?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:annoncesLoading?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                    {annoncesLoading?"...":"Analyser"}
                  </button>
                </div>
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
            </div>

            {/* Content */}
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
                  <div style={{width:"100%",maxWidth:560}}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Autres portails</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      {[
                        {name:"SeLoger",url:"https://www.seloger.com/list.htm?types=2,4&projects=2&enterprise=0&natures=1,2,4&places=%5B{inseeCodes:['VILLE']}%5D"},
                        {name:"Bien'ici",url:"https://www.bienici.com/recherche/achat/france"},
                        {name:"Barnes",url:"https://www.barnesparis.com/fr/nos-biens/vente/residentiels"},
                        {name:"Belle Demeure",url:"https://www.belledemeure.com/annonces/vente/maison/"},
                        {name:"Sotheby's",url:"https://www.sothebysrealty.com/fre/rechercher/FRA/vente"},
                        {name:"PAP",url:"https://www.pap.fr/annonce/ventes-maisons-appartements"},
                      ].map(p=>(
                        <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"10px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:C.text,textDecoration:"none",fontWeight:500,transition:"all 0.15s"}}>
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
                <>
                  {/* Grid */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16,marginBottom:24}}>
                    {filtered.map(a=>{
                      const prixM2 = a.prix && a.surface && a.surface > 0 ? Math.round(a.prix / a.surface) : null;
                      return (
                      <div key={a.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",transition:"box-shadow 0.15s"}} onMouseOver={e=>e.currentTarget.style.boxShadow=`0 4px 20px ${C.shadow}`} onMouseOut={e=>e.currentTarget.style.boxShadow="none"}>
                        {/* Photo or placeholder */}
                        {a.photos?.[0]?(
                          <div style={{height:160,background:`url(${a.photos[0]}) center/cover no-repeat`,flexShrink:0,position:"relative"}}>
                            {a.isNew&&<div style={{position:"absolute",top:8,left:8,background:C.amber,color:"#000",fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 6px",letterSpacing:"0.06em"}}>NEUF</div>}
                          </div>
                        ):(
                          <div style={{height:160,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                            {a.isNew&&<div style={{position:"absolute",top:8,left:8,background:C.amber,color:"#000",fontSize:9,fontWeight:700,borderRadius:4,padding:"2px 6px",letterSpacing:"0.06em"}}>NEUF</div>}
                            <span style={{fontSize:11,color:C.muted}}>Pas de photo</span>
                          </div>
                        )}
                        <div style={{padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:6}}>
                            <div>
                              <div style={{fontSize:15,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>
                                {a.prix ? `${a.prix.toLocaleString("fr-FR")} €` : "Prix non communiqué"}
                              </div>
                              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                                {a.surface ? `${a.surface} m²` : "?"}{a.pieces ? ` · ${a.pieces} p.` : ""}{prixM2 ? <span style={{color:C.amber,fontWeight:600}}> · {prixM2.toLocaleString("fr-FR")} €/m²</span> : ""}
                              </div>
                            </div>
                            <span style={{fontSize:10,background:a.type==="Maison"?C.green+"18":C.blue+"15",color:a.type==="Maison"?C.green:C.blue,border:`1px solid ${a.type==="Maison"?C.green+"35":C.blue+"30"}`,borderRadius:5,padding:"2px 7px",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>
                              {a.type}
                            </span>
                          </div>
                          <div style={{fontSize:12,color:C.muted,marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {a.ville}{a.cp ? ` ${a.cp}` : ""}
                          </div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <div style={{fontSize:11,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                              {a.agence || "Particulier"}
                            </div>
                            {a.url&&(
                              <a href={a.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.accent,fontWeight:600,textDecoration:"none",flexShrink:0,marginLeft:8}}>
                                Voir →
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  {/* Portal links bar */}
                  <div style={{borderTop:`1px solid ${C.border}`,paddingTop:20}}>
                    <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Portails concurrents à surveiller</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {[
                        {name:"Barnes",url:`https://www.barnesparis.com/fr/nos-biens/vente/residentiels?query=${encodeURIComponent(annonceVille)}`},
                        {name:"Belle Demeure",url:`https://www.belledemeure.com/annonces/vente/?localisation=${encodeURIComponent(annonceVille)}`},
                        {name:"Sotheby's",url:`https://www.sothebysrealty.com/fre/rechercher/FRA/vente?q=${encodeURIComponent(annonceVille)}`},
                        {name:"SeLoger",url:`https://www.seloger.com/list.htm?types=2,4&projects=2&enterprise=0&natures=1,2,4&localisation=${encodeURIComponent(annonceVille)}`},
                        {name:"PAP",url:`https://www.pap.fr/annonce/ventes-maisons-appartements-${annonceVille.toLowerCase().replace(/\s+/g,"-")}`},
                      ].map(p=>(
                        <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",textDecoration:"none",fontWeight:500}}>
                          {p.name} →
                        </a>
                      ))}
                    </div>
                  </div>
                </>
                );
              })()}
            </div>
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

        {/* AUTH MODAL */}
        {authModal&&(
          <div onClick={()=>{setAuthModal(false);setAuthMsg("");setAuthEmail("");}} style={{position:"absolute",inset:0,zIndex:200,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div onClick={e=>e.stopPropagation()} style={{width:400,background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:28,boxShadow:`0 24px 64px ${C.shadow}`,animation:"fadeUp 0.2s ease"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:C.text,letterSpacing:"-0.01em"}}>Connexion</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>Synchronisez vos données sur tous vos appareils</div>
                </div>
                <button onClick={()=>setAuthModal(false)} style={{background:"none",border:"none",color:C.muted,fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
              </div>
              <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Email</div>
              <input type="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="votre@email.fr" onKeyDown={e=>e.key==="Enter"&&!authLoading&&document.getElementById("auth-btn")?.click()} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 12px",fontSize:13,marginBottom:12}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
              {authMsg&&<div style={{fontSize:12,color:authMsg.includes("erreur")||authMsg.includes("Erreur")?C.red:C.green,background:(authMsg.includes("erreur")||authMsg.includes("Erreur")?C.red:C.green)+"10",borderRadius:8,padding:"8px 12px",marginBottom:12}}>{authMsg}</div>}
              <button id="auth-btn" disabled={authLoading||!authEmail.includes("@")} onClick={async()=>{
                const sb=getSupabase();
                if(!sb){setAuthMsg("Supabase non configuré — ajoutez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans Vercel.");return;}
                setAuthLoading(true);setAuthMsg("");
                const {error}=await sb.auth.signInWithOtp({email:authEmail,options:{emailRedirectTo:window.location.href}});
                setAuthLoading(false);
                setAuthMsg(error?`Erreur : ${error.message}`:"Lien de connexion envoyé — vérifiez votre email.");
              }} style={{width:"100%",background:authLoading||!authEmail.includes("@")?C.border:C.accent,color:authLoading||!authEmail.includes("@")?C.muted:(dark?"#080808":"#FAFAFA"),border:"none",borderRadius:8,padding:"11px",fontSize:13,fontWeight:600,cursor:authLoading||!authEmail.includes("@")?"default":"pointer",marginBottom:16}}>
                {authLoading?"Envoi...":"Recevoir un lien magique"}
              </button>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Configuration requise dans Vercel :</div>
                {[["NEXT_PUBLIC_SUPABASE_URL","URL de votre projet Supabase"],["NEXT_PUBLIC_SUPABASE_ANON_KEY","Clé anon publique Supabase"]].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                    <code style={{fontSize:10,color:C.text,fontFamily:"monospace"}}>{k}</code>
                    <span style={{fontSize:10,color:C.muted}}>{v}</span>
                  </div>
                ))}
              </div>
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
              {[["Tableau de bord","dashboard"],["Prospection","prospects"],["Mandats","mandats"],["Comptabilité","compta"],["Estimation","estimation"],["Courriers","courriers"],["Agenda","agenda"]].map(([l,id])=>(
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
