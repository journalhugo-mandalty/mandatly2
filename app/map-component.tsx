"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: any; adresse: string; ville: string; score: number;
  source: string; notes: string; lat: number; lng: number;
  proprietaire_nom?: string; classe_dpe?: string;
};
type Props = {
  prospects: Prospect[]; onSelect?: (p: Prospect) => void;
  center: [number, number]; dark?: boolean; satellite?: boolean;
  flyToTarget?: { lat: number; lng: number; zoom?: number; key: any };
};

const TILE_PLAN_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_PLAN_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Ray-casting point-in-polygon (GeoJSON coords = [lng, lat])
function pointInPoly(lng: number, lat: number, coords: number[][][]): boolean {
  const ring = coords[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export default function MapComponent({ prospects, onSelect, center, dark = true, satellite: initSat = false, flyToTarget }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const parcelLayerRef = useRef<any>(null);
  const fetchTimerRef = useRef<any>(null);
  const prospectsRef = useRef(prospects);
  const [ready, setReady] = useState(false);
  const [isSat, setIsSat] = useState(initSat);
  const [parcellesOn, setParcellesOn] = useState(false);
  const [mapZoom, setMapZoom] = useState(6);
  const prevCenter = useRef<[number,number]>(center);

  // Keep prospects ref in sync without triggering parcel re-fetch
  useEffect(() => { prospectsRef.current = prospects; }, [prospects]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      const L = (window as any).L;
      const map = L.map(mapRef.current, { center: [44.837, -0.579], zoom: 6, zoomControl: false, attributionControl: false });
      const tile = initSat ? TILE_SATELLITE : (dark ? TILE_PLAN_DARK : TILE_PLAN_LIGHT);
      tileLayerRef.current = L.tileLayer(tile, { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstance.current = map;
      map.on("zoomend", () => setMapZoom(map.getZoom()));
      setReady(true);
    };
    document.head.appendChild(script);
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;
    if (tileLayerRef.current) { tileLayerRef.current.remove(); }
    const tile = isSat ? TILE_SATELLITE : (dark ? TILE_PLAN_DARK : TILE_PLAN_LIGHT);
    tileLayerRef.current = L.tileLayer(tile, { maxZoom: 19 }).addTo(map);
  }, [isSat, dark, ready]);

  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    const [prevLat, prevLng] = prevCenter.current;
    const [newLat, newLng] = center;
    if (Math.abs(prevLat - newLat) < 0.001 && Math.abs(prevLng - newLng) < 0.001) return;
    prevCenter.current = center;
    map.once("moveend", () => { map.flyTo([newLat, newLng], 13, { animate: true, duration: 1.4 }); });
    map.flyTo([prevLat, prevLng], 5, { animate: true, duration: 0.8 });
  }, [center[0], center[1], ready]);

  useEffect(() => {
    if (!ready || !mapInstance.current || !flyToTarget) return;
    mapInstance.current.flyTo([flyToTarget.lat, flyToTarget.lng], flyToTarget.zoom ?? 17, { animate: true, duration: 1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.key, ready]);

  // Markers
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;
    markers.current.forEach(m => m.remove());
    markers.current = [];
    prospects.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isDpe = p.source === "DPE";
      let col: string, sz: number, label: string | number;
      if (isDpe) {
        const cls = p.classe_dpe || "";
        col = cls === "G" ? "#EF4444" : cls === "F" ? "#F97316" : cls === "E" ? "#F59E0B" : cls === "D" ? "#6B7280" : "#10B981";
        sz = cls === "G" ? 38 : cls === "F" ? 36 : cls === "E" ? 32 : 28;
        label = cls || p.score;
      } else {
        col = p.score >= 85 ? "#10B981" : p.score >= 70 ? "#F59E0B" : p.score >= 50 ? "#EF4444" : "#6B7280";
        sz = p.score >= 85 ? 36 : p.score >= 70 ? 32 : 28;
        label = p.score;
      }
      const src = isDpe ? ("DPE" + (p.classe_dpe ? " " + p.classe_dpe : "")) : "DVF";
      const own = p.proprietaire_nom ? `<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${p.proprietaire_nom}</div>` : "";
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:${isDpe?12:11}px;font-weight:700;box-shadow:0 2px 12px ${col}60;cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${label}</div>`,
        iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.bindTooltip(
        `<div style="min-width:150px;max-width:210px;font-family:-apple-system,sans-serif;">` +
        `<div style="font-size:11px;font-weight:600;color:#fff;margin-bottom:2px;white-space:normal;line-height:1.35;">${p.adresse}</div>` +
        `<div style="font-size:10px;color:#888;">${src} &middot; Score ${p.score}</div>${own}</div>`,
        { direction: "top", offset: [0, -(sz/2+6)], className: "mandatly-tooltip", permanent: false, opacity: 1 }
      );
      marker.on("click", () => { if (onSelect) onSelect(p); });
      markers.current.push(marker);
    });
  }, [ready, prospects, dark]);

  // Cadastral parcel layer
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;

    const clearLayer = () => {
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null; }
    };

    const fetchAndRender = async () => {
      if (!parcellesOn) { clearLayer(); return; }
      const zoom = map.getZoom();
      if (zoom < 15) { clearLayer(); return; }

      const b = map.getBounds();
      const bbox = `${b.getWest().toFixed(6)},${b.getSouth().toFixed(6)},${b.getEast().toFixed(6)},${b.getNorth().toFixed(6)}`;
      try {
        const res = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?bbox=${bbox}&_limit=150`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const data = await res.json();
        clearLayer();

        parcelLayerRef.current = L.geoJSON(data, {
          style: (feature: any) => {
            const coords = feature.geometry?.coordinates;
            if (!coords) return {};
            const hits = prospectsRef.current.filter(p => p.lat && p.lng && pointInPoly(p.lng, p.lat, coords));
            const hasSignal = hits.length > 0;
            return {
              color: hasSignal ? "#F97316" : "#818CF8",
              fillColor: hasSignal ? "#F97316" : "#818CF8",
              fillOpacity: hasSignal ? 0.28 : 0.07,
              weight: hasSignal ? 2 : 1,
              opacity: hasSignal ? 0.9 : 0.45,
            };
          },
          onEachFeature: (feature: any, layer: any) => {
            const coords = feature.geometry?.coordinates;
            const { section, numero, contenance, code_insee } = feature.properties || {};
            const hits = coords ? prospectsRef.current.filter(p => p.lat && p.lng && pointInPoly(p.lng, p.lat, coords)) : [];
            const hasSignal = hits.length > 0;

            const signalHtml = hasSignal
              ? hits.map(p => {
                  const src = p.source === "DPE" ? `DPE ${p.classe_dpe || ""}` : "DVF";
                  return `<div style="font-size:10px;color:#F97316;margin-top:4px;padding:4px 6px;background:rgba(249,115,22,0.12);border-radius:4px;border:1px solid rgba(249,115,22,0.3);">${src} · Score ${p.score} · ${(p.notes||"").slice(0,45)}</div>`;
                }).join("")
              : `<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;font-style:italic;">Aucun signal de vente</div>`;

            const ownerHtml = hits[0]?.proprietaire_nom
              ? `<div style="font-size:10px;color:#C4A35A;font-weight:600;margin-top:6px;">${hits[0].proprietaire_nom}</div>`
              : "";

            layer.bindPopup(
              `<div style="font-family:-apple-system,sans-serif;min-width:220px;max-width:270px;">` +
              `<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px;">Section ${section} · n° ${numero}</div>` +
              `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-bottom:6px;">${contenance ? contenance + " m²" : "?"} · INSEE ${code_insee || "?"}</div>` +
              signalHtml + ownerHtml +
              `</div>`,
              { className: "mandatly-tooltip", maxWidth: 280 }
            );

            layer.on("mouseover", () => layer.setStyle({ fillOpacity: hasSignal ? 0.45 : 0.18 }));
            layer.on("mouseout", () => layer.setStyle({ fillOpacity: hasSignal ? 0.28 : 0.07 }));
          },
        }).addTo(map);

        // Ensure markers stay on top
        markers.current.forEach(m => m.bringToFront?.());
      } catch {}
    };

    const debouncedFetch = () => {
      clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = setTimeout(fetchAndRender, 450);
    };

    fetchAndRender();
    map.on("moveend", debouncedFetch);
    map.on("zoomend", debouncedFetch);

    return () => {
      map.off("moveend", debouncedFetch);
      map.off("zoomend", debouncedFetch);
      clearTimeout(fetchTimerRef.current);
      clearLayer();
    };
  }, [ready, parcellesOn]);

  const googleMaps3DUrl = `https://www.google.com/maps/@${center[0]},${center[1]},200m/data=!3m1!1e3`;
  const hasDpe = prospects.some(p => p.source === "DPE");

  return (
    <>
      <style>{`
        .leaflet-container{font-family:-apple-system,sans-serif;}
        .mandatly-tooltip{background:rgba(10,16,28,0.96)!important;border:1px solid rgba(196,163,90,0.3)!important;border-radius:8px!important;box-shadow:0 4px 20px rgba(0,0,0,0.5)!important;padding:8px 12px!important;color:#fff;}
        .mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}
        .leaflet-popup-content-wrapper.mandatly-tooltip{padding:0!important;}
        .leaflet-popup-content-wrapper.mandatly-tooltip .leaflet-popup-content{margin:10px 14px!important;}
        .leaflet-popup-tip-container{display:none!important;}
      `}</style>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

        {/* DPE legend */}
        {hasDpe && (
          <div style={{ position: "absolute", bottom: 40, left: 12, zIndex: 1000, background: "rgba(10,16,28,0.88)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", backdropFilter: "blur(8px)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>DPE</div>
            {([["G","#EF4444"],["F","#F97316"],["E","#F59E0B"],["D","#6B7280"],["C/B/A","#10B981"]] as [string,string][]).map(([cls, col]) => (
              <div key={cls} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>{cls}</span>
              </div>
            ))}
          </div>
        )}

        {/* Parcel legend */}
        {parcellesOn && (
          <div style={{ position: "absolute", bottom: hasDpe ? 175 : 40, left: 12, zIndex: 1000, background: "rgba(10,16,28,0.88)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", backdropFilter: "blur(8px)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Parcelles</div>
            {([["Signal de vente","#F97316"],["Aucun signal","#818CF8"]] as [string,string][]).map(([lbl, col]) => (
              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <div style={{ width: 12, height: 10, borderRadius: 2, background: col, opacity: 0.7, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{lbl}</span>
              </div>
            ))}
            {mapZoom < 15 && <div style={{ fontSize: 9, color: "#F97316", marginTop: 4 }}>Zoom in pour voir les parcelles</div>}
          </div>
        )}

        {/* Contrôles */}
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 1000, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* Plan / Satellite */}
          <div style={{ display: "flex", background: "rgba(10,16,28,0.88)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 3, gap: 2, backdropFilter: "blur(8px)" }}>
            {([["Plan", false],["Satellite", true]] as [string,boolean][]).map(([label, sat]) => (
              <button key={label} onClick={() => setIsSat(sat)}
                style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: isSat===sat ? "rgba(255,255,255,0.15)" : "transparent", color: isSat===sat ? "#fff" : "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
          {/* Parcelles toggle */}
          <button onClick={() => setParcellesOn(o => !o)}
            style={{ padding: "4px 10px", background: parcellesOn ? "rgba(129,140,248,0.25)" : "rgba(10,16,28,0.88)", border: `1px solid ${parcellesOn ? "rgba(129,140,248,0.6)" : "rgba(255,255,255,0.12)"}`, borderRadius: 8, color: parcellesOn ? "#818CF8" : "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(8px)", transition: "all 0.15s" }}>
            Parcelles cadastrales
          </button>
          {/* Google Maps 3D */}
          <a href={googleMaps3DUrl} target="_blank" rel="noopener noreferrer"
            style={{ padding: "4px 10px", background: "rgba(10,16,28,0.88)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600, textDecoration: "none", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Vue 3D
          </a>
        </div>
      </div>
    </>
  );
}
