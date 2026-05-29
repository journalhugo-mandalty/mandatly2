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

// IGN Géoplateforme — fonds officiels français (gratuits, sans clé)
const TILE_PLAN     = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image%2Fpng&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
const TILE_SAT      = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image%2Fjpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";
const TILE_CADASTRE = "https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image%2Fpng&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const Z_COMMUNE = 9;
const Z_PARCEL  = 14;
const C_DVF     = "#7C3AED";
const C_NONE    = "#475569";

// ── Couleurs DPE (style Pappers Immo) ─────────────────────────────────────────
function dpeColor(cls: string): string {
  switch ((cls || "").toUpperCase()) {
    case "A": return "#059669";
    case "B": return "#10B981";
    case "C": return "#84CC16";
    case "D": return "#EAB308";
    case "E": return "#F97316";
    case "F": return "#EF4444";
    case "G": return "#B91C1C";
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
  if (!nom || nom.length<2) return null;
  const dvfPs = prospects.filter((p:any)=>p.source!=="DPE"&&p.prix_achat&&p.surface);
  if (!dvfPs.length) return null;
  const match = dvfPs.filter((p:any)=>{
    const v = normStr(p.ville||"");
    return v && (nom===v||nom.startsWith(v)||v.startsWith(nom)||nom.includes(v)||v.includes(nom));
  });
  if (match.length<2) return null;
  const prices=match.map((p:any)=>p.prix_achat/p.surface).sort((a:number,b:number)=>a-b);
  const median=prices[Math.floor(prices.length/2)];
  return {fillColor:heatColor(median),fillOpacity:0.5,color:"#94A3B8",weight:1,opacity:0.5};
}

function isMultiPoly(coords: any): boolean { return Array.isArray(coords?.[0]?.[0]?.[0]); }
function centroidOf(coords: any): [number, number] {
  const polys: number[][][][] = isMultiPoly(coords) ? coords : [coords];
  const ring = polys[0][0];
  return [
    ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length,
    ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length,
  ];
}
function nearbyProspects(clat: number, clng: number, prospects: Prospect[], km = 0.18): Prospect[] {
  return prospects.filter(p => {
    if (!p.lat || !p.lng) return false;
    const dlat = (p.lat - clat) * 111;
    const dlng = (p.lng - clng) * 111 * Math.cos(clat * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng) < km;
  });
}

function injectPatterns(map: any) {
  const pane = map.getPane?.("overlayPane"); if (!pane) return;
  const svgEl = pane.querySelector("svg"); if (!svgEl) return;
  if (svgEl.querySelector("#ml-hv")) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const make = (id: string, col: string) => {
    const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pat.setAttribute("id", id); pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "8"); pat.setAttribute("height", "8");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width","8"); bg.setAttribute("height","8"); bg.setAttribute("fill",col); bg.setAttribute("opacity","0.1");
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ln.setAttribute("d","M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2"); ln.setAttribute("stroke",col); ln.setAttribute("stroke-width","1.8");
    pat.appendChild(bg); pat.appendChild(ln); return pat;
  };
  defs.appendChild(make("ml-hv", C_DVF));
  svgEl.insertBefore(defs, svgEl.firstChild);
}

export default function MapComponent({
  prospects, onSelect, onParcelClick,
  center, dark = true, satellite: initSat = false,
  flyToTarget, layers,
}: Props) {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInst       = useRef<any>(null);
  const tileRef       = useRef<any>(null);
  const cadastreRef   = useRef<any>(null);
  const parcLayerRef  = useRef<any>(null);
  const markersRef    = useRef<any[]>([]);
  const badgesRef     = useRef<any[]>([]);
  const deptLayerRef  = useRef<any>(null);
  const commLayerRef  = useRef<any>(null);
  const deptCache     = useRef<any>(null);
  const commCache     = useRef<Map<string,any>>(new Map());
  const timerRef      = useRef<any>(null);
  const prospectsRef  = useRef(prospects);
  const layersRef     = useRef(layers);
  const onParcelRef   = useRef(onParcelClick);
  const prevCenter    = useRef<[number,number]>(center);
  const [ready, setReady] = useState(false);
  const [isSat, setIsSat] = useState(initSat);
  const [zoom, setZoom]   = useState(6);

  useEffect(() => { prospectsRef.current = prospects; }, [prospects]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { onParcelRef.current = onParcelClick; }, [onParcelClick]);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    document.head.appendChild(Object.assign(document.createElement("link"), { rel:"stylesheet", href:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" }));
    const scr = document.createElement("script");
    scr.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    scr.onload = () => {
      const L = (window as any).L;
      const map = L.map(mapRef.current, { center:[44.837,-0.579], zoom:6, zoomControl:false, attributionControl:false });
      tileRef.current = L.tileLayer(initSat ? TILE_SAT : TILE_PLAN, { maxZoom:19 }).addTo(map);
      L.control.zoom({ position:"bottomright" }).addTo(map);
      mapInst.current = map;
      map.on("click", async (e: any) => {
        if (map.getZoom() < Z_PARCEL || !layersRef.current?.parcelles) return;
        const { lat, lng } = e.latlng;
        const eps = 0.0003;
        const bbox = `${(lat-eps).toFixed(6)},${(lng-eps).toFixed(6)},${(lat+eps).toFixed(6)},${(lng+eps).toFixed(6)}`;
        try {
          const r = await fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${bbox}&OUTPUTFORMAT=application/json&COUNT=1`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return;
          const data = await r.json();
          const feat = data.features?.[0]; if (!feat) return;
          const coords = feat.geometry?.coordinates;
          const [clat, clng] = coords ? centroidOf(coords) : [lat, lng];
          const matching = nearbyProspects(clat, clng, prospectsRef.current);
          try { const bounds = (window as any).L.geoJSON(feat).getBounds(); if (bounds.isValid()) map.fitBounds(bounds, {maxZoom:19, padding:[50,50], animate:true}); } catch {}
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

  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(isSat ? TILE_SAT : TILE_PLAN, { maxZoom:19 }).addTo(mapInst.current);
  }, [isSat, ready]);

  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L;
    const shouldShow = layers?.parcelles && zoom >= Z_PARCEL;
    if (shouldShow && !cadastreRef.current) {
      cadastreRef.current = L.tileLayer(TILE_CADASTRE, { opacity: isSat ? 0.55 : 0.7, maxZoom:20 }).addTo(mapInst.current);
      markersRef.current.forEach(m => m.bringToFront?.());
    } else if (!shouldShow && cadastreRef.current) {
      cadastreRef.current.remove(); cadastreRef.current = null;
    }
  }, [ready, layers?.parcelles, zoom]);

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

  useEffect(() => {
    if (!ready || !mapInst.current || !flyToTarget) return;
    mapInst.current.flyTo([flyToTarget.lat,flyToTarget.lng], flyToTarget.zoom??17, { animate:true, duration:1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.key, ready]);

  // ── Marqueurs prospects (style Pappers : carré DPE + nom propriétaire) ─────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L, map = mapInst.current;
    markersRef.current.forEach(m => m.remove()); markersRef.current = [];
    const visible = prospects.filter(p => p.source==="DPE" ? layers?.dpe!==false : layers?.ventes!==false);
    visible.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isDpe = p.source === "DPE";
      const cls = p.classe_dpe || "";
      const col = isDpe ? dpeColor(cls) : (p.score>=85?"#10B981":p.score>=70?"#F59E0B":"#EF4444");
      const label = isDpe ? (cls || "?") : p.score;
      const sz = isDpe ? (cls==="G"||cls==="F" ? 28 : 24) : 26;
      const own = p.proprietaire_nom
        ? `<div style="font-size:9px;color:#C4A35A;margin-top:2px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${p.proprietaire_nom}</div>`
        : "";
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${sz}px;height:${sz}px;border-radius:6px;background:${col};display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?13:11}px;font-weight:800;box-shadow:0 2px 10px ${col}70,0 0 0 2px rgba(255,255,255,0.2);cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.12s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`,
        iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.bindTooltip(
        `<div style="min-width:160px;max-width:220px;font-family:-apple-system,sans-serif;">
          <div style="font-size:11px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:3px;">${p.adresse}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:2px;">${isDpe?`DPE ${cls||"?"}`:"DVF"} · Score ${p.score}</div>
          ${own}
        </div>`,
        { direction:"top", offset:[0,-(sz/2+8)], className:"mandatly-tooltip", permanent:false, opacity:1 }
      );
      marker.on("click", () => onSelect?.(p));
      markersRef.current.push(marker);
    });
  }, [ready, prospects, dark, layers?.ventes, layers?.dpe]);

  // ── Helpers ───────────────────────────────────────────────────────────────
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
  const deptSignalColor = (f: any) => {
    const ps = prospectsRef.current;
    const nom = (f.properties?.nom||f.properties?.nom_com||"").toLowerCase();
    const dpePros = ps.filter(p => p.source==="DPE" && (p.ville.toLowerCase().includes(nom)||nom.includes(p.ville.toLowerCase())));
    if (dpePros.length > 0) {
      const cls = dpePros.find(p=>p.classe_dpe==="G")?.classe_dpe || dpePros.find(p=>p.classe_dpe==="F")?.classe_dpe || dpePros[0].classe_dpe || "";
      return dpeColor(cls);
    }
    if (hasSignal(f,"dvf")) return C_DVF;
    return C_NONE;
  };
  const geoStyle = (f: any) => {
    const col = deptSignalColor(f);
    const sig = hasSignal(f,"any");
    return { color: col, weight: sig?2:1, fillOpacity: sig?0.12:0.04, fillColor: col, opacity: sig?0.8:0.25 };
  };

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
        const nom=feature.properties?.nom||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3,fillOpacity:0.2}));
        layer.on("mouseout",()=>layer.setStyle(geoStyle(feature)));
        layer.on("click",async()=>{
          map.fitBounds(layer.getBounds(),{padding:[20,20]});
          const code=feature.properties?.code||"";
          if (code && !commCache.current.has(code)) {
            try { const r=await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`,{signal:AbortSignal.timeout(10000)}); commCache.current.set(code,await r.json()); } catch {}
          }
        });
      },
    }).addTo(map);
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
    const ps = prospectsRef.current;
    commLayerRef.current = L.geoJSON({type:"FeatureCollection",features:feats},{
      style: (f:any) => {
        const heat=getHeatStyle(f,ps);
        if (heat) return heat;
        return geoStyle(f);
      },
      onEachFeature:(feature:any,layer:any)=>{
        const nom=feature.properties?.nom||"";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`,{className:"mandatly-tooltip",sticky:true});
        layer.on("mouseover",()=>layer.setStyle({weight:3,fillOpacity:0.25}));
        layer.on("mouseout",()=>layer.setStyle(getHeatStyle(feature,ps)||geoStyle(feature)));
        layer.on("click",()=>map.fitBounds(layer.getBounds(),{padding:[20,20]}));
      },
    }).addTo(map);
  };

  // ── Parcelles colorées par classe DPE (style Pappers Immo) ───────────────
  const renderParcels = async () => {
    const map=mapInst.current;
    if (!map || !layersRef.current?.parcelles || map.getZoom()<Z_PARCEL) {
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
      badgesRef.current.forEach(m=>m.remove()); badgesRef.current=[];
      return;
    }
    const L=(window as any).L;
    const b=map.getBounds();
    const bbox=`${b.getSouth().toFixed(6)},${b.getWest().toFixed(6)},${b.getNorth().toFixed(6)},${b.getEast().toFixed(6)}`;
    let data:any;
    try {
      const r=await fetch(`https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TypeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=EPSG:4326&BBOX=${bbox}&OUTPUTFORMAT=application/json&COUNT=300`,{signal:AbortSignal.timeout(10000)});
      if (!r.ok) return;
      data=await r.json();
    } catch { return; }

    if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
    badgesRef.current.forEach(m=>m.remove()); badgesRef.current=[];

    const ps=prospectsRef.current, lrs=layersRef.current;
    const dvfSignalKeys=new Set<string>();

    parcLayerRef.current = L.geoJSON(data, {
      style: (feature:any) => {
        const coords=feature.geometry?.coordinates;
        if (!coords) return {weight:0,fillOpacity:0,opacity:0};
        const [clat,clng]=centroidOf(coords);
        const dpe=lrs?.dpe ? nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE")) : [];
        const dvf=lrs?.ventes ? nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE")) : [];
        if (dpe.length > 0) {
          const cls=(dpe[0] as any).classe_dpe||"";
          const col=dpeColor(cls);
          return {color:col, weight:2, opacity:1, fillColor:col, fillOpacity:0.35};
        }
        if (dvf.length > 0) {
          dvfSignalKeys.add(`${feature.properties?.section}-${feature.properties?.numero}`);
          return {color:C_DVF, weight:2, opacity:1, fillColor:C_DVF, fillOpacity:0};
        }
        return {weight:0.5, opacity:0.12, fillOpacity:0, color:"#475569"};
      },
      onEachFeature:(feature:any,layer:any)=>{
        const coords=feature.geometry?.coordinates;
        if (!coords) return;
        const [clat,clng]=centroidOf(coords);
        const dpe=nearbyProspects(clat,clng,ps.filter(p=>p.source==="DPE"));
        const dvf=nearbyProspects(clat,clng,ps.filter(p=>p.source!=="DPE"));
        const matching=[...dpe,...dvf];
        if (!matching.length) return;

        const cls=dpe.length>0?((dpe[0] as any).classe_dpe||""):"";
        const col=dpe.length>0?dpeColor(cls):C_DVF;
        const {section,numero,contenance,code_insee}=feature.properties||{};

        // Badge classe DPE sur la parcelle
        if (dpe.length > 0 && cls) {
          try {
            const badge = L.marker([clat,clng], {
              icon: L.divIcon({
                className:"",
                html:`<div style="background:${col};color:white;font-size:12px;font-weight:800;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px ${col}90,0 0 0 2px rgba(255,255,255,0.25);font-family:-apple-system,sans-serif;pointer-events:none;">${cls}</div>`,
                iconSize:[24,24], iconAnchor:[12,12],
              }),
              interactive:false,
            }).addTo(map);
            badgesRef.current.push(badge);
          } catch {}
        }

        // Nom propriétaire si dispo
        const topProspect = matching.find(p=>p.proprietaire_nom);
        if (topProspect?.proprietaire_nom) {
          try {
            const nomLabel = L.marker([clat,clng], {
              icon: L.divIcon({
                className:"",
                html:`<div style="background:rgba(8,8,12,0.88);color:#C4A35A;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;white-space:nowrap;border:1px solid rgba(196,163,90,0.35);margin-top:14px;font-family:-apple-system,sans-serif;pointer-events:none;">${topProspect.proprietaire_nom}</div>`,
                iconSize:[1,1], iconAnchor:[-4,-14],
              }),
              interactive:false,
            }).addTo(map);
            badgesRef.current.push(nomLabel);
          } catch {}
        }

        // Étiquette prix DVF
        const topPrix=(dvf.find((p:any)=>p.prix_achat)||null) as any;
        if (topPrix?.prix_achat>0 && lrs?.ventes) {
          try {
            const prix=topPrix.prix_achat;
            const label=prix>=1_000_000?`${(prix/1_000_000).toFixed(1).replace(/\.0$/,"").replace(".",",")} M€`:`${prix.toLocaleString("fr-FR")} €`;
            const w=Math.max(60,label.length*7+16), h=22;
            const m=L.marker([clat,clng],{
              icon:L.divIcon({
                className:"",
                html:`<div style="background:rgba(255,255,255,0.96);border:1px solid #cbd5e1;border-radius:3px;padding:2px 7px;font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.14);font-family:-apple-system,sans-serif;user-select:none;">${label}</div>`,
                iconSize:[w,h],iconAnchor:[w/2,h/2],
              }),
              interactive:false,
            }).addTo(map);
            badgesRef.current.push(m);
          } catch {}
        }

        layer.bindTooltip(
          `<div style="font-family:-apple-system,sans-serif;min-width:170px;">
            <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:3px;">Section ${section} · ${numero}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;">${contenance??""} m² · ${code_insee||""}</div>
            ${dpe.length>0?`<div style="font-size:11px;font-weight:700;color:${col};">DPE ${cls} · Signal de vente</div>`:""}
            ${dvf.length>0&&lrs?.ventes?`<div style="font-size:11px;font-weight:700;color:${C_DVF};">Vente DVF</div>`:""}
            ${topProspect?.proprietaire_nom?`<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${topProspect.proprietaire_nom}</div>`:""}
          </div>`,
          {className:"mandatly-tooltip",sticky:false}
        );
        layer.on("mouseover",()=>layer.setStyle({weight:3,fillOpacity:dpe.length>0?0.55:0.15}));
        layer.on("mouseout",()=>layer.setStyle(dpe.length>0?{color:col,weight:2,opacity:1,fillColor:col,fillOpacity:0.35}:{color:C_DVF,weight:2,opacity:1,fillColor:C_DVF,fillOpacity:0}));
        layer.on("click",(e:any)=>{
          (window as any).L.DomEvent.stopPropagation(e);
          try { map.fitBounds(layer.getBounds(),{maxZoom:19,padding:[50,50],animate:true}); } catch {}
          onParcelRef.current?.({properties:feature.properties,centroid:[clat,clng],matchingProspects:matching});
        });
      },
    }).addTo(map);
    markersRef.current.forEach(m=>m.bringToFront?.());
    badgesRef.current.forEach(m=>m.bringToFront?.());

    // Hachures SVG sur parcelles DVF
    const applyDvfStripes = () => {
      if (!parcLayerRef.current) return;
      injectPatterns(map);
      parcLayerRef.current.eachLayer((sub:any)=>{
        const key=`${sub.feature?.properties?.section}-${sub.feature?.properties?.numero}`;
        if (!dvfSignalKeys.has(key)) return;
        const el=sub.getElement?.(); if (!el) return;
        el.setAttribute("fill","url(#ml-hv)"); el.setAttribute("fill-opacity","1");
      });
    };
    setTimeout(applyDvfStripes, 80);
    setTimeout(applyDvfStripes, 300);
  };

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
      badgesRef.current.forEach(m=>m.remove()); badgesRef.current=[];
      await renderCommunes();
    } else {
      if (commLayerRef.current) { commLayerRef.current.remove(); commLayerRef.current=null; }
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current=null; }
      badgesRef.current.forEach(m=>m.remove()); badgesRef.current=[];
      await renderDepts();
    }
  };

  useEffect(()=>{
    if (!ready||!mapInst.current) return;
    const map=mapInst.current;
    const debounced=()=>{ clearTimeout(timerRef.current); timerRef.current=setTimeout(refresh,350); };
    refresh();
    map.on("moveend",debounced); map.on("zoomend",debounced);
    return ()=>{ map.off("moveend",debounced); map.off("zoomend",debounced); clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready]);

  useEffect(()=>{ if(!ready)return; refresh(); },[layers?.ventes,layers?.dpe,layers?.parcelles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!ready)return;
    clearTimeout(timerRef.current);
    timerRef.current=setTimeout(refresh,300);
  },[ready,prospects]); // eslint-disable-line react-hooks/exhaustive-deps

  const googleUrl=`https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;

  return (
    <>
      <style>{`
        .leaflet-container{font-family:-apple-system,sans-serif;}
        .mandatly-tooltip{background:rgba(8,10,18,0.97)!important;border:1px solid rgba(196,163,90,0.25)!important;border-radius:8px!important;box-shadow:0 4px 24px rgba(0,0,0,0.6)!important;padding:9px 13px!important;color:#fff;}
        .mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}
        .leaflet-popup-tip-container{display:none!important;}
      `}</style>
      <div style={{position:"relative",width:"100%",height:"100%"}}>
        <div ref={mapRef} style={{width:"100%",height:"100%"}}/>

        {/* Contrôles haut gauche */}
        <div style={{position:"absolute",top:12,left:12,zIndex:1000,display:"flex",gap:6}}>
          <div style={{display:"flex",background:"rgba(8,10,18,0.9)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:3,gap:2,backdropFilter:"blur(10px)"}}>
            {([["Plan",false],["Satellite",true]] as [string,boolean][]).map(([lbl,sat])=>(
              <button key={lbl} onClick={()=>setIsSat(sat)} style={{padding:"4px 11px",borderRadius:5,border:"none",background:isSat===sat?"rgba(255,255,255,0.14)":"transparent",color:isSat===sat?"#fff":"rgba(255,255,255,0.45)",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{lbl}</button>
            ))}
          </div>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{padding:"4px 11px",background:"rgba(8,10,18,0.9)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"rgba(255,255,255,0.6)",fontSize:11,fontWeight:600,textDecoration:"none",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",gap:4}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Vue 3D
          </a>
        </div>

        {/* Indicateur zoom */}
        <div style={{position:"absolute",bottom:40,right:48,zIndex:1000,background:"rgba(8,10,18,0.75)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"rgba(255,255,255,0.4)",fontWeight:600,backdropFilter:"blur(6px)",letterSpacing:"0.06em"}}>
          {zoom<Z_COMMUNE?"DÉPARTEMENTS":zoom<Z_PARCEL?"COMMUNES":"PARCELLES"}
        </div>

        {/* Légende */}
        <div style={{position:"absolute",bottom:40,left:12,zIndex:1000,background:"rgba(8,10,18,0.92)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 14px",backdropFilter:"blur(10px)"}}>
          {zoom<Z_PARCEL?(
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
              <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:7}}>Classe DPE</div>
              {(["A","B","C","D","E","F","G"] as string[]).map(cls=>(
                <div key={cls} style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                  <div style={{width:18,height:18,borderRadius:4,background:dpeColor(cls),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"white",flexShrink:0}}>{cls}</div>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.6)",fontWeight:500}}>
                    {cls==="A"?"Très économe":cls==="B"?"Économe":cls==="C"?"Bon":cls==="D"?"Moyen":cls==="E"?"Énergivore":cls==="F"?"Très énergivore":"Extrêmement énergivore"}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
