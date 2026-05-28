"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: any; adresse: string; ville: string; score: number;
  source: string; notes: string; lat: number; lng: number;
  proprietaire_nom?: string; classe_dpe?: string;
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

const TILE_DARK     = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_LIGHT    = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_SAT      = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// IGN Géoplateforme – grille cadastrale (gratuit, sans clé)
const TILE_CADASTRE = "https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image%2Fpng&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const Z_COMMUNE = 9;
const Z_PARCEL  = 14;   // seuil parcelles

const C_DVF  = "#7C3AED";
const C_DPE  = "#10B981";
const C_NONE = "#94A3B8";

// ── Support MultiPolygon IGN ──────────────────────────────────────────────
function isMultiPoly(coords: any): boolean {
  return Array.isArray(coords?.[0]?.[0]?.[0]);
}
function centroidOf(coords: any): [number, number] {
  const polys: number[][][][] = isMultiPoly(coords) ? coords : [coords];
  const ring = polys[0][0];
  return [
    ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length,
    ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length,
  ];
}
// Matching par distance (120 m) — les coords DVF/DPE sont géocodées à la rue
function nearbyProspects(clat: number, clng: number, prospects: Prospect[], km = 0.12): Prospect[] {
  return prospects.filter(p => {
    if (!p.lat || !p.lng) return false;
    const dlat = (p.lat - clat) * 111;
    const dlng = (p.lng - clng) * 111 * Math.cos(clat * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng) < km;
  });
}

// ── SVG hatch pour dept/commune ───────────────────────────────────────────
function injectPatterns(map: any) {
  const svgEl = map.getPane?.("overlayPane")?.querySelector("svg");
  if (!svgEl || svgEl.querySelector("#ml-hv")) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const make = (id: string, col: string) => {
    const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pat.setAttribute("id", id); pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "8"); pat.setAttribute("height", "8");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width","8"); bg.setAttribute("height","8"); bg.setAttribute("fill",col); bg.setAttribute("opacity","0.09");
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ln.setAttribute("d","M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2"); ln.setAttribute("stroke",col); ln.setAttribute("stroke-width","1.8");
    pat.appendChild(bg); pat.appendChild(ln); return pat;
  };
  defs.appendChild(make("ml-hv", C_DVF));
  defs.appendChild(make("ml-hg", C_DPE));
  defs.appendChild(make("ml-hn", C_NONE));
  svgEl.insertBefore(defs, svgEl.firstChild);
}
function applyFill(layer: any, getPatId: (f: any) => string) {
  layer.eachLayer((sub: any) => {
    const el = sub.getElement?.(); if (!el) return;
    el.setAttribute("fill", `url(#${getPatId(sub.feature)})`);
    el.setAttribute("fill-opacity", "1");
  });
}

export default function MapComponent({
  prospects, onSelect, onParcelClick,
  center, dark = true, satellite: initSat = false,
  flyToTarget, layers,
}: Props) {
  const mapRef       = useRef<HTMLDivElement>(null);
  const mapInst      = useRef<any>(null);
  const tileRef      = useRef<any>(null);
  const cadastreRef  = useRef<any>(null); // tuiles IGN
  const parcLayerRef = useRef<any>(null); // GeoJSON fills colorés
  const markersRef   = useRef<any[]>([]);
  const deptLayerRef = useRef<any>(null);
  const commLayerRef = useRef<any>(null);
  const deptCache    = useRef<any>(null);
  const commCache    = useRef<Map<string,any>>(new Map());
  const timerRef     = useRef<any>(null);
  const prospectsRef = useRef(prospects);
  const layersRef    = useRef(layers);
  const onParcelRef  = useRef(onParcelClick);
  const prevCenter   = useRef<[number,number]>(center);
  const [ready, setReady]  = useState(false);
  const [isSat, setIsSat]  = useState(initSat);
  const [zoom,  setZoom]   = useState(6);

  useEffect(() => { prospectsRef.current = prospects; }, [prospects]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { onParcelRef.current = onParcelClick; }, [onParcelClick]);

  // ── Init Leaflet ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    document.head.appendChild(Object.assign(document.createElement("link"), { rel:"stylesheet", href:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" }));
    const scr = document.createElement("script");
    scr.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    scr.onload = () => {
      const L = (window as any).L;
      const map = L.map(mapRef.current, { center:[44.837,-0.579], zoom:6, zoomControl:false, attributionControl:false });
      tileRef.current = L.tileLayer(initSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT), { maxZoom:19 }).addTo(map);
      L.control.zoom({ position:"bottomright" }).addTo(map);
      mapInst.current = map;
      // Clic carte → info parcelle (quand pas de GeoJSON signal à cet endroit)
      map.on("click", async (e: any) => {
        if (map.getZoom() < Z_PARCEL || !layersRef.current?.parcelles) return;
        const { lat, lng } = e.latlng;
        const eps = 0.0003;
        const bbox = `${(lng-eps).toFixed(6)},${(lat-eps).toFixed(6)},${(lng+eps).toFixed(6)},${(lat+eps).toFixed(6)}`;
        try {
          const r = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?bbox=${bbox}&_limit=1`, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return;
          const data = await r.json();
          const feat = data.features?.[0]; if (!feat) return;
          const coords = feat.geometry?.coordinates;
          const [clat, clng] = coords ? centroidOf(coords) : [lat, lng];
          const matching = nearbyProspects(clat, clng, prospectsRef.current);
          onParcelRef.current?.({ properties: feat.properties, centroid:[clat,clng], matchingProspects: matching });
        } catch {}
      });
      map.on("zoomend", () => setZoom(map.getZoom()));
      setReady(true);
    };
    document.head.appendChild(scr);
    return () => { if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Basemap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(isSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT), { maxZoom:19 }).addTo(mapInst.current);
  }, [isSat, dark, ready]);

  // ── Tuiles cadastre IGN (grille fond) ─────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L;
    const shouldShow = layers?.parcelles && zoom >= Z_PARCEL;
    if (shouldShow && !cadastreRef.current) {
      cadastreRef.current = L.tileLayer(TILE_CADASTRE, { opacity:0.65, maxZoom:20 }).addTo(mapInst.current);
      markersRef.current.forEach(m => m.bringToFront?.());
    } else if (!shouldShow && cadastreRef.current) {
      cadastreRef.current.remove(); cadastreRef.current = null;
    }
  }, [ready, layers?.parcelles, zoom]);

  // ── FlyTo center ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const map = mapInst.current;
    const [pLat,pLng] = prevCenter.current, [nLat,nLng] = center;
    if (Math.abs(pLat-nLat)<0.001 && Math.abs(pLng-nLng)<0.001) return;
    prevCenter.current = center;
    map.once("moveend", () => map.flyTo([nLat,nLng], 13, { animate:true, duration:1.4 }));
    map.flyTo([pLat,pLng], 5, { animate:true, duration:0.8 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], ready]);

  // ── FlyToTarget ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current || !flyToTarget) return;
    mapInst.current.flyTo([flyToTarget.lat,flyToTarget.lng], flyToTarget.zoom??17, { animate:true, duration:1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.key, ready]);

  // ── Marqueurs prospects ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L, map = mapInst.current;
    markersRef.current.forEach(m => m.remove()); markersRef.current = [];
    const visible = prospects.filter(p => p.source==="DPE" ? layers?.dpe!==false : layers?.ventes!==false);
    visible.forEach(p => {
      if (!p.lat||!p.lng) return;
      const isDpe = p.source==="DPE";
      let col:string, sz:number, label:string|number;
      if (isDpe) {
        const cls = p.classe_dpe||"";
        col = cls==="G"?"#EF4444":cls==="F"?"#F97316":cls==="E"?"#F59E0B":cls==="D"?"#6B7280":"#10B981";
        sz=cls==="G"?38:cls==="F"?36:cls==="E"?32:28; label=cls||p.score;
      } else {
        col=p.score>=85?"#10B981":p.score>=70?"#F59E0B":p.score>=50?"#EF4444":"#6B7280";
        sz=p.score>=85?36:p.score>=70?32:28; label=p.score;
      }
      const own = p.proprietaire_nom?`<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${p.proprietaire_nom}</div>`:"";
      const icon = L.divIcon({ className:"", html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?12:11}px;font-weight:700;box-shadow:0 2px 12px ${col}60;cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`, iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
      const marker = L.marker([p.lat,p.lng],{icon}).addTo(map);
      marker.bindTooltip(`<div style="min-width:150px;max-width:210px;font-family:-apple-system,sans-serif;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:2px;line-height:1.35;">${p.adresse}</div><div style="font-size:10px;color:#888;">${isDpe?"DPE":"DVF"} · Score ${p.score}</div>${own}</div>`,
        { direction:"top", offset:[0,-(sz/2+6)], className:"mandatly-tooltip", permanent:false, opacity:1 });
      marker.on("click", () => onSelect?.(p));
      markersRef.current.push(marker);
    });
  }, [ready, prospects, dark, layers?.ventes, layers?.dpe]);

  // ── Helpers dept/commune ──────────────────────────────────────────────────
  const hasSignal = (f: any, type: "dvf"|"dpe"|"any") => {
    const ps = prospectsRef.current; if (!ps.length) return false;
    const nom = (f.properties?.nom||f.properties?.nom_com||"").toLowerCase();
    return ps.some(p => {
      const m = nom ? p.ville.toLowerCase().includes(nom)||nom.includes(p.ville.toLowerCase()) : false;
      if (type==="dvf") return m&&p.source!=="DPE";
      if (type==="dpe") return m&&p.source==="DPE";
      return m;
    });
  };
  const patternId = (f: any) => { const dvf=layersRef.current?.ventes!==false&&hasSignal(f,"dvf"); const dpe=layersRef.current?.dpe!==false&&hasSignal(f,"dpe"); return dvf?"ml-hv":dpe?"ml-hg":"ml-hn"; };
  const strokeCol = (f: any) => { const dvf=layersRef.current?.ventes!==false&&hasSignal(f,"dvf"); const dpe=layersRef.current?.dpe!==false&&hasSignal(f,"dpe"); return dvf?C_DVF:dpe?C_DPE:C_NONE; };
  const geoStyle  = (f: any) => ({ color:strokeCol(f), weight:hasSignal(f,"any")?2:1, fillOpacity:0, opacity:hasSignal(f,"any")?0.85:0.3 });

  // ── Département layer ─────────────────────────────────────────────────────
  const renderDepts = async () => {
    const map=mapInst.current; if (!map) return;
    const L=(window as any).L;
    if (!deptCache.current) {
      try { const r=await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour",{signal:AbortSignal.timeout(10000)}); deptCache.current=await r.json(); } catch { return; }
    }
    if (deptLayerRef.current) { deptLayerRef.current.remove(); deptLayerRef.current=null; }
    deptLayerRef.current = L.geoJSON(deptCache.current, {
      style: geoStyle,
      onEachFeature: (feature:any, layer:any) => {
        const nom=feature.properties?.nom||"", code=feature.properties?.code||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3}));
        layer.on("mouseout",()=>layer.setStyle({weight:hasSignal(feature,"any")?2:1}));
        layer.on("click",async()=>{
          map.fitBounds(layer.getBounds(),{padding:[20,20]});
          if (!commCache.current.has(code)) {
            try { const r=await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`,{signal:AbortSignal.timeout(10000)}); commCache.current.set(code,await r.json()); } catch {}
          }
        });
      },
    }).addTo(map);
    injectPatterns(map);
    setTimeout(()=>{ if(deptLayerRef.current) applyFill(deptLayerRef.current,patternId); },80);
  };

  // ── Commune layer ─────────────────────────────────────────────────────────
  const renderCommunes = async () => {
    const map=mapInst.current; if (!map) return;
    const L=(window as any).L, b=map.getBounds();
    if (!deptCache.current) {
      try { const r=await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour",{signal:AbortSignal.timeout(10000)}); deptCache.current=await r.json(); } catch { return; }
    }
    const codes:string[]=(deptCache.current?.features||[])
      .filter((f:any)=>{ try{return L.geoJSON(f).getBounds().intersects(b);}catch{return false;} })
      .map((f:any)=>f.properties?.code).filter(Boolean).slice(0,4);
    await Promise.allSettled(codes.map(async code=>{
      if (!commCache.current.has(code)) {
        try { const r=await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`,{signal:AbortSignal.timeout(10000)}); commCache.current.set(code,await r.json()); } catch {}
      }
    }));
    const feats:any[]=[]; for (const c of codes) { const d=commCache.current.get(c); if(d?.features) feats.push(...d.features); }
    if (!feats.length) return;
    if (commLayerRef.current) { commLayerRef.current.remove(); commLayerRef.current=null; }
    commLayerRef.current = L.geoJSON({type:"FeatureCollection",features:feats},{
      style: geoStyle,
      onEachFeature:(feature:any,layer:any)=>{
        const nom=feature.properties?.nom||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3}));
        layer.on("mouseout",()=>layer.setStyle({weight:hasSignal(feature,"any")?2:1}));
        layer.on("click",()=>map.fitBounds(layer.getBounds(),{padding:[20,20]}));
      },
    }).addTo(map);
    injectPatterns(map);
    setTimeout(()=>{ if(commLayerRef.current) applyFill(commLayerRef.current,patternId); },80);
  };

  // ── GeoJSON parcelles colorées (zoom ≥ 14) ────────────────────────────────
  const renderParcels = async () => {
    const map=mapInst.current;
    if (!map || !layersRef.current?.parcelles || map.getZoom()<Z_PARCEL) {
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
      return;
    }
    const L=(window as any).L;
    const b=map.getBounds();
    const bbox=`${b.getWest().toFixed(6)},${b.getSouth().toFixed(6)},${b.getEast().toFixed(6)},${b.getNorth().toFixed(6)}`;
    let data:any;
    try {
      const r=await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?bbox=${bbox}&_limit=200`,{signal:AbortSignal.timeout(8000)});
      if (!r.ok) return;
      data=await r.json();
    } catch { return; }
    if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
    const ps=prospectsRef.current, lrs=layersRef.current;

    parcLayerRef.current = L.geoJSON(data, {
      style: (feature:any) => {
        const coords=feature.geometry?.coordinates;
        if (!coords) return {weight:0,fillOpacity:0,opacity:0};
        const [clat,clng]=centroidOf(coords);
        const dvf=lrs?.ventes ? nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE")) : [];
        const dpe=lrs?.dpe   ? nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE"))  : [];
        const hasSig=dvf.length>0||dpe.length>0;
        if (!hasSig) return {weight:0,fillOpacity:0,opacity:0}; // non-signal : tuile raster suffit
        const col=dvf.length?C_DVF:C_DPE;
        return {color:col,weight:2.5,opacity:1,fillColor:col,fillOpacity:0.28};
      },
      onEachFeature:(feature:any,layer:any)=>{
        const coords=feature.geometry?.coordinates;
        if (!coords) return;
        const [clat,clng]=centroidOf(coords);
        const dvf=nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE"));
        const dpe=nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE"));
        const matching=[...dvf,...dpe];
        if (!matching.length) return; // pas d'interaction sur parcelle sans signal
        const col=dvf.length?C_DVF:C_DPE;
        const {section,numero,contenance,code_insee}=feature.properties||{};
        layer.bindTooltip(
          `<div style="font-family:-apple-system,sans-serif;min-width:170px;">
            <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:3px;">Section ${section} · ${numero}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.45);">${contenance??""} m² · ${code_insee||""}</div>
            <div style="font-size:10px;color:${col};margin-top:3px;font-weight:600;">${dvf.length?"Signal DVF":"Signal DPE"} · ${matching.length} bien(s)</div>
          </div>`,
          {className:"mandatly-tooltip",sticky:false}
        );
        layer.on("mouseover",()=>layer.setStyle({weight:4,fillOpacity:0.42}));
        layer.on("mouseout",()=>layer.setStyle({weight:2.5,fillOpacity:0.28}));
        layer.on("click",(e:any)=>{
          (window as any).L.DomEvent.stopPropagation(e);
          onParcelRef.current?.({properties:feature.properties,centroid:[clat,clng],matchingProspects:matching});
        });
      },
    }).addTo(map);
    markersRef.current.forEach(m=>m.bringToFront?.());
  };

  // ── Master refresh ────────────────────────────────────────────────────────
  const refresh = async () => {
    const map=mapInst.current; if (!map||(window as any).L===undefined) return;
    const z=map.getZoom();
    if (z>=Z_PARCEL) {
      if (deptLayerRef.current) { deptLayerRef.current.remove(); deptLayerRef.current=null; }
      if (commLayerRef.current) { commLayerRef.current.remove(); commLayerRef.current=null; }
      await renderParcels();
    } else if (z>=Z_COMMUNE) {
      if (deptLayerRef.current) { deptLayerRef.current.remove(); deptLayerRef.current=null; }
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
      await renderCommunes();
    } else {
      if (commLayerRef.current) { commLayerRef.current.remove(); commLayerRef.current=null; }
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
      await renderDepts();
    }
  };

  useEffect(()=>{
    if (!ready||!mapInst.current) return;
    const map=mapInst.current;
    const debounced=()=>{ clearTimeout(timerRef.current); timerRef.current=setTimeout(refresh,400); };
    refresh();
    map.on("moveend",debounced); map.on("zoomend",debounced);
    return ()=>{ map.off("moveend",debounced); map.off("zoomend",debounced); clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready]);

  useEffect(()=>{ if(!ready)return; refresh(); },[layers?.ventes,layers?.dpe,layers?.parcelles]); // eslint-disable-line react-hooks/exhaustive-deps

  const googleUrl=`https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;

  return (
    <>
      <style>{`
        .leaflet-container{font-family:-apple-system,sans-serif;}
        .mandatly-tooltip{background:rgba(10,16,28,0.96)!important;border:1px solid rgba(196,163,90,0.3)!important;border-radius:8px!important;box-shadow:0 4px 20px rgba(0,0,0,0.5)!important;padding:8px 12px!important;color:#fff;}
        .mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}
        .leaflet-popup-tip-container{display:none!important;}
      `}</style>
      <div style={{position:"relative",width:"100%",height:"100%"}}>
        <div ref={mapRef} style={{width:"100%",height:"100%"}}/>

        <div style={{position:"absolute",top:12,left:12,zIndex:1000,display:"flex",gap:6}}>
          <div style={{display:"flex",background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:3,gap:2,backdropFilter:"blur(8px)"}}>
            {([["Plan",false],["Satellite",true]] as [string,boolean][]).map(([lbl,sat])=>(
              <button key={lbl} onClick={()=>setIsSat(sat)} style={{padding:"4px 10px",borderRadius:5,border:"none",background:isSat===sat?"rgba(255,255,255,0.15)":"transparent",color:isSat===sat?"#fff":"rgba(255,255,255,0.5)",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{lbl}</button>
            ))}
          </div>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{padding:"4px 10px",background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:600,textDecoration:"none",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:4}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Vue 3D
          </a>
        </div>

        <div style={{position:"absolute",bottom:40,right:48,zIndex:1000,background:"rgba(10,16,28,0.75)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:600,backdropFilter:"blur(6px)",letterSpacing:"0.05em"}}>
          {zoom<Z_COMMUNE?"DÉPARTEMENTS":zoom<Z_PARCEL?"COMMUNES":"PARCELLES"}
        </div>

        <div style={{position:"absolute",bottom:40,left:12,zIndex:1000,background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 12px",backdropFilter:"blur(8px)"}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6}}>Légende</div>
          {([[C_DVF,"Ventes DVF"],[C_DPE,"DPE récents"],[C_NONE,"Sans données"]] as [string,string][]).map(([col,lbl])=>(
            <div key={lbl} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
              <svg width="16" height="10" viewBox="0 0 16 10">
                <rect width="16" height="10" fill={col} opacity="0.28" rx="1"/>
                <rect width="16" height="10" fill="none" stroke={col} strokeWidth="1.5" rx="1"/>
              </svg>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.7)",fontWeight:500}}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
