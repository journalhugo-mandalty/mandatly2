"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
type Mandat = {
  id: number; adresse: string; nom_propriete: string; ville: string;
  prix: number; surface: number; terrain: number; chambres: number;
  dpe: string; type: string; statut: string; pipeline: string;
  proprietaire: string; tel: string; email: string;
  honoraires: number; exclusif: boolean; fin_mandat: string;
  photos: {src:string;name:string}[]; description: string;
};
type Prospect = {
  id: number; nom: string; adresse: string; ville: string;
  score: number; source: string; status: string; tel: string;
  email: string; lat?: number; lng?: number; notes: string;
};
type Acheteur = {
  id: number; nom: string; email: string; tel: string;
  budget_min: number; budget_max: number; surface_min: number;
  chambres_min: number; types: string[]; villes: string[]; notes: string;
};
type RDV = {
  id: number; titre: string; client: string; tel: string;
  date: string; heure: string; duree: number; type: string; bien: string;
};
type ChatMsg = { id: number; role: "user"|"agent"; text: string; };

// ═══════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════
const MANDATS_INIT: Mandat[] = [
  { id:1, adresse:"14 rue des Acacias", nom_propriete:"Villa des Acacias", ville:"Bordeaux", prix:485000, surface:142, terrain:620, chambres:4, dpe:"C", type:"Maison", statut:"signe", pipeline:"signe", proprietaire:"Dupont Marie", tel:"06 12 34 56 78", email:"m.dupont@email.fr", honoraires:5, exclusif:true, fin_mandat:"15/07/2026", photos:[], description:"Belle villa avec jardin paysagé" },
  { id:2, adresse:"32 cours Victor Hugo", nom_propriete:"Résidence Victor Hugo", ville:"Bordeaux", prix:285000, surface:78, terrain:0, chambres:3, dpe:"D", type:"Appartement", statut:"signe", pipeline:"negociation", proprietaire:"Leblanc Pierre", tel:"06 98 76 54 32", email:"p.leblanc@email.fr", honoraires:5, exclusif:false, fin_mandat:"30/06/2026", photos:[], description:"Appartement centre-ville lumineux" },
  { id:3, adresse:"7 allée des Pins", nom_propriete:"Villa Les Pins", ville:"Mérignac", prix:550000, surface:185, terrain:800, chambres:5, dpe:"B", type:"Maison", statut:"en_cours", pipeline:"prospect", proprietaire:"Martin Sophie", tel:"06 55 44 33 22", email:"s.martin@email.fr", honoraires:6, exclusif:true, fin_mandat:"01/09/2026", photos:[], description:"Grande villa avec piscine" },
];
const PROSPECTS_INIT: Prospect[] = [
  { id:1, nom:"Bernard Jean", adresse:"22 rue Gambetta", ville:"Bordeaux", score:94, source:"DVF", status:"À contacter", tel:"", email:"", notes:"Acheté en 2013 · 145m² · 320 000€" },
  { id:2, nom:"Moreau Claire", adresse:"8 bd Maréchal Foch", ville:"Mérignac", score:87, source:"DPE", status:"À contacter", tel:"", email:"", notes:"DPE réalisé en janv. 2026 · Classe F→E" },
  { id:3, nom:"Petit François", adresse:"45 rue des Fleurs", ville:"Pessac", score:72, source:"DVF", status:"À surveiller", tel:"", email:"", notes:"Acheté en 2016 · 98m² · 210 000€" },
];
const ACHETEURS_INIT: Acheteur[] = [
  { id:1, nom:"Lefebvre Thomas", email:"t.lefebvre@gmail.com", tel:"06 11 22 33 44", budget_min:400000, budget_max:550000, surface_min:120, chambres_min:4, types:["Maison"], villes:["Bordeaux","Mérignac"], notes:"Cherche depuis 6 mois" },
  { id:2, nom:"Moreau Claire & Julien", email:"moreau.cj@email.fr", tel:"06 77 88 99 00", budget_min:250000, budget_max:320000, surface_min:70, chambres_min:3, types:["Appartement"], villes:["Bordeaux"], notes:"Premier achat" },
];
const PIPELINE_COLS = [
  {id:"prospect",label:"Prospect",color:"#6B7280"},
  {id:"estimation",label:"Estimation",color:"#F59E0B"},
  {id:"negociation",label:"Négociation",color:"#8B5CF6"},
  {id:"signe",label:"Signé",color:"#10B981"},
  {id:"vendu",label:"Vendu",color:"#3B82F6"},
];

const fmt = (n: number) => n?.toLocaleString("fr-FR") || "0";

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function Mandatly() {
  // Theme
  const [isDark, setIsDark] = useState(true);

  // Navigation
  const [nav, setNav] = useState("dashboard");

  // Data
  const [mandats, setMandats] = useState<Mandat[]>(MANDATS_INIT);
  const [prospects, setProspects] = useState<Prospect[]>(PROSPECTS_INIT);
  const [acheteurs, setAcheteurs] = useState<Acheteur[]>(ACHETEURS_INIT);
  const [rdvs, setRdvs] = useState<RDV[]>([
    { id:1, titre:"Visite Villa Acacias", client:"Thomas Lefebvre", tel:"06 11 22 33 44", date:"2026-05-14", heure:"10:00", duree:60, type:"visite", bien:"14 rue des Acacias" },
    { id:2, titre:"Signature mandat", client:"Sophie Martin", tel:"06 55 44 33 22", date:"2026-05-15", heure:"14:00", duree:90, type:"signature", bien:"7 allée des Pins" },
  ]);

  // UI States
  const [selMandat, setSelMandat] = useState<Mandat|null>(null);
  const [selProspect, setSelProspect] = useState<Prospect|null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { id:1, role:"agent", text:"Bonjour ! Je suis Lucas, votre secrétaire IA. 3 mandats actifs, 3 prospects à contacter. Comment puis-je vous aider ?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Onboarding
  const [onboarding, setOnboarding] = useState(() => typeof window !== "undefined" ? !localStorage.getItem("mandatly_v5_setup") : true);
  const [obStep, setObStep] = useState(0);
  const [obData, setObData] = useState({ prenom:"", nom:"", agence:"", tel:"", email:"", avatar:"lucas" });

  // Prospection
  const [prospStep, setProspStep] = useState(0);
  const [prospSecteur, setProspSecteur] = useState("");
  const [prospMethod, setProspMethod] = useState("");
  const [prospLoading, setProspLoading] = useState(false);

  // Pipeline drag
  const [dragId, setDragId] = useState<number|null>(null);
  const [dragOver, setDragOver] = useState<string|null>(null);

  // Profile/signature
  const [signature, setSignature] = useState({ prenom:"Jean", nom:"Dupont", agence:"Agence Prestige", tel:"05 56 12 34 56", email:"jean.dupont@agence.fr", avatar:"lucas" });
  const agentName = signature.prenom ? `${signature.prenom}` : "Lucas";

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [chatMsgs]);

  // Load profile
  useEffect(() => {
    const saved = localStorage.getItem("mandatly_v5_profile");
    if (saved) { const p = JSON.parse(saved); setSignature(s=>({...s,...p})); }
  }, []);

  // ─── THEME ────────────────────────────────────────────────────
  const T = isDark ? {
    bg:"#0A0A0A", panel:"#111111", panel2:"#161616", nav:"#080808",
    border:"#1E1E1E", border2:"#2A2A2A", card:"#111111",
    text:"#F5F5F5", muted:"#525252", soft:"#737373",
    accent:"#C4A882", accentL:"#D4B892", faint:"#0D0D0D",
    green:"#10B981", red:"#EF4444", warn:"#F59E0B", blue:"#3B82F6",
    shadow:"rgba(0,0,0,0.8)"
  } : {
    bg:"#FAFAFA", panel:"#FFFFFF", panel2:"#F5F5F5", nav:"#FFFFFF",
    border:"#E5E5E5", border2:"#D4D4D4", card:"#FFFFFF",
    text:"#0A0A0A", muted:"#737373", soft:"#525252",
    accent:"#1A1A1A", accentL:"#333333", faint:"#F5F5F5",
    green:"#059669", red:"#DC2626", warn:"#D97706", blue:"#2563EB",
    shadow:"rgba(0,0,0,0.08)"
  };

  const card = (extra={}) => ({ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, ...extra });

  // ─── CLAUDE API ────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const txt = chatInput.trim();
    setChatInput("");
    const userMsg: ChatMsg = { id:Date.now(), role:"user", text:txt };
    const newMsgs = [...chatMsgs, userMsg];
    setChatMsgs(newMsgs);
    setChatTyping(true);

    try {
      const system = `Tu es Lucas, secrétaire IA de ${signature.prenom} ${signature.nom}, agent immobilier chez ${signature.agence}.

MANDATS:
${mandats.map(m=>`- ${m.nom_propriete} (${m.adresse}) | Propriétaire: ${m.proprietaire} | ${m.surface}m² | ${fmt(m.prix)}€ | ${m.chambres} ch | DPE:${m.dpe} | Expire:${m.fin_mandat}`).join("\n")}

PROSPECTS:
${prospects.map(p=>`- ${p.nom} | ${p.adresse} | Score:${p.score} | ${p.notes}`).join("\n")}

ACHETEURS:
${acheteurs.map(a=>`- ${a.nom} | Budget:${fmt(a.budget_min)}-${fmt(a.budget_max)}€ | Min:${a.surface_min}m² ${a.chambres_min}ch | ${a.types.join(",")}`).join("\n")}

RDVs:
${rdvs.map(r=>`- ${r.titre} | ${r.client} | ${r.date} ${r.heure}`).join("\n")}

RÈGLES: Réponds en français, 1-3 phrases max sauf si on demande plus. Tu connais tout par coeur. Langage naturel et professionnel.`;

      const messages = newMsgs.slice(-8).map(m=>({ role: m.role==="agent"?"assistant":"user", content:m.text }));

      const res = await fetch("/api/claude", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ system, messages, max_tokens:600 })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Je n'ai pas pu répondre, réessayez.";
      setChatMsgs(m=>[...m, { id:Date.now(), role:"agent", text:reply }]);
    } catch {
      setChatMsgs(m=>[...m, { id:Date.now(), role:"agent", text:"Erreur de connexion. Vérifiez votre connexion internet." }]);
    }
    setChatTyping(false);
  }, [chatInput, chatMsgs, mandats, prospects, acheteurs, rdvs, signature]);

  // ─── ONBOARDING ────────────────────────────────────────────────
  if (onboarding) {
    const steps = ["Bienvenue","Votre agent IA","Votre profil"];
    const avatars = [
      {id:"lucas",emoji:"🧑‍💼",name:"Lucas",desc:"Professionnel & efficace"},
      {id:"sophie",emoji:"👩‍💼",name:"Sophie",desc:"Élégante & précise"},
      {id:"alex",emoji:"🧑‍💻",name:"Alex",desc:"Moderne & dynamique"},
      {id:"marie",emoji:"👩‍🎓",name:"Marie",desc:"Chaleureuse & experte"},
    ];
    return (
      <div style={{minHeight:"100vh",background:"#0A0A0A",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'DM Sans',sans-serif"}}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Serif+Display:ital@0;1&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>
        <div style={{width:"100%",maxWidth:480}}>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:8}}>
              <svg width="28" height="28" viewBox="-100 -100 200 200" fill="none"><path d="M0,-72 C28,-72 52,-50 58,-22 C64,8 48,36 24,50 C14,56 4,58 0,56 C-4,58 -14,56 -24,50 C-48,36 -64,8 -58,-22 C-52,-50 -28,-72 0,-72 Z" stroke="#C4A882" strokeWidth="7" strokeLinecap="round"/><path d="M0,-72 C12,-50 18,-28 12,-10 C6,6 -6,6 -12,-10 C-18,-28 -12,-50 0,-72" stroke="#C4A882" strokeWidth="5"/><path d="M24,50 C14,28 20,6 34,-2 C46,-10 54,4 48,20 C42,36 34,48 24,50" stroke="#C4A882" strokeWidth="5"/><path d="M-24,50 C-14,28 -20,6 -34,-2 C-46,-10 -54,4 -48,20 C-42,36 -34,48 -24,50" stroke="#C4A882" strokeWidth="5"/></svg>
              <span style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:"#F5F5F5",letterSpacing:"-0.02em"}}>Mandatly</span>
            </div>
            <div style={{display:"flex",gap:6,justifyContent:"center"}}>
              {steps.map((s,i)=><div key={s} style={{height:3,width:48,borderRadius:2,background:i<=obStep?"#C4A882":"#1E1E1E",transition:"background 0.3s"}}/>)}
            </div>
          </div>

          {obStep===0&&(
            <div style={{background:"#111",border:"1px solid #1E1E1E",borderRadius:24,padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:20}}>🎉</div>
              <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:"#F5F5F5",marginBottom:12,lineHeight:1.3}}>Bienvenue dans Mandatly</h1>
              <p style={{fontSize:14,color:"#737373",lineHeight:1.8,marginBottom:24}}>Vous rejoignez le premier CRM immobilier doté d'un <strong style={{color:"#F5F5F5"}}>vrai agent IA</strong> qui prospecte, rédige vos courriers et gère votre agenda — pendant que vous faites des visites.</p>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:28,textAlign:"left"}}>
                {["🏠 Prospection automatique DVF & DPE","🤖 Lucas rédige, vous validez","📊 Pipeline et avis de valeur en 2min","✉️ Courriers personnalisés en 1 clic"].map(item=>(
                  <div key={item} style={{padding:"10px 16px",background:"#0D0D0D",borderRadius:10,fontSize:13,color:"#A3A3A3",border:"1px solid #1E1E1E"}}>{item}</div>
                ))}
              </div>
              <p style={{fontSize:12,color:"#525252",marginBottom:20,fontStyle:"italic"}}>Pour vivre l'expérience Mandatly comme il se doit, configurons ensemble votre agent IA et votre profil.</p>
              <button onClick={()=>setObStep(1)} style={{width:"100%",background:"linear-gradient(135deg,#C4A882,#D4B892)",color:"#0A0A0A",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Commencer →</button>
            </div>
          )}

          {obStep===1&&(
            <div style={{background:"#111",border:"1px solid #1E1E1E",borderRadius:24,padding:36}}>
              <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:"#F5F5F5",marginBottom:6,textAlign:"center"}}>Choisissez votre agent IA</h2>
              <p style={{fontSize:13,color:"#737373",marginBottom:24,textAlign:"center"}}>Il travaillera avec vous au quotidien</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                {avatars.map(av=>(
                  <div key={av.id} onClick={()=>setObData(d=>({...d,avatar:av.id}))} style={{padding:"18px 14px",borderRadius:14,border:`2px solid ${obData.avatar===av.id?"#C4A882":"#1E1E1E"}`,background:obData.avatar===av.id?"#C4A88210":"#0D0D0D",cursor:"pointer",textAlign:"center",transition:"all 0.2s"}}>
                    <div style={{fontSize:36,marginBottom:8}}>{av.emoji}</div>
                    <div style={{fontSize:14,fontWeight:600,color:"#F5F5F5",marginBottom:3}}>{av.name}</div>
                    <div style={{fontSize:11,color:"#737373"}}>{av.desc}</div>
                    {obData.avatar===av.id&&<div style={{marginTop:8,fontSize:10,color:"#C4A882",fontWeight:700}}>✓ Sélectionné</div>}
                  </div>
                ))}
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:"#737373",marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"center"}}>Personnalisez son prénom</div>
                <input value={obData.prenom||avatars.find(a=>a.id===obData.avatar)?.name||""} onChange={e=>setObData(d=>({...d,prenom:e.target.value}))} placeholder="Ex: Lucas" style={{width:"100%",background:"#0D0D0D",border:"1px solid #C4A882",borderRadius:10,color:"#F5F5F5",padding:"12px",fontSize:15,fontWeight:600,outline:"none",textAlign:"center"}}/>
              </div>
              <button onClick={()=>setObStep(2)} style={{width:"100%",background:"linear-gradient(135deg,#C4A882,#D4B892)",color:"#0A0A0A",border:"none",borderRadius:12,padding:"13px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Continuer →</button>
            </div>
          )}

          {obStep===2&&(
            <div style={{background:"#111",border:"1px solid #1E1E1E",borderRadius:24,padding:36}}>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:36,marginBottom:8}}>{avatars.find(a=>a.id===obData.avatar)?.emoji||"🧑‍💼"}</div>
                <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:"#F5F5F5",marginBottom:4}}>{obData.prenom||"Lucas"} a besoin de vous connaître</h2>
                <p style={{fontSize:13,color:"#737373"}}>Pour personnaliser chaque interaction</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                {[{l:"Prénom",k:"prenom",p:"Jean",span:false},{l:"Nom",k:"nom",p:"Dupont",span:false},{l:"Agence",k:"agence",p:"Agence Prestige",span:true},{l:"Téléphone",k:"tel",p:"05 56 12 34 56",span:false},{l:"Email",k:"email",p:"jean@agence.fr",span:false}].map(f=>(
                  <div key={f.k} style={{gridColumn:f.span?"1/-1":"auto"}}>
                    <div style={{fontSize:10,color:"#737373",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>{f.l}</div>
                    <input value={(obData as any)[f.k]||""} onChange={e=>setObData(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p} style={{width:"100%",background:"#0D0D0D",border:"1px solid #1E1E1E",borderRadius:10,color:"#F5F5F5",padding:"10px 12px",fontSize:13,outline:"none"}} onFocus={e=>e.target.style.borderColor="#C4A882"} onBlur={e=>e.target.style.borderColor="#1E1E1E"}/>
                  </div>
                ))}
              </div>
              <button onClick={()=>{
                const profile = {...obData, prenom:obData.prenom||avatars.find(a=>a.id===obData.avatar)?.name||"Lucas"};
                setSignature(s=>({...s,...profile}));
                localStorage.setItem("mandatly_v5_setup","1");
                localStorage.setItem("mandatly_v5_profile",JSON.stringify(profile));
                setOnboarding(false);
              }} disabled={!obData.agence} style={{width:"100%",background:obData.agence?"linear-gradient(135deg,#C4A882,#D4B892)":"#1E1E1E",color:obData.agence?"#0A0A0A":"#525252",border:"none",borderRadius:12,padding:"14px",fontSize:14,fontWeight:800,cursor:obData.agence?"pointer":"not-allowed"}}>
                Accéder à Mandatly 🚀
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN LAYOUT
  // ═══════════════════════════════════════════════════════════════
  const NAV_ITEMS = [
    {id:"dashboard",icon:"⌂",label:"Dashboard"},
    {id:"prospects",icon:"🗺",label:"Prospection"},
    {id:"mandats",icon:"📋",label:"Mandats"},
    {id:"pipeline",icon:"⟶",label:"Pipeline"},
    {id:"acheteurs",icon:"👥",label:"Acheteurs"},
    {id:"agenda",icon:"📅",label:"Agenda"},
    {id:"emails",icon:"✉",label:"Emails"},
  ];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:T.bg,fontFamily:"'DM Sans',sans-serif",color:T.text,overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap');*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:${T.border2};border-radius:2px;}button{cursor:pointer;}input,select,textarea{font-family:inherit;}input:focus,select:focus,textarea:focus{outline:none;}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* TOPBAR */}
      <div style={{height:56,background:T.nav,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",padding:"0 16px",gap:8,flexShrink:0,zIndex:50}}>
        {/* Logo */}
        <div onClick={()=>setNav("dashboard")} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginRight:8,flexShrink:0}}>
          <svg width="24" height="24" viewBox="-100 -100 200 200" fill="none">
            <path d="M0,-72 C28,-72 52,-50 58,-22 C64,8 48,36 24,50 C14,56 4,58 0,56 C-4,58 -14,56 -24,50 C-48,36 -64,8 -58,-22 C-52,-50 -28,-72 0,-72 Z" stroke={T.accent} strokeWidth="7" strokeLinecap="round"/>
            <path d="M0,-72 C12,-50 18,-28 12,-10 C6,6 -6,6 -12,-10 C-18,-28 -12,-50 0,-72" stroke={T.accent} strokeWidth="5"/>
            <path d="M24,50 C14,28 20,6 34,-2 C46,-10 54,4 48,20 C42,36 34,48 24,50" stroke={T.accent} strokeWidth="5"/>
            <path d="M-24,50 C-14,28 -20,6 -34,-2 C-46,-10 -54,4 -48,20 C-42,36 -34,48 -24,50" stroke={T.accent} strokeWidth="5"/>
          </svg>
          <span style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.text,letterSpacing:"-0.02em"}}>Mandatly</span>
        </div>

        {/* Nav */}
        <div style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
          {NAV_ITEMS.map(n=>(
            <button key={n.id} onClick={()=>setNav(n.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:nav===n.id?"rgba(196,168,130,0.12)":"transparent",border:`1px solid ${nav===n.id?"rgba(196,168,130,0.2)":"transparent"}`,borderRadius:8,color:nav===n.id?T.accent:T.muted,fontSize:13,fontWeight:nav===n.id?600:400,whiteSpace:"nowrap",transition:"all 0.15s"}}>
              <span style={{fontSize:13}}>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <button onClick={()=>setChatOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:chatOpen?"rgba(196,168,130,0.12)":T.faint,border:`1px solid ${chatOpen?T.accent:T.border}`,borderRadius:8,color:chatOpen?T.accent:T.muted,fontSize:13,fontWeight:600}}>
            <span>💬</span>
            <span>{signature.prenom||"Lucas"}</span>
            {chatTyping&&<span style={{width:6,height:6,borderRadius:"50%",background:T.green,animation:"pulse 1s infinite",flexShrink:0}}/>}
          </button>
          <button onClick={()=>setIsDark(d=>!d)} style={{width:32,height:32,borderRadius:8,background:T.faint,border:`1px solid ${T.border}`,color:T.muted,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>{isDark?"☀️":"🌙"}</button>
          <div onClick={()=>setProfileOpen(o=>!o)} style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${T.accent},${T.accentL})`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,fontWeight:800,color:"#0A0A0A",flexShrink:0}}>
            {(signature.prenom[0]||"J")}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>

        {/* DASHBOARD */}
        {nav==="dashboard"&&(
          <div style={{flex:1,overflowY:"auto",padding:24}}>
            <div style={{marginBottom:24}}>
              <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:T.text,marginBottom:4}}>Bonjour, {signature.prenom} 👋</h1>
              <p style={{color:T.muted,fontSize:14}}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</p>
            </div>

            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              {[
                {label:"Mandats actifs",value:mandats.length,icon:"📋",color:T.accent},
                {label:"CA estimé",value:fmt(mandats.reduce((a,m)=>a+Math.round(m.prix*m.honoraires/100),0))+" €",icon:"💰",color:T.green},
                {label:"Prospects",value:prospects.length,icon:"🎯",color:T.warn},
                {label:"RDVs ce mois",value:rdvs.length,icon:"📅",color:T.blue},
              ].map(k=>(
                <div key={k.label} style={{...card(),padding:"16px 20px"}}>
                  <div style={{fontSize:20,marginBottom:8}}>{k.icon}</div>
                  <div style={{fontSize:11,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{k.label}</div>
                  <div style={{fontSize:22,fontWeight:800,color:k.color}}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* 2 cols */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {/* Mandats récents */}
              <div style={{...card(),padding:20}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.text,marginBottom:14}}>Mandats actifs</div>
                {mandats.map(m=>(
                  <div key={m.id} onClick={()=>{setNav("mandats");setSelMandat(m);}} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}>
                    <div style={{width:36,height:36,borderRadius:8,background:T.faint,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>🏠</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                      <div style={{fontSize:11,color:T.muted}}>{m.proprietaire}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:T.accent,flexShrink:0}}>{fmt(m.prix)}€</div>
                  </div>
                ))}
              </div>

              {/* Prochains RDVs */}
              <div style={{...card(),padding:20}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.text,marginBottom:14}}>Prochains rendez-vous</div>
                {rdvs.map(r=>(
                  <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
                    <div style={{width:36,height:36,borderRadius:8,background:r.type==="visite"?T.green+"20":T.accent+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{r.type==="visite"?"👁":"✍"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.titre}</div>
                      <div style={{fontSize:11,color:T.muted}}>{r.client} · {r.date} {r.heure}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PROSPECTION */}
        {nav==="prospects"&&(
          <div style={{flex:1,overflowY:"auto",padding:24}}>
            <div style={{marginBottom:24}}>
              <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:T.text,marginBottom:4}}>Prospection intelligente</h1>
              <p style={{color:T.muted,fontSize:14}}>Trouvez vos prochains mandats en quelques clics</p>
            </div>

            {/* Étape 1 */}
            <div style={{...card(),padding:24,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:T.accent+"20",border:`1px solid ${T.accent}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.accent}}>1</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:T.text}}>Définissez votre secteur</div>
                  <div style={{fontSize:12,color:T.muted}}>Code postal ou nom de ville</div>
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <input value={prospSecteur} onChange={e=>setProspSecteur(e.target.value)} placeholder="Ex: 33000 ou Bordeaux..." style={{flex:1,background:T.faint,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"12px 16px",fontSize:14}} onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
                <button style={{background:`linear-gradient(135deg,${T.accent},${T.accentL})`,color:"#0A0A0A",border:"none",borderRadius:10,padding:"12px 20px",fontSize:13,fontWeight:700}}>Valider →</button>
              </div>
            </div>

            {/* Étape 2 - Méthodes */}
            <div style={{...card(),padding:24,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:T.accent+"20",border:`1px solid ${T.accent}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.accent}}>2</div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:T.text}}>Choisissez votre méthode</div>
                  <div style={{fontSize:12,color:T.muted}}>Plusieurs sources pour maximiser vos chances</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>
                {[
                  {id:"dvf",icon:"🏠",titre:"Qui va bientôt vendre ?",desc:"Propriétaires ayant acheté il y a 7-12 ans",badge:"DVF Officiel",color:T.green},
                  {id:"dpe",icon:"⚡",titre:"Qui prépare une vente ?",desc:"DPE récents = signal fort de mise en vente",badge:"ADEME",color:T.warn},
                  {id:"streetview",icon:"📬",titre:"Prospecter rue par rue",desc:"Street View IA lit les boîtes aux lettres",badge:"IA Vision",color:"#8B5CF6"},
                  {id:"concurrent",icon:"🏷",titre:"Biens en vente chez les concurrents",desc:"Retrouve le propriétaire via cadastre + DVF",badge:"Veille",color:T.blue},
                ].map(m=>(
                  <div key={m.id} onClick={()=>setProspMethod(prospMethod===m.id?"":m.id)} style={{padding:16,borderRadius:14,border:`1.5px solid ${prospMethod===m.id?m.color:T.border}`,background:prospMethod===m.id?m.color+"0D":T.faint,cursor:"pointer",transition:"all 0.2s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <span style={{fontSize:22}}>{m.icon}</span>
                      <span style={{fontSize:9,background:m.color+"20",color:m.color,padding:"2px 8px",borderRadius:20,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>{m.badge}</span>
                      {prospMethod===m.id&&<span style={{marginLeft:"auto",fontSize:11,color:m.color,fontWeight:700}}>✓</span>}
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:4}}>{m.titre}</div>
                    <div style={{fontSize:11,color:T.muted,lineHeight:1.5}}>{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Étape 3 - Lancer */}
            {prospMethod&&(
              <div style={{...card(),padding:24,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:T.green+"20",border:`1px solid ${T.green}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:T.green}}>3</div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:T.text}}>Lancer la prospection</div>
                    <div style={{fontSize:12,color:T.muted}}>Lucas analyse et prépare les courriers</div>
                  </div>
                </div>
                <button onClick={()=>{setProspLoading(true);setTimeout(()=>{setProspLoading(false);setChatMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`J'ai analysé le secteur ${prospSecteur||"sélectionné"}. J'ai identifié ${prospects.length} prospects prioritaires. Je prépare les courriers personnalisés.`}]);setChatOpen(true);},2000);}} style={{width:"100%",background:`linear-gradient(135deg,${T.accent},${T.accentL})`,color:"#0A0A0A",border:"none",borderRadius:12,padding:"14px",fontSize:14,fontWeight:800}}>
                  {prospLoading?"⏳ Analyse en cours...":"🚀 Lancer — Lucas s'occupe de tout"}
                </button>
              </div>
            )}

            {/* Prospects existants */}
            {prospects.length>0&&(
              <div style={{...card(),padding:24}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.text,marginBottom:14}}>{prospects.length} prospects identifiés</div>
                {prospects.map(p=>{
                  const col = p.score>=85?T.green:p.score>=70?T.warn:T.red;
                  return(
                    <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:col+"20",border:`2px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:col,flexShrink:0}}>{p.score}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{p.adresse}</div>
                        <div style={{fontSize:11,color:T.muted}}>{p.source} · {p.notes}</div>
                      </div>
                      <button onClick={()=>{setChatMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Je rédige un courrier personnalisé pour le propriétaire au ${p.adresse}...`}]);setChatOpen(true);}} style={{background:T.accent+"20",color:T.accent,border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,flexShrink:0}}>✉ Courrier</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* MANDATS */}
        {nav==="mandats"&&(
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* Liste */}
            <div style={{width:280,borderRight:`1px solid ${T.border}`,overflowY:"auto",flexShrink:0}}>
              <div style={{padding:"16px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.text}}>Mandats</div>
                <button onClick={()=>setMandats(m=>[...m,{id:Date.now(),adresse:"Nouvelle adresse",nom_propriete:"Nouveau bien",ville:"",prix:0,surface:0,terrain:0,chambres:3,dpe:"C",type:"Maison",statut:"en_cours",pipeline:"prospect",proprietaire:"",tel:"",email:"",honoraires:5,exclusif:true,fin_mandat:"",photos:[],description:""}])} style={{background:T.accent,color:"#0A0A0A",border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700}}>+ Nouveau</button>
              </div>
              {mandats.map(m=>(
                <div key={m.id} onClick={()=>setSelMandat(m)} style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,cursor:"pointer",background:selMandat?.id===m.id?T.faint:"transparent",transition:"background 0.15s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                    <div style={{fontSize:9,background:m.exclusif?T.green+"20":T.warn+"20",color:m.exclusif?T.green:T.warn,padding:"2px 6px",borderRadius:6,fontWeight:700,flexShrink:0}}>{m.exclusif?"EXC":"SIM"}</div>
                  </div>
                  <div style={{fontSize:11,color:T.muted,marginBottom:4}}>{m.proprietaire}</div>
                  <div style={{fontSize:13,fontWeight:700,color:T.accent}}>{fmt(m.prix)} €</div>
                </div>
              ))}
            </div>

            {/* Détail */}
            {selMandat?(
              <div style={{flex:1,overflowY:"auto",padding:24}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
                  <div>
                    <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:T.text,marginBottom:4}}>{selMandat.nom_propriete}</h2>
                    <p style={{fontSize:13,color:T.muted}}>{selMandat.adresse}, {selMandat.ville}</p>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setChatMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Je prépare le mandat de ${selMandat.nom_propriete} pour signature Yousign. Envoi à ${selMandat.proprietaire} (${selMandat.email}). Confirmez-vous ?`}]);setChatOpen(true);}} style={{background:"#5B50F620",color:"#5B50F6",border:"1px solid #5B50F640",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700}}>✍ Yousign</button>
                    <button onClick={()=>{setChatMsgs(m=>[...m,{id:Date.now(),role:"agent",text:`Je rédige un email pour ${selMandat.proprietaire} concernant ${selMandat.nom_propriete}. Quel est l'objet ?`}]);setChatOpen(true);}} style={{background:T.accent+"20",color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700}}>📧 Email</button>
                  </div>
                </div>

                {/* Infos */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                  {[{l:"Prix",v:fmt(selMandat.prix)+" €"},{l:"Surface",v:selMandat.surface+"m²"},{l:"Chambres",v:selMandat.chambres},{l:"DPE",v:"Classe "+selMandat.dpe},{l:"Type",v:selMandat.type},{l:"Honoraires",v:selMandat.honoraires+"%"},{l:"Expiration",v:selMandat.fin_mandat||"—"},{l:"Mandat",v:selMandat.exclusif?"Exclusif":"Simple"}].map(i=>(
                    <div key={i.l} style={{...card(),padding:"12px 16px"}}>
                      <div style={{fontSize:10,color:T.muted,fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{i.l}</div>
                      <div style={{fontSize:14,fontWeight:700,color:T.text}}>{i.v}</div>
                    </div>
                  ))}
                </div>

                {/* Propriétaire */}
                <div style={{...card(),padding:20,marginBottom:16}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.text,marginBottom:14}}>Propriétaire</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                    {[{l:"Nom",v:selMandat.proprietaire},{l:"Téléphone",v:selMandat.tel},{l:"Email",v:selMandat.email}].map(i=>(
                      <div key={i.l}>
                        <div style={{fontSize:10,color:T.muted,fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{i.l}</div>
                        <div style={{fontSize:13,color:T.text,fontWeight:500}}>{i.v||"—"}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div style={{...card(),padding:20}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:T.text,marginBottom:10}}>Description</div>
                  <p style={{fontSize:13,color:T.muted,lineHeight:1.7}}>{selMandat.description||"Aucune description"}</p>
                </div>
              </div>
            ):(
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8,color:T.muted}}>
                <span style={{fontSize:40,opacity:0.2}}>📋</span>
                <span style={{fontSize:14}}>Sélectionnez un mandat</span>
              </div>
            )}
          </div>
        )}

        {/* PIPELINE */}
        {nav==="pipeline"&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"16px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:T.text}}>Pipeline commercial</div>
              <div style={{fontSize:13,color:T.muted}}>CA signé : <strong style={{color:T.green}}>{fmt(mandats.filter(m=>m.pipeline==="signe"||m.pipeline==="vendu").reduce((a,m)=>a+Math.round(m.prix*m.honoraires/100),0))} €</strong></div>
            </div>
            <div style={{flex:1,overflowX:"auto",display:"flex",gap:12,padding:20}}>
              {PIPELINE_COLS.map(col=>{
                const colMandats = mandats.filter(m=>(m.pipeline||"prospect")===col.id);
                return(
                  <div key={col.id} onDragOver={e=>{e.preventDefault();setDragOver(col.id);}} onDragLeave={()=>setDragOver(null)} onDrop={e=>{e.preventDefault();if(dragId){setMandats(ms=>ms.map(m=>m.id===dragId?{...m,pipeline:col.id}:m));setDragId(null);setDragOver(null);}}} style={{width:220,minWidth:220,background:dragOver===col.id?col.color+"10":T.panel,border:`1.5px solid ${dragOver===col.id?col.color:T.border}`,borderRadius:16,display:"flex",flexDirection:"column",flexShrink:0,transition:"all 0.2s"}}>
                    <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:col.color}}/>
                        <span style={{fontSize:13,fontWeight:700,color:T.text}}>{col.label}</span>
                        <span style={{marginLeft:"auto",background:col.color+"20",color:col.color,borderRadius:12,padding:"1px 8px",fontSize:11,fontWeight:700}}>{colMandats.length}</span>
                      </div>
                    </div>
                    <div style={{flex:1,overflowY:"auto",padding:8}}>
                      {colMandats.map(m=>(
                        <div key={m.id} draggable onDragStart={()=>setDragId(m.id)} onDragEnd={()=>{setDragId(null);setDragOver(null);}} onClick={()=>{setNav("mandats");setSelMandat(m);}} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:12,padding:12,marginBottom:8,cursor:"grab",opacity:dragId===m.id?0.4:1,transition:"opacity 0.15s"}}>
                          <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</div>
                          <div style={{fontSize:11,color:T.muted,marginBottom:8}}>{m.proprietaire}</div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{fontSize:12,fontWeight:700,color:T.accent}}>{fmt(m.prix)}€</span>
                            <span style={{fontSize:9,background:m.exclusif?T.green+"20":T.faint,color:m.exclusif?T.green:T.muted,padding:"2px 6px",borderRadius:6,fontWeight:700}}>{m.exclusif?"Excl.":"Sim."}</span>
                          </div>
                        </div>
                      ))}
                      {colMandats.length===0&&<div style={{height:60,border:`1px dashed ${T.border}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:T.muted}}>Déposez ici</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ACHETEURS */}
        {nav==="acheteurs"&&(
          <div style={{flex:1,overflowY:"auto",padding:24}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
              <div>
                <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:T.text,marginBottom:4}}>Acheteurs</h1>
                <p style={{color:T.muted,fontSize:14}}>{acheteurs.length} acheteurs actifs</p>
              </div>
              <button style={{background:`linear-gradient(135deg,${T.accent},${T.accentL})`,color:"#0A0A0A",border:"none",borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700}}>+ Nouveau</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
              {acheteurs.map(a=>{
                const matches = mandats.filter(m=>m.prix>=a.budget_min&&m.prix<=a.budget_max&&m.surface>=a.surface_min&&a.types.includes(m.type));
                return(
                  <div key={a.id} style={{...card(),padding:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:`linear-gradient(135deg,${T.accent}40,${T.accentL}40)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:T.accent,flexShrink:0}}>{a.nom[0]}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:T.text}}>{a.nom}</div>
                        <div style={{fontSize:11,color:T.muted}}>{a.email}</div>
                      </div>
                      {matches.length>0&&<div style={{background:T.green+"20",color:T.green,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>{matches.length} match{matches.length>1?"s":""}</div>}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                      {[{l:"Budget",v:`${fmt(a.budget_min)}-${fmt(a.budget_max)}€`},{l:"Surface min",v:`${a.surface_min}m²`},{l:"Chambres",v:`${a.chambres_min}+ ch`},{l:"Types",v:a.types.join(", ")}].map(i=>(
                        <div key={i.l} style={{background:T.faint,borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontSize:9,color:T.muted,fontWeight:600,textTransform:"uppercase",marginBottom:2}}>{i.l}</div>
                          <div style={{fontSize:12,fontWeight:600,color:T.text}}>{i.v}</div>
                        </div>
                      ))}
                    </div>
                    {matches.length>0&&(
                      <div style={{borderTop:`1px solid ${T.border}`,paddingTop:10}}>
                        <div style={{fontSize:11,color:T.muted,marginBottom:6}}>Biens compatibles :</div>
                        {matches.map(m=>(
                          <div key={m.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{width:6,height:6,borderRadius:"50%",background:T.green,flexShrink:0}}/>
                            <span style={{fontSize:12,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom_propriete}</span>
                            <span style={{fontSize:11,color:T.green,fontWeight:700,flexShrink:0}}>{fmt(m.prix)}€</span>
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
          <div style={{flex:1,overflowY:"auto",padding:24}}>
            <div style={{marginBottom:24}}>
              <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:28,color:T.text,marginBottom:4}}>Agenda</h1>
              <p style={{color:T.muted,fontSize:14}}>Vos prochains rendez-vous</p>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {rdvs.map(r=>(
                <div key={r.id} style={{...card(),padding:20,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{width:50,height:50,borderRadius:12,background:r.type==="visite"?T.green+"20":r.type==="signature"?T.accent+"20":T.blue+"20",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <div style={{fontSize:18}}>{r.type==="visite"?"👁":r.type==="signature"?"✍":"📞"}</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:2}}>{r.titre}</div>
                    <div style={{fontSize:13,color:T.muted,marginBottom:4}}>{r.client} · {r.tel}</div>
                    <div style={{fontSize:12,color:T.muted}}>{r.bien}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:T.text}}>{new Date(r.date).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}</div>
                    <div style={{fontSize:13,color:T.accent,fontWeight:600}}>{r.heure}</div>
                    <div style={{fontSize:11,color:T.muted}}>{r.duree}min</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* EMAILS */}
        {nav==="emails"&&(
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:T.muted}}>
            <span style={{fontSize:48,opacity:0.2}}>✉</span>
            <span style={{fontSize:16,fontWeight:600,color:T.text}}>Emails</span>
            <span style={{fontSize:13}}>Connectez votre boîte email pour voir vos messages</span>
            <button style={{background:`linear-gradient(135deg,${T.accent},${T.accentL})`,color:"#0A0A0A",border:"none",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:700}}>Connecter Gmail / Outlook</button>
          </div>
        )}

        {/* LUCAS CHAT */}
        {chatOpen&&(
          <div style={{width:340,borderLeft:`1px solid ${T.border}`,display:"flex",flexDirection:"column",background:T.panel,flexShrink:0}}>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:T.green,animation:"pulse 2s infinite"}}/>
                <span style={{fontSize:14,fontWeight:700,color:T.text}}>{signature.prenom||"Lucas"}</span>
                <span style={{fontSize:11,color:T.muted}}>· En ligne</span>
              </div>
              <button onClick={()=>setChatOpen(false)} style={{background:"none",border:"none",color:T.muted,fontSize:18}}>×</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
              {chatMsgs.map(m=>(
                <div key={m.id} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",animation:"fadeIn 0.2s ease"}}>
                  <div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.role==="user"?`linear-gradient(135deg,${T.accent},${T.accentL})`:T.faint,color:m.role==="user"?"#0A0A0A":T.text,fontSize:13,lineHeight:1.5,border:m.role==="agent"?`1px solid ${T.border}`:"none"}}>
                    {m.text}
                  </div>
                </div>
              ))}
              {chatTyping&&(
                <div style={{display:"flex",gap:4,padding:"10px 14px",background:T.faint,borderRadius:"18px 18px 18px 4px",width:"fit-content",border:`1px solid ${T.border}`}}>
                  {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.muted,animation:`pulse 1s infinite ${i*0.2}s`}}/>)}
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            <div style={{padding:12,borderTop:`1px solid ${T.border}`,display:"flex",gap:8}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder={`Parler à ${signature.prenom||"Lucas"}...`} style={{flex:1,background:T.faint,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"10px 14px",fontSize:13}} onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
              <button onClick={sendChat} style={{background:`linear-gradient(135deg,${T.accent},${T.accentL})`,border:"none",color:"#0A0A0A",borderRadius:10,padding:"10px 14px",fontSize:15,fontWeight:700}}>→</button>
            </div>
          </div>
        )}

        {/* PROFILE MENU */}
        {profileOpen&&(
          <div style={{position:"absolute",top:8,right:16,background:T.panel,border:`1px solid ${T.border}`,borderRadius:14,padding:8,minWidth:200,zIndex:100,boxShadow:`0 20px 60px ${T.shadow}`}}>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
              <div style={{fontSize:14,fontWeight:700,color:T.text}}>{signature.prenom} {signature.nom}</div>
              <div style={{fontSize:12,color:T.muted}}>{signature.agence}</div>
            </div>
            {[{icon:"📈",label:"Tableau de bord"},{icon:"💰",label:"Comptabilité"},{icon:"🏢",label:"Mon agence"},{icon:"⚙",label:"Paramètres"}].map(item=>(
              <button key={item.label} onClick={()=>setProfileOpen(false)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 14px",background:"none",border:"none",color:T.text,fontSize:13,textAlign:"left",borderRadius:8}}>
                <span>{item.icon}</span>{item.label}
              </button>
            ))}
            <div style={{borderTop:`1px solid ${T.border}`,marginTop:4,paddingTop:4}}>
              <button onClick={()=>{localStorage.removeItem("mandatly_v5_setup");localStorage.removeItem("mandatly_v5_profile");setOnboarding(true);setProfileOpen(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 14px",background:"none",border:"none",color:T.red,fontSize:13,textAlign:"left",borderRadius:8}}>
                <span>↩</span>Réinitialiser l'onboarding
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
