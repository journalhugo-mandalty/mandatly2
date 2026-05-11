"use client";
import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";

const MapComponent = lazy(() => import("./map-component"));

// ── Geocoding BAN ──────────────────────────────────────────────
async function geocodeVille(q: string) {
  const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&limit=1`);
  const d = await r.json();
  if (!d.features?.length) return null;
  const [lng, lat] = d.features[0].geometry.coordinates;
  return { lat, lng, label: d.features[0].properties.label as string };
}

// ── DVF Scoring ────────────────────────────────────────────────
function scoreFromDVF(t: any) {
  const annee = new Date(t.date_mutation).getFullYear();
  const age = new Date().getFullYear() - annee;
  const sAge = age>=10&&age<=15?40:age>=7&&age<10?35:age>=15&&age<=20?30:age>=5&&age<7?20:age>20?25:5;
  const sPV = t.valeur_fonciere>300000?25:t.valeur_fonciere>150000?18:10;
  const sType = t.type_local==="Maison"?15:12;
  const score = Math.min(100, sAge+sPV+sType);
  const adresse = `${t.adresse_numero||""} ${t.adresse_nom_voie||""}`.trim();
  return {
    id: Math.random(),
    adresse: adresse||t.adresse_nom_voie||"Adresse inconnue",
    ville: t.nom_commune,
    score,
    source: "DVF",
    status: score>=65?"À contacter":"À surveiller",
    notes: `Acheté en ${annee} · ${t.surface_reelle_bati||"?"}m² · ${Math.round(t.valeur_fonciere/1000)}k€`,
    lat: t.latitude,
    lng: t.longitude,
    details: { anciennete_ans: age, prix_achat: t.valeur_fonciere }
  };
}

async function fetchDVF(lat: number, lng: number) {
  const url = `https://api-dvf.etalab.studio/api/geopoints?lat=${lat}&lon=${lng}&dist=3000&nombre_resultats=80`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("API DVF indisponible");
  const d = await r.json();
  return (d.results||d||[])
    .filter((t:any)=>(t.type_local==="Maison"||t.type_local==="Appartement")&&t.valeur_fonciere>0&&t.latitude&&t.longitude)
    .map(scoreFromDVF)
    .sort((a:any,b:any)=>b.score-a.score);
}

type Mandat = { id:number; adresse:string; nom_propriete:string; ville:string; prix:number; surface:number; terrain:number; chambres:number; dpe:string; type:string; statut:string; pipeline:string; proprietaire:string; tel:string; email:string; honoraires:number; exclusif:boolean; fin_mandat:string; description:string; };
type Prospect = { id:number; nom:string; adresse:string; ville:string; score:number; source:string; status:string; notes:string; };
type Acheteur = { id:number; nom:string; email:string; tel:string; budget_min:number; budget_max:number; surface_min:number; chambres_min:number; types:string[]; villes:string[]; notes:string; };
type RDV = { id:number; titre:string; client:string; tel:string; date:string; heure:string; duree:number; type:string; bien:string; };
type Msg = { id:number; role:"user"|"agent"; text:string; };

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
  const [dark, setDark] = useState(true);
  const [nav, setNav] = useState("dashboard");
  const [mandats, setMandats] = useState<Mandat[]>(MANDATS);
  const [prospects, setProspects] = useState<Prospect[]>(PROSPECTS);
  const [dvfLoading, setDvfLoading] = useState(false);
  const [dvfError, setDvfError] = useState("");
  const [mapCenter, setMapCenter] = useState<[number,number]>([44.837, -0.579]);
  const [selProspect, setSelProspect] = useState<Prospect|null>(null);
  const [acheteurs] = useState<Acheteur[]>(ACHETEURS);
  const [rdvs] = useState<RDV[]>([
    {id:1,titre:"Visite Villa des Acacias",client:"Thomas Lefebvre",tel:"06 11 22 33 44",date:"2026-05-14",heure:"10:00",duree:60,type:"visite",bien:"14 rue des Acacias"},
    {id:2,titre:"Signature mandat",client:"Sophie Martin",tel:"06 55 44 33 22",date:"2026-05-15",heure:"14:00",duree:90,type:"signature",bien:"7 allée des Pins"},
  ]);
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
  const [agent, setAgent] = useState({prenom:"Jean",nom:"Dupont",agence:"Agence Prestige Immobilier",email:"jean@agence.fr"});
  const [onboarding, setOnboarding] = useState(() => typeof window!=="undefined"?!localStorage.getItem("m_setup"):true);
  const [obStep, setObStep] = useState(0);
  const [obData, setObData] = useState({prenom:"",nom:"",agence:"",email:""});
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[msgs]);
  useEffect(()=>{const s=localStorage.getItem("m_agent");if(s)setAgent(JSON.parse(s));},[]);

  const C = dark ? {
    bg:"#080808",surface:"#0F0F0F",card:"#141414",border:"#1C1C1C",border2:"#242424",
    text:"#FAFAFA",muted:"#525252",soft:"#737373",
    accent:"#FAFAFA",accentBg:"rgba(250,250,250,0.06)",
    green:"#10B981",red:"#EF4444",amber:"#F59E0B",blue:"#3B82F6",purple:"#8B5CF6",
    shadow:"rgba(0,0,0,0.6)"
  }:{
    bg:"#FFFFFF",surface:"#FAFAFA",card:"#FFFFFF",border:"#F0F0F0",border2:"#E5E5E5",
    text:"#0A0A0A",muted:"#A3A3A3",soft:"#737373",
    accent:"#0A0A0A",accentBg:"rgba(10,10,10,0.04)",
    green:"#059669",red:"#DC2626",amber:"#D97706",blue:"#2563EB",purple:"#7C3AED",
    shadow:"rgba(0,0,0,0.06)"
  };

  const card = (p:any={}) => ({background:C.card,border:`1px solid ${C.border}`,borderRadius:12,...p});

  const sendMsg = useCallback(async()=>{
    if(!input.trim()) return;
    const txt = input.trim();
    setInput("");
    const newMsgs = [...msgs,{id:Date.now(),role:"user" as const,text:txt}];
    setMsgs(newMsgs);
    setTyping(true);
    try {
      const res = await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        system:`Tu es ${agent.prenom}, secrétaire IA de ${agent.prenom} ${agent.nom} chez ${agent.agence}. Mandats: ${mandats.map(m=>`${m.nom_propriete} ${m.adresse} ${fmt(m.prix)}€ ${m.surface}m² prop:${m.proprietaire}`).join(" | ")}. Prospects: ${prospects.map(p=>`${p.nom} ${p.adresse} score:${p.score}`).join(" | ")}. Réponds en français, concis, professionnel, 1-3 phrases max.`,
        messages:newMsgs.slice(-8).map(m=>({role:m.role==="agent"?"assistant":"user",content:m.text})),
        max_tokens:400
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
    <div style={{minHeight:"100vh",background:"#080808",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{width:"100%",maxWidth:440,animation:"fadeUp 0.5s ease"}}>
        <div style={{display:"flex",gap:4,marginBottom:40,justifyContent:"center"}}>
          {["Bienvenue","Agent IA","Profil"].map((s,i)=>(
            <div key={s} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:i<obStep?20:i===obStep?20:20,height:4,borderRadius:2,background:i<=obStep?"#FAFAFA":"#1C1C1C",transition:"all 0.3s"}}/>
            </div>
          ))}
        </div>

        {obStep===0&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <h1 style={{fontSize:36,fontWeight:700,color:"#FAFAFA",marginBottom:12,letterSpacing:"-0.03em",lineHeight:1.15}}>Le CRM qui prospecte pour vous.</h1>
            <p style={{fontSize:15,color:"#737373",lineHeight:1.7,marginBottom:32}}>Mandatly est le premier CRM immobilier avec un agent IA intégré. Il prospecte, rédige vos courriers et gère votre agenda — pendant que vous faites des visites.</p>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:32}}>
              {[["Prospection DVF & DPE automatique","Identifiez les propriétaires prêts à vendre"],["Courriers personnalisés en 1 clic","Lucas rédige, vous validez, Merci Facteur envoie"],["Agent IA disponible 24h/24","Posez n'importe quelle question sur vos dossiers"]].map(([t,d])=>(
                <div key={t} style={{padding:"14px 16px",background:"#0F0F0F",border:"1px solid #1C1C1C",borderRadius:10}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#FAFAFA",marginBottom:2}}>{t}</div>
                  <div style={{fontSize:12,color:"#525252"}}>{d}</div>
                </div>
              ))}
            </div>
            <button onClick={()=>setObStep(1)} style={{width:"100%",background:"#FAFAFA",color:"#080808",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:600,cursor:"pointer",transition:"opacity 0.2s"}} onMouseOver={e=>(e.currentTarget.style.opacity="0.9")} onMouseOut={e=>(e.currentTarget.style.opacity="1")}>Commencer</button>
          </div>
        )}

        {obStep===1&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <h2 style={{fontSize:28,fontWeight:700,color:"#FAFAFA",marginBottom:8,letterSpacing:"-0.02em"}}>Votre agent IA</h2>
            <p style={{fontSize:14,color:"#737373",marginBottom:28}}>Choisissez le profil de votre secrétaire IA et personnalisez son prénom.</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
              {[{id:"lucas",name:"Lucas",role:"Professionnel"},{id:"sophie",name:"Sophie",role:"Élégante"},{id:"alex",name:"Alex",role:"Dynamique"},{id:"marie",name:"Marie",role:"Experte"}].map(a=>(
                <div key={a.id} onClick={()=>setObData(d=>({...d,agentId:a.id,prenom:d.prenom||a.name} as any))} style={{padding:"16px",background:(obData as any).agentId===a.id?"rgba(250,250,250,0.06)":"#0F0F0F",border:`1px solid ${(obData as any).agentId===a.id?"#FAFAFA":"#1C1C1C"}`,borderRadius:10,cursor:"pointer",transition:"all 0.2s"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:"#1C1C1C",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:14,height:14,borderRadius:"50%",background:(obData as any).agentId===a.id?"#FAFAFA":"#525252"}}/>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:"#FAFAFA"}}>{a.name}</div>
                  <div style={{fontSize:11,color:"#525252"}}>{a.role}</div>
                </div>
              ))}
            </div>
            <input value={obData.prenom} onChange={e=>setObData(d=>({...d,prenom:e.target.value}))} placeholder="Prénom de votre agent" style={{width:"100%",background:"#0F0F0F",border:"1px solid #1C1C1C",borderRadius:10,color:"#FAFAFA",padding:"12px 14px",fontSize:14,marginBottom:16}} onFocus={e=>e.target.style.borderColor="#FAFAFA"} onBlur={e=>e.target.style.borderColor="#1C1C1C"}/>
            <button onClick={()=>setObStep(2)} style={{width:"100%",background:"#FAFAFA",color:"#080808",border:"none",borderRadius:10,padding:"13px",fontSize:14,fontWeight:600,cursor:"pointer"}}>Continuer</button>
          </div>
        )}

        {obStep===2&&(
          <div style={{animation:"fadeUp 0.4s ease"}}>
            <h2 style={{fontSize:28,fontWeight:700,color:"#FAFAFA",marginBottom:8,letterSpacing:"-0.02em"}}>Votre profil</h2>
            <p style={{fontSize:14,color:"#737373",marginBottom:24}}>{obData.prenom||"Votre agent"} personnalisera chaque interaction avec vos clients.</p>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
              {[{l:"Prénom",k:"prenom",p:"Jean"},{l:"Nom",k:"nom",p:"Dupont"},{l:"Agence",k:"agence",p:"Agence Prestige Immobilier"},{l:"Email professionnel",k:"email",p:"jean@agence.fr"}].map(f=>(
                <div key={f.k}>
                  <div style={{fontSize:11,color:"#525252",marginBottom:5,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em"}}>{f.l}</div>
                  <input value={(obData as any)[f.k]||""} onChange={e=>setObData(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p} style={{width:"100%",background:"#0F0F0F",border:"1px solid #1C1C1C",borderRadius:10,color:"#FAFAFA",padding:"12px 14px",fontSize:14}} onFocus={e=>e.target.style.borderColor="#FAFAFA"} onBlur={e=>e.target.style.borderColor="#1C1C1C"}/>
                </div>
              ))}
            </div>
            <button onClick={()=>{
              const a={prenom:obData.prenom,nom:obData.nom,agence:obData.agence,email:obData.email};
              setAgent(a);
              localStorage.setItem("m_setup","1");
              localStorage.setItem("m_agent",JSON.stringify(a));
              setOnboarding(false);
            }} disabled={!obData.agence} style={{width:"100%",background:obData.agence?"#FAFAFA":"#1C1C1C",color:obData.agence?"#080808":"#525252",border:"none",borderRadius:10,padding:"13px",fontSize:14,fontWeight:600,cursor:obData.agence?"pointer":"default",transition:"all 0.2s"}}>
              Accéder à Mandatly
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // MAIN APP
  const NAVS = [{id:"dashboard",label:"Vue d'ensemble"},{id:"prospects",label:"Prospection"},{id:"mandats",label:"Mandats"},{id:"pipeline",label:"Pipeline"},{id:"acheteurs",label:"Acheteurs"},{id:"agenda",label:"Agenda"}];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:C.bg,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif",color:C.text,overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:${C.border2};border-radius:2px;}@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}input:focus,select:focus,textarea:focus{outline:none;}`}</style>

      {/* NAV */}
      <div style={{height:52,background:C.surface,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 20px",gap:4,flexShrink:0}}>
        <div style={{display:"flex",gap:1,flex:1}}>
          {NAVS.map(n=>(
            <button key={n.id} onClick={()=>setNav(n.id)} style={{padding:"6px 12px",background:nav===n.id?C.accentBg:"transparent",border:`1px solid ${nav===n.id?C.border2:"transparent"}`,borderRadius:8,color:nav===n.id?C.text:C.muted,fontSize:13,fontWeight:nav===n.id?500:400,transition:"all 0.15s",whiteSpace:"nowrap",cursor:"pointer"}}>
              {n.label}
            </button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>setChat(o=>!o)} style={{padding:"6px 14px",background:chat?C.accentBg:C.surface,border:`1px solid ${chat?C.border2:C.border}`,borderRadius:8,color:chat?C.text:C.muted,fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:6,transition:"all 0.15s"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite"}}/>
            {agent.prenom||"Agent IA"}
          </button>
          <button onClick={()=>setDark(d=>!d)} style={{width:32,height:32,borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,color:C.muted,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{dark?"○":"●"}</button>
          <div onClick={()=>setProfile(o=>!o)} style={{width:32,height:32,borderRadius:"50%",background:C.border2,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,fontWeight:600,color:C.text}}>
            {agent.prenom?.[0]||"A"}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>

        {/* DASHBOARD */}
        {nav==="dashboard"&&(
          <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.3s ease"}}>
            <div style={{marginBottom:32}}>
              <h1 style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em",marginBottom:6}}>Bonjour, {agent.prenom}</h1>
              <p style={{color:C.muted,fontSize:15}}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:32}}>
              {[{l:"Mandats",v:mandats.length,sub:"actifs"},{l:"CA estimé",v:fmt(mandats.reduce((a,m)=>a+Math.round(m.prix*m.honoraires/100),0))+" €",sub:"honoraires"},{l:"Prospects",v:prospects.length,sub:"identifiés"},{l:"Rendez-vous",v:rdvs.length,sub:"à venir"}].map(k=>(
                <div key={k.l} style={{...card(),padding:"20px 24px"}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{k.l}</div>
                  <div style={{fontSize:28,fontWeight:700,color:C.text,letterSpacing:"-0.02em",marginBottom:2}}>{k.v}</div>
                  <div style={{fontSize:12,color:C.muted}}>{k.sub}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <div style={{...card(),padding:"24px"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16,letterSpacing:"-0.01em"}}>Mandats récents</div>
                {mandats.map((m,i)=>(
                  <div key={m.id} onClick={()=>{setNav("mandats");setSelM(m);}} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<mandats.length-1?`1px solid ${C.border}`:"none",cursor:"pointer"}} onMouseOver={e=>e.currentTarget.style.opacity="0.7"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                      <div style={{fontSize:12,color:C.muted}}>{m.proprietaire}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(m.prix)} €</div>
                  </div>
                ))}
              </div>
              <div style={{...card(),padding:"24px"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:16}}>Prochains rendez-vous</div>
                {rdvs.map((r,i)=>(
                  <div key={r.id} style={{display:"flex",gap:14,padding:"10px 0",borderBottom:i<rdvs.length-1?`1px solid ${C.border}`:"none"}}>
                    <div style={{width:3,height:"100%",minHeight:40,borderRadius:2,background:r.type==="visite"?C.green:C.amber,flexShrink:0,alignSelf:"stretch"}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.text}}>{r.titre}</div>
                      <div style={{fontSize:12,color:C.muted}}>{r.client}</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{new Date(r.date).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})} · {r.heure}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PROSPECTION */}
        {nav==="prospects"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* LEFT PANEL */}
            <div style={{width:320,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",background:C.surface,flexShrink:0}}>
              <div style={{padding:"20px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
                <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>Prospection</div>
                <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Identifiez les propriétaires prêts à vendre</div>
                {/* Search */}
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  <input value={prospSecteur} onChange={e=>setProspSecteur(e.target.value)} onKeyDown={async e=>{
                    if(e.key!=="Enter"||!prospSecteur.trim()) return;
                    setDvfLoading(true); setDvfError("");
                    try {
                      const geo = await geocodeVille(prospSecteur);
                      if(!geo){setDvfError("Ville introuvable");setDvfLoading(false);return;}
                      setMapCenter([geo.lat,geo.lng]);
                      const results = await fetchDVF(geo.lat, geo.lng);
                      if(!results.length){setDvfError("Aucun résultat DVF");setDvfLoading(false);return;}
                      setProspects(prev=>{
                        const existing = new Set(prev.map(p=>p.adresse));
                        return [...prev,...results.filter(r=>!existing.has(r.adresse)).map(r=>({...r,id:Date.now()+Math.random()} as any))];
                      });
                    } catch(err:any){setDvfError(err.message||"Erreur API");}
                    setDvfLoading(false);
                  }} placeholder="Code postal ou commune..." style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13}} onFocus={e=>e.target.style.borderColor=C.text} onBlur={e=>e.target.style.borderColor=C.border}/>
                  <button disabled={dvfLoading||!prospSecteur} onClick={async()=>{
                    if(!prospSecteur.trim()) return;
                    setDvfLoading(true); setDvfError("");
                    try {
                      const geo = await geocodeVille(prospSecteur);
                      if(!geo){setDvfError("Ville introuvable");setDvfLoading(false);return;}
                      setMapCenter([geo.lat,geo.lng]);
                      const results = await fetchDVF(geo.lat, geo.lng);
                      setProspects(prev=>{
                        const existing = new Set(prev.map(p=>p.adresse));
                        return [...prev,...results.filter(r=>!existing.has(r.adresse)).map(r=>({...r} as any))];
                      });
                    } catch(err:any){setDvfError(err.message||"Erreur API");}
                    setDvfLoading(false);
                  }} style={{background:dvfLoading?C.border:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:500,cursor:dvfLoading?"not-allowed":"pointer",flexShrink:0}}>
                    {dvfLoading?"...":"→"}
                  </button>
                </div>
                {dvfError&&<div style={{fontSize:12,color:C.red,marginBottom:8}}>{dvfError}</div>}
                {/* Method filters */}
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[{id:"",l:"Tous"},{id:"DVF",l:"DVF"},{id:"DPE",l:"DPE"},{id:"StreetView",l:"Vision IA"}].map(f=>(
                    <button key={f.id} onClick={()=>setProspMethod(f.id)} style={{padding:"4px 10px",background:prospMethod===f.id?C.accent:C.card,color:prospMethod===f.id?(dark?"#080808":"#FAFAFA"):C.muted,border:`1px solid ${prospMethod===f.id?C.accent:C.border}`,borderRadius:20,fontSize:11,fontWeight:prospMethod===f.id?600:400,cursor:"pointer",transition:"all 0.15s"}}>{f.l}</button>
                  ))}
                </div>
              </div>
              {/* Prospects list */}
              <div style={{flex:1,overflowY:"auto"}}>
                {prospects.filter(p=>!prospMethod||p.source===prospMethod).length===0?(
                  <div style={{padding:20,textAlign:"center",color:C.muted}}>
                    <div style={{fontSize:13,marginBottom:4}}>Aucun prospect</div>
                    <div style={{fontSize:12}}>Tapez un code postal et appuyez sur Entrée</div>
                  </div>
                ):(
                  prospects.filter(p=>!prospMethod||p.source===prospMethod).map(p=>{
                    const col = p.score>=85?C.green:p.score>=70?C.amber:C.red;
                    return(
                      <div key={p.id} onClick={()=>setSelProspect(selProspect?.id===p.id?null:p)} style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:selProspect?.id===p.id?C.accentBg:"transparent",transition:"background 0.15s"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                          <div style={{width:28,height:28,borderRadius:6,background:col+"15",border:`1px solid ${col}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:col,flexShrink:0}}>{p.score}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.adresse}</div>
                            <div style={{fontSize:11,color:C.muted}}>{p.ville}</div>
                          </div>
                        </div>
                        <div style={{fontSize:11,color:C.muted,marginLeft:38}}>{p.notes}</div>
                        {selProspect?.id===p.id&&(
                          <div style={{marginTop:10,marginLeft:38,display:"flex",gap:6}}>
                            <button onClick={e=>{e.stopPropagation();setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Je rédige un courrier personnalisé pour le propriétaire au ${p.adresse}, ${p.ville}. Score de probabilité : ${p.score}/100. ${p.notes}`}]);}} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer"}}>Courrier</button>
                            <button onClick={e=>{e.stopPropagation();setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Analyse complète du prospect au ${p.adresse} : score ${p.score}/100, acheté il y a ${(p as any).details?.anciennete_ans||"?"} ans. Quelle stratégie de contact recommandes-tu ?`}]);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,color:C.text,cursor:"pointer",fontWeight:500}}>Analyser</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {/* MAP */}
            <div style={{flex:1,position:"relative"}}>
              <Suspense fallback={<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:13}}>Chargement de la carte...</div>}>
                <MapComponent
                  prospects={prospects.filter(p=>!prospMethod||p.source===prospMethod).filter((p:any)=>p.lat&&p.lng) as any}
                  onSelect={(p:any)=>setSelProspect(p)}
                  center={mapCenter}
                  zoom={13}
                  dark={dark}
                />
              </Suspense>
              {/* Map overlay stats */}
              <div style={{position:"absolute",top:12,left:12,background:dark?"rgba(8,8,8,0.9)":"rgba(255,255,255,0.9)",border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",backdropFilter:"blur(8px)",zIndex:10}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Prospects identifiés</div>
                <div style={{fontSize:20,fontWeight:700,color:C.text}}>{prospects.length}</div>
              </div>
              {dvfLoading&&(
                <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",background:dark?"rgba(8,8,8,0.9)":"rgba(255,255,255,0.9)",border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 24px",backdropFilter:"blur(8px)",zIndex:20,textAlign:"center"}}>
                  <div style={{fontSize:13,color:C.text,marginBottom:4}}>Analyse DVF en cours...</div>
                  <div style={{fontSize:12,color:C.muted}}>Interrogation des données officielles</div>
                </div>
              )}
            </div>
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
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt(m.prix)} €</div>
                </div>
              ))}
            </div>
            {selM?(
              <div style={{flex:1,overflowY:"auto",padding:"32px 40px",animation:"fadeUp 0.25s ease"}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28}}>
                  <div>
                    <h2 style={{fontSize:26,fontWeight:700,color:C.text,letterSpacing:"-0.02em",marginBottom:4}}>{selM.nom_propriete}</h2>
                    <p style={{fontSize:14,color:C.muted}}>{selM.adresse}, {selM.ville}</p>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Préparation de la signature Yousign pour ${selM.nom_propriete}. Envoi à ${selM.proprietaire} (${selM.email}). Confirmation ?`}]);}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 16px",fontSize:13,color:C.text,cursor:"pointer",fontWeight:500}}>Yousign</button>
                    <button onClick={()=>{setChat(true);setMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Rédaction d'un email pour ${selM.proprietaire} concernant ${selM.nom_propriete}. Quel est l'objet ?`}]);}} style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer",fontWeight:500}}>Email</button>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
                  {[{l:"Prix",v:fmt(selM.prix)+" €"},{l:"Surface",v:selM.surface+"m²"},{l:"Terrain",v:selM.terrain?selM.terrain+"m²":"—"},{l:"Chambres",v:String(selM.chambres)},{l:"DPE",v:"Classe "+selM.dpe},{l:"Type",v:selM.type},{l:"Honoraires",v:selM.honoraires+"%"},{l:"Mandat",v:selM.exclusif?"Exclusif":"Simple"}].map(i=>(
                    <div key={i.l} style={{...card(),padding:"14px 16px"}}>
                      <div style={{fontSize:10,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{i.l}</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text}}>{i.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{...card(),padding:"24px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:14}}>Propriétaire</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
                    {[{l:"Nom",v:selM.proprietaire},{l:"Téléphone",v:selM.tel},{l:"Email",v:selM.email}].map(i=>(
                      <div key={i.l}>
                        <div style={{fontSize:11,color:C.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{i.l}</div>
                        <div style={{fontSize:13,color:C.text}}>{i.v||"—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{...card(),padding:"24px"}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:10}}>Description</div>
                  <p style={{fontSize:13,color:C.muted,lineHeight:1.7}}>{selM.description||"Aucune description."}</p>
                </div>
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
              <div style={{fontSize:15,fontWeight:600,color:C.text}}>Pipeline</div>
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
              <button style={{background:C.accent,color:dark?"#080808":"#FAFAFA",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:500,cursor:"pointer"}}>Ajouter</button>
            </div>
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
            <div style={{marginBottom:32}}>
              <h1 style={{fontSize:32,fontWeight:700,color:C.text,letterSpacing:"-0.03em",marginBottom:6}}>Agenda</h1>
              <p style={{color:C.muted,fontSize:15}}>Vos prochains rendez-vous</p>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {rdvs.map(r=>(
                <div key={r.id} style={{...card(),padding:"20px 24px",display:"flex",alignItems:"center",gap:20}}>
                  <div style={{width:3,alignSelf:"stretch",borderRadius:2,background:r.type==="visite"?C.green:r.type==="signature"?C.amber:C.blue,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:3}}>{r.titre}</div>
                    <div style={{fontSize:13,color:C.muted}}>{r.client} · {r.bien}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{new Date(r.date).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}</div>
                    <div style={{fontSize:13,color:C.muted}}>{r.heure} · {r.duree}min</div>
                  </div>
                </div>
              ))}
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

        {/* PROFILE DROPDOWN */}
        {profile&&(
          <div onClick={()=>setProfile(false)} style={{position:"absolute",inset:0,zIndex:90}}>
            <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:56,right:16,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:8,minWidth:200,zIndex:100,boxShadow:`0 16px 48px ${C.shadow}`}}>
              <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,marginBottom:4}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{agent.prenom} {agent.nom}</div>
                <div style={{fontSize:12,color:C.muted}}>{agent.agence}</div>
              </div>
              {[["Tableau de bord",""],["Comptabilité",""],["Mon agence",""],["Paramètres",""]].map(([l])=>(
                <button key={l} onClick={()=>setProfile(false)} style={{width:"100%",display:"flex",padding:"8px 14px",background:"none",border:"none",color:C.text,fontSize:13,textAlign:"left",borderRadius:8,cursor:"pointer"}}>
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
