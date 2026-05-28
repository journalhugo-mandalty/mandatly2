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

const TILE_DARK  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_SAT   = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Zoom thresholds
const Z_COMMUNE = 9;
const Z_SECTION = 13;
const Z_PARCEL  = 15;

// Colours – same palette as Pappers Immo
const C_DVF  = "#7C3AED"; // violet – ventes DVF / prospecteur
const C_DPE  = "#10B981"; // green  – DPE récent
const C_NONE = "#94A3B8"; // gray   – aucune donnée

function pointInPoly(lng: number, lat: number, coords: number[][][]): boolean {
  const ring = coords[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function centroidOf(coords: number[][][]): [number, number] {
  const ring = coords[0];
  return [
    ring.reduce((s, c) => s + c[1], 0) / ring.length,
    ring.reduce((s, c) => s + c[0], 0) / ring.length,
  ];
}

// Inject SVG hatch patterns once into Leaflet's overlay SVG
function injectPatterns(map: any) {
  const svgEl = map.getPane?.("overlayPane")?.querySelector("svg");
  if (!svgEl || svgEl.querySelector("#ml-hv")) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  const make = (id: string, col: string) => {
    const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pat.setAttribute("id", id);
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", "8"); pat.setAttribute("height", "8");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "8"); bg.setAttribute("height", "8");
    bg.setAttribute("fill", col); bg.setAttribute("opacity", "0.09");
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ln.setAttribute("d", "M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2");
    ln.setAttribute("stroke", col); ln.setAttribute("stroke-width", "1.8");
    pat.appendChild(bg); pat.appendChild(ln);
    return pat;
  };
  defs.appendChild(make("ml-hv", C_DVF));
  defs.appendChild(make("ml-hg", C_DPE));
  defs.appendChild(make("ml-hn", C_NONE));
  svgEl.insertBefore(defs, svgEl.firstChild);
}

// Apply SVG pattern fill to every path in a geoJSON layer
function applyFill(geoLayer: any, getPatId: (f: any) => string) {
  geoLayer.eachLayer((sub: any) => {
    const el = sub.getElement?.();
    if (!el) return;
    const pid = getPatId(sub.feature);
    el.setAttribute("fill", `url(#${pid})`);
    el.setAttribute("fill-opacity", "1");
  });
}

export default function MapComponent({
  prospects, onSelect, onParcelClick,
  center, dark = true, satellite: initSat = false,
  flyToTarget, layers,
}: Props) {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInst       = useRef<any>(null);
  const tileRef       = useRef<any>(null);
  const markersRef    = useRef<any[]>([]);
  const deptLayerRef  = useRef<any>(null);
  const commLayerRef  = useRef<any>(null);
  const sectLayerRef  = useRef<any>(null);
  const parcLayerRef  = useRef<any>(null);
  const deptCache     = useRef<any>(null);
  const commCache     = useRef<Map<string,any>>(new Map());
  const sectCache     = useRef<Map<string,any>>(new Map());
  const parcCache     = useRef<any>(null);
  const timerRef      = useRef<any>(null);
  const prospectsRef  = useRef(prospects);
  const layersRef     = useRef(layers);
  const onParcelRef   = useRef(onParcelClick);
  const prevCenter    = useRef<[number,number]>(center);
  const [ready,   setReady]   = useState(false);
  const [isSat,   setIsSat]   = useState(initSat);
  const [zoom,    setZoom]    = useState(6);

  useEffect(() => { prospectsRef.current = prospects; }, [prospects]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { onParcelRef.current = onParcelClick; }, [onParcelClick]);

  // ── Init Leaflet ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const lnk = Object.assign(document.createElement("link"), { rel:"stylesheet", href:"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" });
    document.head.appendChild(lnk);
    const scr = document.createElement("script");
    scr.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    scr.onload = () => {
      const L = (window as any).L;
      const map = L.map(mapRef.current, { center:[44.837,-0.579], zoom:6, zoomControl:false, attributionControl:false });
      tileRef.current = L.tileLayer(initSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT), { maxZoom:19 }).addTo(map);
      L.control.zoom({ position:"bottomright" }).addTo(map);
      mapInst.current = map;
      map.on("zoomend", () => setZoom(map.getZoom()));
      setReady(true);
    };
    document.head.appendChild(scr);
    return () => { if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; } };
  }, []);

  // ── Tile swap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(isSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT), { maxZoom:19 }).addTo(mapInst.current);
  }, [isSat, dark, ready]);

  // ── Center fly ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const map = mapInst.current;
    const [pLat,pLng] = prevCenter.current, [nLat,nLng] = center;
    if (Math.abs(pLat-nLat)<0.001 && Math.abs(pLng-nLng)<0.001) return;
    prevCenter.current = center;
    map.once("moveend", () => map.flyTo([nLat,nLng], 13, { animate:true, duration:1.4 }));
    map.flyTo([pLat,pLng], 5, { animate:true, duration:0.8 });
  }, [center[0], center[1], ready]);

  // ── flyToTarget ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current || !flyToTarget) return;
    mapInst.current.flyTo([flyToTarget.lat,flyToTarget.lng], flyToTarget.zoom??17, { animate:true, duration:1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.key, ready]);

  // ── Prospect markers ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const L = (window as any).L, map = mapInst.current;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const visible = prospects.filter(p =>
      p.source === "DPE" ? layers?.dpe !== false : layers?.ventes !== false
    );
    visible.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isDpe = p.source === "DPE";
      let col: string, sz: number, label: string|number;
      if (isDpe) {
        const cls = p.classe_dpe||"";
        col = cls==="G"?"#EF4444":cls==="F"?"#F97316":cls==="E"?"#F59E0B":cls==="D"?"#6B7280":"#10B981";
        sz  = cls==="G"?38:cls==="F"?36:cls==="E"?32:28; label = cls||p.score;
      } else {
        col = p.score>=85?"#10B981":p.score>=70?"#F59E0B":p.score>=50?"#EF4444":"#6B7280";
        sz  = p.score>=85?36:p.score>=70?32:28; label = p.score;
      }
      const own = p.proprietaire_nom ? `<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${p.proprietaire_nom}</div>` : "";
      const icon = L.divIcon({ className:"", html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?12:11}px;font-weight:700;box-shadow:0 2px 12px ${col}60;cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`, iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
      const marker = L.marker([p.lat,p.lng],{icon}).addTo(map);
      marker.bindTooltip(
        `<div style="min-width:150px;max-width:210px;font-family:-apple-system,sans-serif;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:2px;line-height:1.35;">${p.adresse}</div><div style="font-size:10px;color:#888;">${isDpe?"DPE":"DVF"} · Score ${p.score}</div>${own}</div>`,
        { direction:"top", offset:[0,-(sz/2+6)], className:"mandatly-tooltip", permanent:false, opacity:1 }
      );
      marker.on("click", () => onSelect?.(p));
      markersRef.current.push(marker);
    });
  }, [ready, prospects, dark, layers?.ventes, layers?.dpe]);

  // ── Helpers for geographic layers ─────────────────────────────────────────
  const hasSignal = (feature: any, type: "dvf"|"dpe"|"any"): boolean => {
    const ps = prospectsRef.current;
    if (!ps.length) return false;
    const nom = (feature.properties?.nom || feature.properties?.nom_com || "").toLowerCase();
    const code = feature.properties?.code || feature.properties?.code_insee || "";
    return ps.some(p => {
      const match = nom ? p.ville.toLowerCase().includes(nom) || nom.includes(p.ville.toLowerCase()) : false;
      if (type === "dvf")  return match && p.source !== "DPE";
      if (type === "dpe")  return match && p.source === "DPE";
      return match;
    });
  };

  const patternId = (feature: any): string => {
    const dvf = layersRef.current?.ventes        !== false && hasSignal(feature, "dvf");
    const dpe = layersRef.current?.dpe           !== false && hasSignal(feature, "dpe");
    return dvf ? "ml-hv" : dpe ? "ml-hg" : "ml-hn";
  };

  const strokeCol = (feature: any): string => {
    const dvf = layersRef.current?.ventes !== false && hasSignal(feature, "dvf");
    const dpe = layersRef.current?.dpe   !== false && hasSignal(feature, "dpe");
    return dvf ? C_DVF : dpe ? C_DPE : C_NONE;
  };

  const geoStyle = (feature: any) => ({
    color:       strokeCol(feature),
    weight:      hasSignal(feature,"any") ? 2 : 1,
    fillOpacity: 0,
    opacity:     hasSignal(feature,"any") ? 0.85 : 0.3,
  });

  // ── Department layer ──────────────────────────────────────────────────────
  const renderDepts = async () => {
    const map = mapInst.current; if (!map) return;
    const L = (window as any).L;
    if (!deptCache.current) {
      try {
        const r = await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour", { signal: AbortSignal.timeout(10000) });
        deptCache.current = await r.json();
      } catch { return; }
    }
    if (deptLayerRef.current) { deptLayerRef.current.remove(); deptLayerRef.current = null; }
    deptLayerRef.current = L.geoJSON(deptCache.current, {
      style: geoStyle,
      onEachFeature: (feature: any, layer: any) => {
        const nom = feature.properties?.nom || "";
        const code = feature.properties?.code || "";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`, { className:"mandatly-tooltip", sticky:true });
        layer.on("mouseover", () => layer.setStyle({ weight:3 }));
        layer.on("mouseout",  () => layer.setStyle({ weight: hasSignal(feature,"any")?2:1 }));
        layer.on("click", async () => {
          map.fitBounds(layer.getBounds(), { padding:[20,20] });
          // pre-load communes for this dept
          if (!commCache.current.has(code)) {
            try {
              const r = await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`, { signal:AbortSignal.timeout(10000) });
              commCache.current.set(code, await r.json());
            } catch {}
          }
        });
      },
    }).addTo(map);
    injectPatterns(map);
    setTimeout(() => { if (deptLayerRef.current) applyFill(deptLayerRef.current, patternId); }, 80);
  };

  // ── Commune layer ─────────────────────────────────────────────────────────
  const renderCommunes = async () => {
    const map = mapInst.current; if (!map) return;
    const L = (window as any).L;
    const b = map.getBounds();
    // Find which departments are visible
    if (!deptCache.current) {
      try {
        const r = await fetch("https://geo.api.gouv.fr/departements?format=geojson&geometry=contour", { signal:AbortSignal.timeout(10000) });
        deptCache.current = await r.json();
      } catch { return; }
    }
    // Get codes of visible depts
    const visibleDeptCodes: string[] = (deptCache.current?.features || [])
      .filter((f: any) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return false;
        try {
          const layer = L.geoJSON(f);
          return layer.getBounds().intersects(b);
        } catch { return false; }
      })
      .map((f: any) => f.properties?.code)
      .filter(Boolean)
      .slice(0, 4); // max 4 depts at once

    // Fetch missing commune data
    await Promise.allSettled(visibleDeptCodes.map(async code => {
      if (!commCache.current.has(code)) {
        try {
          const r = await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&format=geojson&geometry=contour`, { signal:AbortSignal.timeout(10000) });
          commCache.current.set(code, await r.json());
        } catch {}
      }
    }));

    const allFeatures: any[] = [];
    for (const code of visibleDeptCodes) {
      const d = commCache.current.get(code);
      if (d?.features) allFeatures.push(...d.features);
    }
    if (!allFeatures.length) return;

    if (commLayerRef.current) { commLayerRef.current.remove(); commLayerRef.current = null; }
    commLayerRef.current = L.geoJSON({ type:"FeatureCollection", features: allFeatures }, {
      style: geoStyle,
      onEachFeature: (feature: any, layer: any) => {
        const nom = feature.properties?.nom || "";
        layer.bindTooltip(`<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#fff;">${nom}</div>`, { className:"mandatly-tooltip", sticky:true });
        layer.on("mouseover", () => layer.setStyle({ weight:3 }));
        layer.on("mouseout",  () => layer.setStyle({ weight: hasSignal(feature,"any")?2:1 }));
        layer.on("click", () => map.fitBounds(layer.getBounds(), { padding:[20,20] }));
      },
    }).addTo(map);
    injectPatterns(map);
    setTimeout(() => { if (commLayerRef.current) applyFill(commLayerRef.current, patternId); }, 80);
  };

  // ── Cadastral parcel layer (zoom ≥ Z_PARCEL) ──────────────────────────────
  const renderParcels = async () => {
    const map = mapInst.current; if (!map || !layersRef.current?.parcelles) {
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current = null; }
      return;
    }
    if (map.getZoom() < Z_PARCEL) {
      if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current = null; }
      return;
    }
    const L = (window as any).L;
    const b = map.getBounds();
    const bbox = `${b.getWest().toFixed(6)},${b.getSouth().toFixed(6)},${b.getEast().toFixed(6)},${b.getNorth().toFixed(6)}`;
    try {
      const r = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?bbox=${bbox}&_limit=200`, { signal:AbortSignal.timeout(8000) });
      if (!r.ok) return;
      parcCache.current = await r.json();
    } catch { return; }

    if (parcLayerRef.current) { parcLayerRef.current.remove(); parcLayerRef.current = null; }
    const ps = prospectsRef.current;
    const lrs = layersRef.current;

    parcLayerRef.current = L.geoJSON(parcCache.current, {
      style: (feature: any) => {
        const coords = feature.geometry?.coordinates;
        if (!coords) return {};
        const dvf  = lrs?.ventes        ? ps.filter(p=>p.lat&&p.lng&&p.source!=="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const dpe  = lrs?.dpe           ? ps.filter(p=>p.lat&&p.lng&&p.source==="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const hasSig = dvf.length > 0 || dpe.length > 0;
        const col = dvf.length ? C_DVF : dpe.length ? C_DPE : C_NONE;
        return { color:col, weight: hasSig?2:0.8, fillOpacity:0, opacity: hasSig?0.9:0.35 };
      },
      onEachFeature: (feature: any, layer: any) => {
        const coords = feature.geometry?.coordinates;
        if (!coords) return;
        const { section, numero, contenance, code_insee } = feature.properties||{};
        const ps2 = prospectsRef.current;
        const lrs2 = layersRef.current;
        const dvf  = (lrs2?.ventes) ? ps2.filter(p=>p.lat&&p.lng&&p.source!=="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const dpe  = (lrs2?.dpe)   ? ps2.filter(p=>p.lat&&p.lng&&p.source==="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const matching = [...dvf, ...dpe];
        const hasSig = matching.length > 0;
        const pid = dvf.length ? "ml-hv" : dpe.length ? "ml-hg" : "ml-hn";

        layer.on("add", () => {
          injectPatterns(map);
          const el = layer.getElement?.();
          if (el) { el.setAttribute("fill", `url(#${pid})`); el.setAttribute("fill-opacity","1"); }
        });
        layer.bindTooltip(
          `<div style="font-family:-apple-system,sans-serif;min-width:160px;"><div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:3px;">Section ${section} · ${numero}</div><div style="font-size:10px;color:rgba(255,255,255,0.45);">${contenance??""} m² · ${code_insee||""}</div>${hasSig?`<div style="font-size:10px;color:${dvf.length?C_DVF:C_DPE};margin-top:3px;font-weight:600;">${dvf.length?"Signal DVF":"Signal DPE"}</div>`:""}</div>`,
          { className:"mandatly-tooltip", sticky:false }
        );
        layer.on("mouseover", () => layer.setStyle({ weight: hasSig?3:1.5 }));
        layer.on("mouseout",  () => layer.setStyle({ weight: hasSig?2:0.8 }));
        layer.on("click", () => {
          const centroid = centroidOf(coords);
          onParcelRef.current?.({ properties:feature.properties, centroid, matchingProspects:matching });
        });
      },
    }).addTo(map);
    markersRef.current.forEach(m => m.bringToFront?.());
  };

  // ── Master refresh: pick which layers to show based on zoom ───────────────
  const refresh = async () => {
    const map = mapInst.current;
    if (!map || !(window as any).L) return;
    const z = map.getZoom();
    const showParcels    = z >= Z_PARCEL  && layersRef.current?.parcelles;
    const showCommunes   = z >= Z_COMMUNE && z < Z_PARCEL;
    const showDepts      = z < Z_COMMUNE;

    // Clear layers that shouldn't be visible
    if (!showDepts)    { if (deptLayerRef.current)  { deptLayerRef.current.remove();  deptLayerRef.current  = null; } }
    if (!showCommunes) { if (commLayerRef.current)  { commLayerRef.current.remove();  commLayerRef.current  = null; } }
    if (!showParcels)  { if (parcLayerRef.current)  { parcLayerRef.current.remove();  parcLayerRef.current  = null; } }

    if (showDepts)    await renderDepts();
    if (showCommunes) await renderCommunes();
    if (showParcels)  await renderParcels();
  };

  // ── Trigger refresh on zoom/move ──────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapInst.current) return;
    const map = mapInst.current;
    const debounced = () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(refresh, 400); };
    refresh();
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    return () => { map.off("moveend", debounced); map.off("zoomend", debounced); clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Re-render when layers toggle (recolour without re-fetching)
  useEffect(() => {
    if (!ready) return;
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers?.parcelles, layers?.ventes, layers?.dpe, layers?.proprietaires]);

  const googleUrl = `https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;

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

        {/* Map controls */}
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

        {/* Zoom level indicator */}
        <div style={{position:"absolute",bottom:40,right:48,zIndex:1000,background:"rgba(10,16,28,0.75)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"3px 8px",fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:600,backdropFilter:"blur(6px)",letterSpacing:"0.05em"}}>
          {zoom < Z_COMMUNE ? "DÉPARTEMENTS" : zoom < Z_PARCEL ? "COMMUNES" : "PARCELLES"}
        </div>

        {/* Legend */}
        <div style={{position:"absolute",bottom:40,left:12,zIndex:1000,background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"8px 12px",backdropFilter:"blur(8px)"}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:6}}>Légende</div>
          {([[C_DVF,"Ventes DVF"],[C_DPE,"DPE récents"],[C_NONE,"Sans données"]] as [string,string][]).map(([col,lbl])=>(
            <div key={lbl} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
              <svg width="16" height="10" viewBox="0 0 16 10">
                <rect width="16" height="10" fill={col} opacity="0.12"/>
                <path d="M-1,1 l3,-3 M0,8 l8,-8 M6,11 l3,-3" stroke={col} strokeWidth="1.5"/>
              </svg>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.7)",fontWeight:500}}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
