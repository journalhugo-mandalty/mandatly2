"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: any; adresse: string; ville: string; score: number;
  source: string; notes: string; lat: number; lng: number;
  proprietaire_nom?: string; classe_dpe?: string;
};
type Props = {
  prospects: Prospect[]; onSelect?: (p: Prospect) => void;
  center: [number, number]; dark?: boolean;
};

export default function MapComponent({ prospects, onSelect, center, dark = true }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const prevCenter = useRef<[number,number]>(center);

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
      const tile = dark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      L.tileLayer(tile, { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstance.current = map;
      setReady(true);
    };
    document.head.appendChild(script);
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

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
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;
    markers.current.forEach(m => m.remove());
    markers.current = [];
    prospects.forEach(p => {
      if (!p.lat || !p.lng) return;
      const col = p.score >= 85 ? "#10B981" : p.score >= 70 ? "#F59E0B" : p.score >= 50 ? "#EF4444" : "#6B7280";
      const sz = p.score >= 85 ? 36 : p.score >= 70 ? 32 : 28;
      const src = p.source === "DPE" ? ("DPE" + (p.classe_dpe ? " " + p.classe_dpe : "")) : "DVF";
      const own = p.proprietaire_nom ? `<div style="font-size:10px;color:#C4A35A;margin-top:3px;font-weight:600;">${p.proprietaire_nom}</div>` : "";
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${col};border:2px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;box-shadow:0 2px 12px ${col}60;cursor:pointer;font-family:-apple-system,sans-serif;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform='scale(1)'">${p.score}</div>`,
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

  return (
    <>
      <style>{`.leaflet-container{font-family:-apple-system,sans-serif;}.mandatly-tooltip{background:rgba(10,16,28,0.96)!important;border:1px solid rgba(196,163,90,0.3)!important;border-radius:8px!important;box-shadow:0 4px 20px rgba(0,0,0,0.5)!important;padding:8px 12px!important;color:#fff;}.mandatly-tooltip::before,.leaflet-tooltip-top.mandatly-tooltip::before{display:none!important;}`}</style>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}
