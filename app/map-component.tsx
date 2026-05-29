"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: any; adresse: string; ville: string; score: number;
  source: string; notes: string; lat: number; lng: number;
  proprietaire_nom?: string; classe_dpe?: string; prix_achat?: number; surface?: number;
};
export type LayerState = { parcelles: boolean; ventes: boolean; proprietaires: boolean; dpe: boolean; };
type Props = {
  prospects: Prospect[];
  onSelect?: (p: Prospect) => void;
  onParcelClick?: (data: { properties: any; centroid: [number,number]; matchingProspects: Prospect[] }) => void;
  center: [number, number];
  dark?: boolean;
  satellite?: boolean;
  flyToTarget?: { lat: number; lng: number; zoom?: number; key: any };
  layers?: LayerState;
};

const TILE_PLAN = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image%2Fpng&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
const TILE_SAT  = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image%2Fjpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const Z_REGION  = 5;
const Z_DEPT    = 8;
const Z_COMMUNE = 11;
const Z_SECTION = 13;
const Z_PARCEL  = 15;

const C_OWNER = "#22C55E";   // vert  — propriétaire connu
const C_SALE  = "#7C3AED";   // violet — vente DVF
const C_DPE   = "#F97316";   // orange — signal DPE seul

function dpeColor(cls: string): string {
  switch ((cls||"").toUpperCase()) {
    case "A": return "#059669"; case "B": return "#10B981"; case "C": return "#84CC16";
    case "D": return "#EAB308"; case "E": return "#F97316";
    case "F": return "#EF4444"; case "G": return "#B91C1C";
    default:  return "#64748B";
  }
}

function lerpColor(a: string, b: string, t: number): string {
  const hr = (s: string, i: number) => parseInt(s.slice(i, i+2), 16);
  const r = Math.round(hr(a,1)+(hr(b,1)-hr(a,1))*t);
  const g = Math.round(hr(a,3)+(hr(b,3)-hr(a,3))*t);
  const bv= Math.round(hr(a,5)+(hr(b,5)-hr(a,5))*t);
  return `#${[r,g,bv].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
}
function heatColor(prixM2: number): string {
  const t = Math.max(0, Math.min(1, (prixM2-1500)/9500));
  if (t<0.33) return lerpColor("#4ADE80","#FDE047",t/0.33);
  if (t<0.67) return lerpColor("#FDE047","#FB923C",(t-0.33)/0.34);
  return lerpColor("#FB923C","#EF4444",(t-0.67)/0.33);
}
function normStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g," ").trim();
}
function getHeatStyle(f: any, prospects: Prospect[]): any | null {
  const nom = normStr(f.properties?.nom||f.properties?.nom_com||"");
  if (!nom||nom.length<2) return null;
  const dvfPs = prospects.filter((p:any)=>p.source!=="DPE"&&p.prix_achat&&p.surface);
  if (!dvfPs.length) return null;
  const match = dvfPs.filter((p:any)=>{ const v=normStr(p.ville||""); return v&&(nom===v||nom.includes(v)||v.includes(nom)); });
  if (match.length<2) return null;
  const prices=match.map((p:any)=>p.prix_achat/p.surface).sort((a:number,b:number)=>a-b);
  const median=prices[Math.floor(prices.length/2)];
  return {fillColor:heatColor(median),fillOpacity:0.45,color:"#94A3B8",weight:1,opacity:0.5};
}
function isMultiPoly(c: any): boolean { return Array.isArray(c?.[0]?.[0]?.[0]); }
function centroidOf(c: any): [number,number] {
  const polys: number[][][][] = isMultiPoly(c)?c:[c];
  const ring=polys[0][0];
  return [ring.reduce((s:number,v:number[])=>s+v[1],0)/ring.length, ring.reduce((s:number,v:number[])=>s+v[0],0)/ring.length];
}
function nearbyProspects(clat: number, clng: number, ps: Prospect[], km=0.18): Prospect[] {
  return ps.filter(p=>{
    if(!p.lat||!p.lng)return false;
    const dlat=(p.lat-clat)*111, dlng=(p.lng-clng)*111*Math.cos(clat*Math.PI/180);
    return Math.sqrt(dlat*dlat+dlng*dlng)<km;
  });
}

// ── Patterns SVG globaux (document.body) — survivent aux setStyle Leaflet ──────
function injectGlobalPatterns() {
  if(typeof document==="undefined"||document.getElementById("ml-patterns-svg"))return;
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("id","ml-patterns-svg");
  svg.style.cssText="position:absolute;width:0;height:0;pointer-events:none;overflow:hidden;";
  const defs=document.createElementNS("http://www.w3.org/2000/svg","defs");
  const mk=(id:string,col:string,col2?:string)=>{
    const pat=document.createElementNS("http://www.w3.org/2000/svg","pattern");
    pat.setAttribute("id",id);pat.setAttribute("patternUnits","userSpaceOnUse");
    pat.setAttribute("width","10");pat.setAttribute("height","10");
    pat.setAttribute("patternTransform","rotate(45 0 0)");
    const bg=document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("width","10");bg.setAttribute("height","10");
    bg.setAttribute("fill",col);bg.setAttribute("fill-opacity","0.22");
    const l1=document.createElementNS("http://www.w3.org/2000/svg","line");
    l1.setAttribute("x1","0");l1.setAttribute("y1","0");l1.setAttribute("x2","0");l1.setAttribute("y2","10");
    l1.setAttribute("stroke",col);l1.setAttribute("stroke-width","5");
    pat.appendChild(bg);pat.appendChild(l1);
    if(col2){
      const l2=document.createElementNS("http://www.w3.org/2000/svg","line");
      l2.setAttribute("x1","5");l2.setAttribute("y1","0");l2.setAttribute("x2","5");l2.setAttribute("y2","10");
      l2.setAttribute("stroke",col2);l2.setAttribute("stroke-width","4");
      pat.appendChild(l2);
    }
    return pat;
  };
  defs.appendChild(mk("ml-owner",C_OWNER));
  defs.appendChild(mk("ml-sale",C_SALE));
  defs.appendChild(mk("ml-both",C_OWNER,C_SALE));
  svg.appendChild(defs);
  document.body.appendChild(svg);
}
function applyPatterns(layer: any, getKey: (f:any)=>string) {
  layer.eachLayer((sub:any)=>{
    const k=getKey(sub.feature); if(!k)return;
    const el=sub.getElement?.(); if(!el)return;
    el.setAttribute("fill",`url(#${k})`);
    el.setAttribute("fill-opacity","1");
  });
}

const DEFAULT_LAYERS: LayerState = { parcelles: true, ventes: true, proprietaires: true, dpe: true };

export default function MapComponent({
  prospects, onSelect, onParcelClick,
  center, dark=true, satellite:initSat=false,
  flyToTarget, layers=DEFAULT_LAYERS,
}: Props) {
  const mapRef       = useRef<HTMLDivElement>(null);
  const mapInst      = useRef<any>(null);
  const tileRef      = useRef<any>(null);
  const parcLayerRef = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const badgesRef    = useRef<any[]>([]);
  const [searchVal, setSearchVal] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const searchTimer = useRef<any>(null);
  const deptLayerRef = useRef<any>(null);
  const commLayerRef = useRef<any>(null);
  const sectLayerRef = useRef<any>(null);
  const deptCache    = useRef<any>(null);
  const commCache    = useRef<Map<string,any>>(new Map());
  const timerRef     = useRef<any>(null);
  const prospectsRef = useRef(prospects);
  const layersRef    = useRef(layers);
  const onParcelRef  = useRef(onParcelClick);
  const prevCenter   = useRef<[number,number]>(center);
  const [ready,setReady]=useState(false);
  const [isSat,setIsSat]=useState(initSat);
  const [zoom,setZoom]=useState(6);

  useEffect(()=>{prospectsRef.current=prospects;},[prospects]);
  useEffect(()=>{layersRef.current=layers;},[layers]);
  useEffect(()=>{onParcelRef.current=onParcelClick;},[onParcelClick]);

  // ── Patterns globaux (une seule fois dès le montage) ─────────────────────
  useEffect(()=>{injectGlobalPatterns();},[]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mapRef.current||mapInst.current)return;
    document.head.appendChild(Object.assign(document.createElement("link"),{rel:"stylesheet",href:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"}));
    const scr=document.createElement("script"); scr.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    scr.onload=()=>{
      const L=(window as any).L;
      const map=L.map(mapRef.current,{center:[46.5,2.5],zoom:6,zoomControl:false,attributionControl:false});
      tileRef.current=L.tileLayer(initSat?TILE_SAT:TILE_PLAN,{maxZoom:20}).addTo(map);
      L.control.zoom({position:"bottomright"}).addTo(map);
      mapInst.current=map;
      // Clic carte → info parcelle au zoom parcel
      map.on("click",async(e:any)=>{
        if(map.getZoom()<Z_SECTION||!layersRef.current?.parcelles)return;
        const{lat,lng}=e.latlng;
        const eps=0.0003;
        const bbox=`${(lat-eps).toFixed(6)},${(lng-eps).toFixed(6)},${(lat+eps).toFixed(6)},${(lng+eps).toFixed(6)}`;
        try{
          const r=await fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${bbox}&OUTPUTFORMAT=application/json&COUNT=1`,{signal:AbortSignal.timeout(8000)});
          if(!r.ok)return;
          const d=await r.json(); const feat=d.features?.[0]; if(!feat)return;
          const coords=feat.geometry?.coordinates;
          const[clat,clng]=coords?centroidOf(coords):[lat,lng];
          const matching=nearbyProspects(clat,clng,prospectsRef.current);
          try{const b=(window as any).L.geoJSON(feat).getBounds();if(b.isValid())map.fitBounds(b,{maxZoom:19,padding:[40,40],animate:true});}catch{}
          onParcelRef.current?.({properties:feat.properties,centroid:[clat,clng],matchingProspects:matching});
        }catch{}
      });
      map.on("zoomend",()=>setZoom(map.getZoom()));
      setReady(true);
    };
    document.head.appendChild(scr);
    return()=>{if(mapInst.current){mapInst.current.remove();mapInst.current=null;}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(!ready||!mapInst.current)return;
    const L=(window as any).L;
    if(tileRef.current)tileRef.current.remove();
    tileRef.current=L.tileLayer(isSat?TILE_SAT:TILE_PLAN,{maxZoom:20}).addTo(mapInst.current);
    // Remonter le cadastre au dessus
  },[isSat,ready]);

  // ── FlyTo center / target ─────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready||!mapInst.current)return;
    const map=mapInst.current;
    const[pLat,pLng]=prevCenter.current,[nLat,nLng]=center;
    if(Math.abs(pLat-nLat)<0.001&&Math.abs(pLng-nLng)<0.001)return;
    prevCenter.current=center;
    map.once("moveend",()=>map.flyTo([nLat,nLng],13,{animate:true,duration:1.4}));
    map.flyTo([pLat,pLng],5,{animate:true,duration:0.8});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[center[0],center[1],ready]);

  useEffect(()=>{
    if(!ready||!mapInst.current||!flyToTarget)return;
    mapInst.current.flyTo([flyToTarget.lat,flyToTarget.lng],flyToTarget.zoom??17,{animate:true,duration:1.2});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[flyToTarget?.key,ready]);

  // ── Marqueurs ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!ready||!mapInst.current)return;
    const L=(window as any).L,map=mapInst.current;
    markersRef.current.forEach(m=>m.remove());markersRef.current=[];
    const visible=prospects.filter(p=>p.source==="DPE"?layers?.dpe!==false:layers?.ventes!==false);
    visible.forEach(p=>{
      if(!p.lat||!p.lng)return;
      const isDpe=p.source==="DPE";
      const cls=p.classe_dpe||"";
      const hasOwner=!!p.proprietaire_nom;
      const col=isDpe?dpeColor(cls):hasOwner?C_OWNER:C_SALE;
      const label=isDpe?(cls||"?"):p.score;
      const sz=26;
      const own=p.proprietaire_nom?`<div style="font-size:9px;color:#C4A35A;margin-top:2px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">${p.proprietaire_nom}</div>`:"";
      const icon=L.divIcon({
        className:"",
        html:`<div style="width:${sz}px;height:${sz}px;border-radius:6px;background:${col};display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?13:11}px;font-weight:800;box-shadow:0 2px 10px ${col}70,0 0 0 2px rgba(255,255,255,0.25);cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.12s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`,
        iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],
      });
      const marker=L.marker([p.lat,p.lng],{icon}).addTo(map);
      marker.bindTooltip(
        `<div style="min-width:160px;max-width:220px;font-family:-apple-system,sans-serif;">
          <div style="font-size:11px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:3px;">${p.adresse}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:2px;">${isDpe?`DPE ${cls||"?"}`:"DVF"} · Score ${p.score}</div>${own}
        </div>`,
        {direction:"top",offset:[0,-(sz/2+8)],className:"mandatly-tooltip",permanent:false,opacity:1}
      );
      marker.on("click",()=>onSelect?.(p));
      markersRef.current.push(marker);
    });
  },[ready,prospects,dark,layers?.ventes,layers?.dpe]);

  // ── Helpers signal ────────────────────────────────────────────────────────
  const hasSignal=(f:any,type:"dvf"|"dpe"|"any")=>{
    const ps=prospectsRef.current; if(!ps.length)return false;
    const nom=(f.properties?.nom||f.properties?.nom_com||"").toLowerCase();
    return ps.some(p=>{
      const m=nom?(p.ville.toLowerCase().includes(nom)||nom.includes(p.ville.toLowerCase())):false;
      if(type==="dvf")return m&&p.source!=="DPE";
      if(type==="dpe")return m&&p.source==="DPE";
      return m;
    });
  };
  const areaStyle=(f:any)=>{
    const sig=hasSignal(f,"any");
    const dvf=hasSignal(f,"dvf");
    const dpe=hasSignal(f,"dpe");
    const col=dvf?C_SALE:dpe?C_DPE:"#94A3B8";
    return{color:col,weight:sig?2:0.8,fillColor:col,fillOpacity:sig?0.15:0.04,opacity:sig?0.8:0.3};
  };

  // ── Région layer ──────────────────────────────────────────────────────────
  const renderRegions=async()=>{
    const map=mapInst.current; if(!map)return;
    const L=(window as any).L;
    if(deptLayerRef.current){deptLayerRef.current.remove();deptLayerRef.current=null;}
    try{
      const r=await fetch("https://geo.api.gouv.fr/regions?format=geojson&geometry=contour",{signal:AbortSignal.timeout(10000)});
      const data=await r.json();
      deptLayerRef.current=L.geoJSON(data,{
        style:(f:any)=>({color:"#64748B",weight:1.5,fillColor:"#64748B",fillOpacity:0.06,opacity:0.5}),
        onEachFeature:(f:any,layer:any)=>{
          const nom=f.properties?.nom||"";
          layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:12px;font-weight:700;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
          layer.on("mouseover",()=>layer.setStyle({fillOpacity:0.18,weight:2.5}));
          layer.on("mouseout",()=>layer.setStyle({fillOpacity:0.06,weight:1.5}));
          layer.on("click",()=>{
            try{map.fitBounds(layer.getBounds(),{padding:[30,30],animate:true,duration:0.8});}catch{}
          });
        },
      }).addTo(map);
    }catch{}
  };

  // ── Département layer ─────────────────────────────────────────────────────
  const renderDepts=async()=>{
    const map=mapInst.current; if(!map)return;
    const L=(window as any).L;
    if(!deptCache.current){
      try{const r=await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour",{signal:AbortSignal.timeout(10000)});deptCache.current=await r.json();}catch{return;}
    }
    if(deptLayerRef.current){deptLayerRef.current.remove();deptLayerRef.current=null;}
    deptLayerRef.current=L.geoJSON(deptCache.current,{
      style:areaStyle,
      onEachFeature:(f:any,layer:any)=>{
        const nom=f.properties?.nom||"",code=f.properties?.code||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:12px;font-weight:700;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3,fillOpacity:0.25}));
        layer.on("mouseout",()=>layer.setStyle(areaStyle(f)));
        layer.on("click",async()=>{
          try{map.fitBounds(layer.getBounds(),{padding:[30,30],animate:true,duration:0.8});}catch{}
          if(code&&!commCache.current.has(code)){
            try{const r=await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`,{signal:AbortSignal.timeout(10000)});commCache.current.set(code,await r.json());}catch{}
          }
        });
      },
    }).addTo(map);
  };

  // ── Commune layer ─────────────────────────────────────────────────────────
  const renderCommunes=async()=>{
    const map=mapInst.current; if(!map)return;
    const L=(window as any).L,b=map.getBounds();
    if(!deptCache.current){
      try{const r=await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour",{signal:AbortSignal.timeout(10000)});deptCache.current=await r.json();}catch{return;}
    }
    const codes:string[]=(deptCache.current?.features||[])
      .filter((f:any)=>{try{return L.geoJSON(f).getBounds().intersects(b);}catch{return false;}})
      .map((f:any)=>f.properties?.code).filter(Boolean).slice(0,5);
    await Promise.allSettled(codes.map(async code=>{
      if(!commCache.current.has(code)){
        try{const r=await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`,{signal:AbortSignal.timeout(10000)});commCache.current.set(code,await r.json());}catch{}
      }
    }));
    const feats:any[]=[]; for(const c of codes){const d=commCache.current.get(c);if(d?.features)feats.push(...d.features);}
    if(!feats.length)return;
    if(commLayerRef.current){commLayerRef.current.remove();commLayerRef.current=null;}
    const ps=prospectsRef.current;
    commLayerRef.current=L.geoJSON({type:"FeatureCollection",features:feats},{
      style:(f:any)=>{
        const heat=getHeatStyle(f,ps);
        if(heat)return heat;
        return areaStyle(f);
      },
      onEachFeature:(f:any,layer:any)=>{
        const nom=f.properties?.nom||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:12px;font-weight:700;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3,fillOpacity:0.28}));
        layer.on("mouseout",()=>layer.setStyle(getHeatStyle(f,ps)||areaStyle(f)));
        layer.on("click",()=>{
          try{map.fitBounds(layer.getBounds(),{padding:[30,30],animate:true,duration:0.8});}catch{}
        });
      },
    }).addTo(map);
  };

  // ── Parcelles colorées (vert=propriétaire / violet=vente / hachuré=les deux) ──
  const renderParcels=async()=>{
    const map=mapInst.current;
    if(!map||!layersRef.current?.parcelles||map.getZoom()<Z_SECTION){
      if(parcLayerRef.current){parcLayerRef.current.remove();parcLayerRef.current=null;}
      badgesRef.current.forEach(m=>m.remove());badgesRef.current=[];
      return;
    }
    const L=(window as any).L,b=map.getBounds();
    const bbox=`${b.getSouth().toFixed(6)},${b.getWest().toFixed(6)},${b.getNorth().toFixed(6)},${b.getEast().toFixed(6)}`;
    let data:any;
    try{
      const r=await fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${bbox}&OUTPUTFORMAT=application/json&COUNT=300`,{signal:AbortSignal.timeout(12000)});
      if(!r.ok)return; data=await r.json();
    }catch{return;}
    if(parcLayerRef.current){parcLayerRef.current.remove();parcLayerRef.current=null;}
    badgesRef.current.forEach(m=>m.remove());badgesRef.current=[];
    const ps=prospectsRef.current,lrs=layersRef.current;
    const patternKeys=new Map<string,string>();

    parcLayerRef.current=L.geoJSON(data,{
      style:(feature:any)=>{
        const coords=feature.geometry?.coordinates; if(!coords)return{weight:0,fillOpacity:0,opacity:0};
        const[clat,clng]=centroidOf(coords);
        const dvf=lrs?.ventes?nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE")):[];
        const dpe=lrs?.dpe?nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE")):[];
        const owned=lrs?.proprietaires!==false?nearbyProspects(clat,clng,ps.filter(p=>!!p.proprietaire_nom)):[];
        const hasOwner=owned.length>0||dvf.some(p=>p.proprietaire_nom)||dpe.some(p=>p.proprietaire_nom);
        const hasSale=dvf.length>0;
        const hasDpe=dpe.length>0;
        const key=`${feature.properties?.section}-${feature.properties?.numero}`;
        if(hasOwner&&hasSale){patternKeys.set(key,"ml-both"); return{color:"#1a1a1a",weight:1,opacity:0.5,fillColor:"transparent",fillOpacity:0};}
        if(hasOwner){patternKeys.set(key,"ml-owner"); return{color:"#1a1a1a",weight:1,opacity:0.5,fillColor:"transparent",fillOpacity:0};}
        if(hasSale){patternKeys.set(key,"ml-sale"); return{color:"#1a1a1a",weight:1,opacity:0.5,fillColor:"transparent",fillOpacity:0};}
        if(hasDpe){return{color:"#1a1a1a",weight:1,opacity:0.5,fillColor:dpeColor(dpe[0].classe_dpe||""),fillOpacity:0.25};}
        return{weight:0.6,opacity:0.3,fillOpacity:0,color:"#1a1a1a"};
      },
      onEachFeature:(feature:any,layer:any)=>{
        const coords=feature.geometry?.coordinates; if(!coords)return;
        const[clat,clng]=centroidOf(coords);
        const dvf=nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE"));
        const dpe=nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE"));
        const matching=[...dvf,...dpe]; if(!matching.length)return;
        const hasOwner=matching.some(p=>p.proprietaire_nom);
        const hasSale=dvf.length>0;
        const hasDpe=dpe.length>0;
        const{section,numero,contenance,code_insee}=feature.properties||{};
        const topOwner=matching.find(p=>p.proprietaire_nom);
        const topDpe=dpe[0];
        const topSale=dvf[0] as any;

        // Badge propriétaire (nom en or)
        if(topOwner?.proprietaire_nom){
          try{
            const nb=L.marker([clat,clng],{
              icon:L.divIcon({className:"",
                html:`<div style="background:rgba(8,8,12,0.9);color:#C4A35A;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;white-space:nowrap;border:1px solid rgba(196,163,90,0.4);font-family:-apple-system,sans-serif;pointer-events:none;">${topOwner.proprietaire_nom}</div>`,
                iconSize:[1,1],iconAnchor:[-4,-6],
              }),interactive:false,
            }).addTo(map);
            badgesRef.current.push(nb);
          }catch{}
        }

        // Badge DPE
        if(topDpe?.classe_dpe){
          try{
            const cls=topDpe.classe_dpe,col=dpeColor(cls);
            const db=L.marker([clat,clng],{
              icon:L.divIcon({className:"",
                html:`<div style="background:${col};color:white;font-size:11px;font-weight:800;width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 6px ${col}80;font-family:-apple-system,sans-serif;pointer-events:none;margin-top:12px;">${cls}</div>`,
                iconSize:[20,20],iconAnchor:[10,-2],
              }),interactive:false,
            }).addTo(map);
            badgesRef.current.push(db);
          }catch{}
        }

        // Prix DVF — bulle blanche style Pappers Immo
        if(topSale?.prix_achat>0&&lrs?.ventes){
          try{
            const prix=topSale.prix_achat;
            const parts=prix.toLocaleString("fr-FR").split(/\s/);
            const label=parts.join(" ")+" €";
            const pb=L.marker([clat,clng],{
              icon:L.divIcon({className:"",
                html:`<div style="background:rgba(255,255,255,0.96);border-radius:6px;padding:3px 9px;font-size:12px;font-weight:500;color:#1a1a1a;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.06);font-family:-apple-system,sans-serif;letter-spacing:-0.01em;">${label}</div>`,
                iconSize:[1,1],iconAnchor:[-4,10],
              }),interactive:false,
            }).addTo(map);
            badgesRef.current.push(pb);
          }catch{}
        }

        const borderCol=hasOwner&&hasSale?"linear":hasOwner?C_OWNER:hasSale?C_SALE:C_DPE;
        layer.bindTooltip(
          `<div style="font-family:-apple-system,sans-serif;min-width:180px;">
            <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:4px;">Section ${section} · N° ${numero}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-bottom:6px;">${contenance??""} m² · ${code_insee||""}</div>
            ${hasOwner?`<div style="font-size:11px;color:${C_OWNER};font-weight:700;margin-bottom:2px;">● Propriétaire : ${topOwner?.proprietaire_nom||""}</div>`:""}
            ${hasSale?`<div style="font-size:11px;color:${C_SALE};font-weight:700;margin-bottom:2px;">● Vente DVF${topSale?.prix_achat?` · ${topSale.prix_achat.toLocaleString("fr-FR")} €`:""}</div>`:""}
            ${topDpe?`<div style="font-size:11px;color:${dpeColor(topDpe.classe_dpe||"")};font-weight:700;">● DPE ${topDpe.classe_dpe||""}</div>`:""}
          </div>`,
          {className:"mandatly-tooltip",sticky:false}
        );
        layer.on("mouseover",()=>{
          const key=`${section}-${numero}`;
          if(patternKeys.has(key)){
            // Pattern parcel : ne jamais appeler setStyle (efface le fill url())
            // Juste accentuer le contour directement en SVG
            layer.getElement?.()?.setAttribute("stroke-width","3");
          } else {
            layer.setStyle({weight:2.5,fillOpacity:hasDpe?0.35:0.08});
          }
        });
        layer.on("mouseout",()=>{
          const key=`${section}-${numero}`;
          const pat=patternKeys.get(key);
          if(pat){
            layer.getElement?.()?.setAttribute("stroke-width","1");
            // Ré-appliquer le pattern au cas où il aurait été écrasé
            const el=layer.getElement?.(); if(el) el.setAttribute("fill",`url(#${pat})`);
          } else {
            layer.setStyle({weight:0.6,fillOpacity:hasDpe?0.25:0});
          }
        });
        layer.on("click",(e:any)=>{
          (window as any).L.DomEvent.stopPropagation(e);
          try{map.fitBounds(layer.getBounds(),{maxZoom:19,padding:[40,40],animate:true});}catch{}
          onParcelRef.current?.({properties:feature.properties,centroid:[clat,clng],matchingProspects:matching});
        });
      },
    }).addTo(map);
    markersRef.current.forEach(m=>m.bringToFront?.());
    badgesRef.current.forEach(m=>m.bringToFront?.());

    // Appliquer les patterns SVG (les patterns globaux sont déjà dans document.body)
    const applyAll=()=>{
      if(!parcLayerRef.current)return;
      applyPatterns(parcLayerRef.current,(f:any)=>patternKeys.get(`${f?.properties?.section}-${f?.properties?.numero}`)||"");
    };
    setTimeout(applyAll,60);
    setTimeout(applyAll,300);
    setTimeout(applyAll,700);
  };

  // ── Master refresh ────────────────────────────────────────────────────────
  const refresh=async()=>{
    const map=mapInst.current; if(!map||(window as any).L===undefined)return;
    const z=map.getZoom();
    if(z>=Z_SECTION){
      if(deptLayerRef.current){deptLayerRef.current.remove();deptLayerRef.current=null;}
      if(commLayerRef.current){commLayerRef.current.remove();commLayerRef.current=null;}
      if(sectLayerRef.current){sectLayerRef.current.remove();sectLayerRef.current=null;}
      await renderParcels();
    } else if(z>=Z_COMMUNE){
      if(deptLayerRef.current){deptLayerRef.current.remove();deptLayerRef.current=null;}
      if(parcLayerRef.current){parcLayerRef.current.remove();parcLayerRef.current=null;}
      badgesRef.current.forEach(m=>m.remove());badgesRef.current=[];
      if(sectLayerRef.current){sectLayerRef.current.remove();sectLayerRef.current=null;}
      await renderCommunes();
    } else if(z>=Z_DEPT){
      if(commLayerRef.current){commLayerRef.current.remove();commLayerRef.current=null;}
      if(parcLayerRef.current){parcLayerRef.current.remove();parcLayerRef.current=null;}
      badgesRef.current.forEach(m=>m.remove());badgesRef.current=[];
      await renderDepts();
    } else {
      if(deptLayerRef.current){deptLayerRef.current.remove();deptLayerRef.current=null;}
      if(commLayerRef.current){commLayerRef.current.remove();commLayerRef.current=null;}
      if(parcLayerRef.current){parcLayerRef.current.remove();parcLayerRef.current=null;}
      badgesRef.current.forEach(m=>m.remove());badgesRef.current=[];
      await renderRegions();
    }
  };

  useEffect(()=>{
    if(!ready||!mapInst.current)return;
    const map=mapInst.current;
    const debounced=()=>{clearTimeout(timerRef.current);timerRef.current=setTimeout(refresh,350);};
    refresh();
    map.on("moveend",debounced);map.on("zoomend",debounced);
    return()=>{map.off("moveend",debounced);map.off("zoomend",debounced);clearTimeout(timerRef.current);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready]);
  useEffect(()=>{if(!ready)return;refresh();},[layers?.ventes,layers?.dpe,layers?.parcelles,layers?.proprietaires]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!ready)return;
    clearTimeout(timerRef.current);timerRef.current=setTimeout(refresh,300);
  },[ready,prospects]); // eslint-disable-line react-hooks/exhaustive-deps

  const googleUrl=`https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;

  return(
    <>
      <style>{`
        .leaflet-container{font-family:-apple-system,sans-serif;}
        .mandatly-tooltip{background:rgba(8,10,18,0.97)!important;border:1px solid rgba(196,163,90,0.25)!important;border-radius:8px!important;box-shadow:0 4px 24px rgba(0,0,0,0.6)!important;padding:9px 13px!important;color:#fff;}
        .mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}
      `}</style>
      <div style={{position:"relative",width:"100%",height:"100%"}}>
        <div ref={mapRef} style={{width:"100%",height:"100%"}}/>

        {/* Barre de recherche style Pappers — en haut au centre */}
        <div style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",zIndex:1000,width:"min(520px,calc(100% - 200px))"}}>
          <div style={{position:"relative"}}>
            <svg style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"#3B82F6",pointerEvents:"none"}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              value={searchVal}
              onChange={e=>{
                const v=e.target.value; setSearchVal(v);
                clearTimeout(searchTimer.current);
                if(v.length<2){setSearchResults([]);return;}
                searchTimer.current=setTimeout(async()=>{
                  try{
                    const r=await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(v)}&limit=5`);
                    const d=await r.json();
                    setSearchResults(d.features||[]);
                  }catch{setSearchResults([]);}
                },300);
              }}
              onKeyDown={e=>{if(e.key==="Escape"){setSearchVal("");setSearchResults([]);}}}
              placeholder="Rechercher une adresse, une commune, une parcelle"
              style={{width:"100%",padding:"11px 14px 11px 40px",borderRadius:10,border:"none",background:"#fff",boxShadow:"0 2px 16px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.06)",fontSize:14,color:"#1a1a1a",outline:"none",boxSizing:"border-box",fontFamily:"-apple-system,sans-serif"}}
            />
          </div>
          {searchResults.length>0&&(
            <div style={{marginTop:4,background:"#fff",borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.06)",overflow:"hidden"}}>
              {searchResults.map((f:any,i:number)=>(
                <div key={i} onClick={()=>{
                  const[lng,lat]=f.geometry.coordinates;
                  mapInst.current?.flyTo([lat,lng],16,{animate:true,duration:1.2});
                  setSearchVal(f.properties.label);
                  setSearchResults([]);
                }} style={{padding:"9px 14px",cursor:"pointer",fontSize:13,color:"#1a1a1a",borderBottom:i<searchResults.length-1?"1px solid #f0f0f0":"none",fontFamily:"-apple-system,sans-serif"}}
                  onMouseOver={e=>(e.currentTarget.style.background="#f5f7ff")}
                  onMouseOut={e=>(e.currentTarget.style.background="transparent")}>
                  <span style={{fontWeight:500}}>{f.properties.name}</span>
                  <span style={{color:"#888",marginLeft:6,fontSize:12}}>{f.properties.context}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contrôles Plan/Satellite + Vue 3D */}
        <div style={{position:"absolute",top:12,left:12,zIndex:1000,display:"flex",gap:6}}>
          <div style={{display:"flex",background:"rgba(8,10,18,0.9)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:3,gap:2,backdropFilter:"blur(10px)"}}>
            {([["Plan",false],["Satellite",true]] as [string,boolean][]).map(([lbl,sat])=>(
              <button key={lbl} onClick={()=>setIsSat(sat)} style={{padding:"4px 12px",borderRadius:5,border:"none",background:isSat===sat?"rgba(255,255,255,0.16)":"transparent",color:isSat===sat?"#fff":"rgba(255,255,255,0.45)",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{lbl}</button>
            ))}
          </div>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{padding:"4px 12px",background:"rgba(8,10,18,0.9)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"rgba(255,255,255,0.6)",fontSize:11,fontWeight:600,textDecoration:"none",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",gap:4}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Vue 3D
          </a>
        </div>

        {/* Indicateur niveau */}
        <div style={{position:"absolute",bottom:40,right:48,zIndex:1000,background:"rgba(8,10,18,0.78)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"rgba(255,255,255,0.45)",fontWeight:700,backdropFilter:"blur(6px)",letterSpacing:"0.07em"}}>
          {zoom<Z_DEPT?"RÉGIONS":zoom<Z_COMMUNE?"DÉPARTEMENTS":zoom<Z_SECTION?"COMMUNES":"PARCELLES"}
        </div>

        {/* Légende */}
        <div style={{position:"absolute",bottom:40,left:12,zIndex:1000,background:"rgba(8,10,18,0.93)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 14px",backdropFilter:"blur(10px)"}}>
          {zoom<Z_SECTION?(
            <>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:7}}>Prix médian/m²</div>
              <div style={{width:88,height:7,borderRadius:3,background:"linear-gradient(to right,#4ADE80,#FDE047,#FB923C,#EF4444)",marginBottom:4}}/>
              <div style={{display:"flex",justifyContent:"space-between",width:88}}>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.4)"}}>1 500 €</span>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.4)"}}>11 000 €</span>
              </div>
            </>
          ):(
            <>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>Légende parcelles</div>
              {([
                [C_OWNER,"Propriétaire identifié","ml-owner"],
                [C_SALE,"Vente DVF","ml-sale"],
              ] as [string,string,string][]).map(([col,lbl,pat])=>(
                <div key={lbl} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <svg width="22" height="14" viewBox="0 0 22 14">
                    <defs>
                      <pattern id={`leg-${pat}`} patternUnits="userSpaceOnUse" width={pat==="ml-both"?"12":"8"} height={pat==="ml-both"?"12":"8"}>
                        <rect width="20" height="20" fill={col} opacity="0.18"/>
                        <path d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" stroke={col} strokeWidth="2"/>
                        {pat==="ml-both"&&<path d="M2,-2 l-4,4 M12,0 l-12,12 M14,10 l-4,4" stroke={C_SALE} strokeWidth="1.8" opacity="0.8"/>}
                      </pattern>
                    </defs>
                    <rect width="22" height="14" fill={`url(#leg-${pat})`} rx="3"/>
                    <rect width="22" height="14" fill="none" stroke={col} strokeWidth="1.5" rx="3"/>
                  </svg>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.7)",fontWeight:500}}>{lbl}</span>
                </div>
              ))}
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                <svg width="22" height="14" viewBox="0 0 22 14">
                  <defs>
                    <pattern id="leg-both" patternUnits="userSpaceOnUse" width="12" height="12">
                      <rect width="12" height="12" fill={C_OWNER} opacity="0.12"/>
                      <path d="M-2,2 l4,-4 M0,12 l12,-12 M10,14 l4,-4" stroke={C_OWNER} strokeWidth="2.5"/>
                      <path d="M2,-2 l-4,4 M12,0 l-12,12 M14,10 l-4,4" stroke={C_SALE} strokeWidth="2" opacity="0.8"/>
                    </pattern>
                  </defs>
                  <rect width="22" height="14" fill="url(#leg-both)" rx="3"/>
                  <rect width="22" height="14" fill="none" stroke={C_OWNER} strokeWidth="1.5" rx="3"/>
                </svg>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.7)",fontWeight:500}}>Propriétaire + Vente</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
