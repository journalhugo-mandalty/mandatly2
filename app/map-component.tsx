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

function pointInPoly(lng: number, lat: number, coords: number[][][]): boolean {
  const ring = coords[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function parcelCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0];
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  return [lat, lng];
}

export default function MapComponent({ prospects, onSelect, onParcelClick, center, dark = true, satellite: initSat = false, flyToTarget, layers }: Props) {
  const mapRef       = useRef<HTMLDivElement>(null);
  const mapInstance  = useRef<any>(null);
  const tileRef      = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const parcelRef    = useRef<any>(null);
  const geoJsonCache = useRef<any>(null);
  const timerRef     = useRef<any>(null);
  const prospectsRef = useRef(prospects);
  const layersRef    = useRef(layers);
  const onParcelRef  = useRef(onParcelClick);
  const [ready, setReady]   = useState(false);
  const [isSat, setIsSat]   = useState(initSat);
  const [zoom, setZoom]     = useState(6);
  const prevCenter = useRef<[number,number]>(center);

  useEffect(() => { prospectsRef.current = prospects; }, [prospects]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { onParcelRef.current = onParcelClick; }, [onParcelClick]);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const lnk = document.createElement("link");
    lnk.rel = "stylesheet"; lnk.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(lnk);
    const scr = document.createElement("script");
    scr.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    scr.onload = () => {
      const L = (window as any).L;
      const map = L.map(mapRef.current, { center: [44.837,-0.579], zoom: 6, zoomControl: false, attributionControl: false });
      const tile = initSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT);
      tileRef.current = L.tileLayer(tile, { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstance.current = map;
      map.on("zoomend", () => setZoom(map.getZoom()));
      setReady(true);
    };
    document.head.appendChild(scr);
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  // Tile swap
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    if (tileRef.current) tileRef.current.remove();
    const tile = isSat ? TILE_SAT : (dark ? TILE_DARK : TILE_LIGHT);
    tileRef.current = L.tileLayer(tile, { maxZoom: 19 }).addTo(mapInstance.current);
  }, [isSat, dark, ready]);

  // Center fly
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    const [pLat, pLng] = prevCenter.current, [nLat, nLng] = center;
    if (Math.abs(pLat-nLat)<0.001 && Math.abs(pLng-nLng)<0.001) return;
    prevCenter.current = center;
    map.once("moveend", () => map.flyTo([nLat,nLng], 13, { animate:true, duration:1.4 }));
    map.flyTo([pLat,pLng], 5, { animate:true, duration:0.8 });
  }, [center[0], center[1], ready]);

  // flyToTarget
  useEffect(() => {
    if (!ready || !mapInstance.current || !flyToTarget) return;
    mapInstance.current.flyTo([flyToTarget.lat,flyToTarget.lng], flyToTarget.zoom??17, { animate:true, duration:1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.key, ready]);

  // Markers (filtered by layers)
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const visible = prospects.filter(p => {
      if (p.source === "DPE") return layers?.dpe !== false;
      return layers?.ventes !== false;
    });

    visible.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isDpe = p.source === "DPE";
      let col: string, sz: number, label: string|number;
      if (isDpe) {
        const cls = p.classe_dpe||"";
        col = cls==="G"?"#EF4444":cls==="F"?"#F97316":cls==="E"?"#F59E0B":cls==="D"?"#6B7280":"#10B981";
        sz  = cls==="G"?38:cls==="F"?36:cls==="E"?32:28;
        label = cls||p.score;
      } else {
        col = p.score>=85?"#10B981":p.score>=70?"#F59E0B":p.score>=50?"#EF4444":"#6B7280";
        sz  = p.score>=85?36:p.score>=70?32:28;
        label = p.score;
      }
      const src = isDpe?("DPE"+(p.classe_dpe?" "+p.classe_dpe:"")):"DVF";
      const own = p.proprietaire_nom?`<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${p.proprietaire_nom}</div>`:"";
      const icon = L.divIcon({ className:"", html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?12:11}px;font-weight:700;box-shadow:0 2px 12px ${col}60;cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`, iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
      const marker = L.marker([p.lat,p.lng],{icon}).addTo(map);
      marker.bindTooltip(
        `<div style="min-width:150px;max-width:210px;font-family:-apple-system,sans-serif;"><div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:2px;white-space:normal;line-height:1.35;">${p.adresse}</div><div style="font-size:10px;color:#888;">${src} · Score ${p.score}</div>${own}</div>`,
        { direction:"top", offset:[0,-(sz/2+6)], className:"mandatly-tooltip", permanent:false, opacity:1 }
      );
      marker.on("click", () => { if (onSelect) onSelect(p); });
      markersRef.current.push(marker);
    });
  }, [ready, prospects, dark, layers?.ventes, layers?.dpe]);

  // Parcel layer — fetch + render, re-render on layer toggle without re-fetching
  const renderParcels = () => {
    const map = mapInstance.current;
    if (!map || !(window as any).L) return;
    const L = (window as any).L;
    const lyr = layersRef.current;

    if (parcelRef.current) { parcelRef.current.remove(); parcelRef.current = null; }
    if (!lyr?.parcelles || !geoJsonCache.current) return;

    parcelRef.current = L.geoJSON(geoJsonCache.current, {
      style: (feature: any) => {
        const coords = feature.geometry?.coordinates;
        if (!coords) return {};
        const ps = prospectsRef.current;
        const lrs = layersRef.current;
        const dvf  = (lrs?.ventes)        ? ps.filter(p=>p.lat&&p.lng&&p.source!=="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const dpe  = (lrs?.dpe)           ? ps.filter(p=>p.lat&&p.lng&&p.source==="DPE"&&pointInPoly(p.lng,p.lat,coords)) : [];
        const owns = (lrs?.proprietaires) ? ps.filter(p=>p.lat&&p.lng&&p.proprietaire_nom&&pointInPoly(p.lng,p.lat,coords)) : [];
        if (dvf.length)  return { color:"#F97316", fillColor:"#F97316", fillOpacity:0.28, weight:2,   opacity:0.9 };
        if (dpe.length)  return { color:"#10B981", fillColor:"#10B981", fillOpacity:0.22, weight:1.5, opacity:0.8 };
        if (owns.length) return { color:"#6366F1", fillColor:"#6366F1", fillOpacity:0.18, weight:1.5, opacity:0.7 };
        return { color:"#94A3B8", fillColor:"#94A3B8", fillOpacity:0.06, weight:1, opacity:0.35 };
      },
      onEachFeature: (feature: any, layer: any) => {
        const coords = feature.geometry?.coordinates;
        if (!coords) return;
        const ps = prospectsRef.current;
        const matching = ps.filter(p=>p.lat&&p.lng&&pointInPoly(p.lng,p.lat,coords));
        const centroid = parcelCentroid(coords);
        const { section, numero, contenance, code_insee } = feature.properties||{};
        const hasSig = matching.length>0;

        const sigHtml = hasSig
          ? matching.slice(0,3).map(p=>{
              const src=p.source==="DPE"?`DPE ${p.classe_dpe||""}`:"DVF";
              return `<div style="font-size:10px;color:#F97316;margin-top:3px;padding:3px 6px;background:rgba(249,115,22,0.1);border-radius:4px;">${src} · Score ${p.score}</div>`;
            }).join("")
          : `<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px;font-style:italic;">Aucun signal</div>`;

        layer.bindPopup(
          `<div style="font-family:-apple-system,sans-serif;min-width:200px;max-width:250px;">` +
          `<div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:3px;">${section} ${numero}</div>` +
          `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-bottom:6px;">${contenance??""} m² · ${code_insee||""}</div>` +
          sigHtml + `</div>`,
          { className:"mandatly-tooltip", maxWidth:260 }
        );
        layer.on("mouseover", ()=>layer.setStyle({ fillOpacity: hasSig?0.45:0.18 }));
        layer.on("mouseout",  ()=>layer.setStyle({ fillOpacity: hasSig?0.28:0.06 }));
        layer.on("click", ()=>{
          if (onParcelRef.current) onParcelRef.current({ properties:feature.properties, centroid, matchingProspects:matching });
        });
      }
    }).addTo(map);
    markersRef.current.forEach(m=>m.bringToFront?.());
  };

  const fetchParcels = async () => {
    const map = mapInstance.current;
    if (!map || !layersRef.current?.parcelles) { if (parcelRef.current){parcelRef.current.remove();parcelRef.current=null;} return; }
    if (map.getZoom()<15) { if (parcelRef.current){parcelRef.current.remove();parcelRef.current=null;} return; }
    const b = map.getBounds();
    const bbox = `${b.getWest().toFixed(6)},${b.getSouth().toFixed(6)},${b.getEast().toFixed(6)},${b.getNorth().toFixed(6)}`;
    try {
      const res = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?bbox=${bbox}&_limit=150`,{signal:AbortSignal.timeout(8000)});
      if (!res.ok) return;
      geoJsonCache.current = await res.json();
      renderParcels();
    } catch {}
  };

  const debounced = () => { clearTimeout(timerRef.current); timerRef.current=setTimeout(fetchParcels,450); };

  // Parcel effect: re-fetch on parcelles toggle, re-render on other layer changes
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    if (!layers?.parcelles) {
      if (parcelRef.current){parcelRef.current.remove();parcelRef.current=null;}
      map.off("moveend",debounced); map.off("zoomend",debounced);
      return;
    }
    fetchParcels();
    map.on("moveend",debounced); map.on("zoomend",debounced);
    return () => { map.off("moveend",debounced); map.off("zoomend",debounced); clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layers?.parcelles]);

  // Re-render parcel colors when other layers toggle (no re-fetch)
  useEffect(() => {
    if (!ready) return;
    renderParcels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers?.ventes, layers?.dpe, layers?.proprietaires]);

  const googleMapsUrl = `https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;

  return (
    <>
      <style>{`
        .leaflet-container{font-family:-apple-system,sans-serif;}
        .mandatly-tooltip{background:rgba(10,16,28,0.96)!important;border:1px solid rgba(196,163,90,0.3)!important;border-radius:8px!important;box-shadow:0 4px 20px rgba(0,0,0,0.5)!important;padding:8px 12px!important;color:#fff;}
        .mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}
        .leaflet-popup-tip-container{display:none!important;}
        .leaflet-popup-content-wrapper.mandatly-tooltip{padding:0!important;}
        .leaflet-popup-content-wrapper.mandatly-tooltip .leaflet-popup-content{margin:10px 14px!important;}
      `}</style>
      <div style={{position:"relative",width:"100%",height:"100%"}}>
        <div ref={mapRef} style={{width:"100%",height:"100%"}}/>
        {/* Plan / Satellite */}
        <div style={{position:"absolute",top:12,left:12,zIndex:1000,display:"flex",gap:6}}>
          <div style={{display:"flex",background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:3,gap:2,backdropFilter:"blur(8px)"}}>
            {([["Plan",false],["Satellite",true]] as [string,boolean][]).map(([lbl,sat])=>(
              <button key={lbl} onClick={()=>setIsSat(sat)} style={{padding:"4px 10px",borderRadius:5,border:"none",background:isSat===sat?"rgba(255,255,255,0.15)":"transparent",color:isSat===sat?"#fff":"rgba(255,255,255,0.5)",fontSize:11,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{lbl}</button>
            ))}
          </div>
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" style={{padding:"4px 10px",background:"rgba(10,16,28,0.88)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"rgba(255,255,255,0.7)",fontSize:11,fontWeight:600,textDecoration:"none",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:4}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Vue 3D
          </a>
        </div>
        {/* Parcelles zoom hint */}
        {layers?.parcelles && zoom<15 && (
          <div style={{position:"absolute",bottom:40,left:"50%",transform:"translateX(-50%)",zIndex:1000,background:"rgba(10,16,28,0.88)",border:"1px solid rgba(249,115,22,0.4)",borderRadius:8,padding:"6px 14px",fontSize:11,color:"#F97316",fontWeight:600,backdropFilter:"blur(8px)",whiteSpace:"nowrap"}}>
            Zoomez pour voir les parcelles cadastrales
          </div>
        )}
      </div>
    </>
  );
}
