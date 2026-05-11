"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: number;
  adresse: string;
  ville: string;
  score: number;
  source: string;
  notes: string;
  lat: number;
  lng: number;
  prix_achat?: number;
  date_achat?: string;
  surface?: number;
  type_bien?: string;
};

type Props = {
  prospects: Prospect[];
  onSelect?: (p: Prospect) => void;
  center?: [number, number];
  zoom?: number;
  dark?: boolean;
};

export default function MapComponent({ prospects, onSelect, center = [44.837, -0.579], zoom = 13, dark = true }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Load Leaflet CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    // Load Leaflet JS
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      const L = (window as any).L;

      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: false,
        attributionControl: false,
      });

      // Dark or light tile
      const tileUrl = dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

      L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      mapInstance.current = map;
      setReady(true);
    };
    document.head.appendChild(script);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Animate map to new center when it changes
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    // Zoom out, fly to new center, zoom in
    map.setZoom(6, { animate: true, duration: 0.5 });
    setTimeout(() => {
      map.flyTo(center, 13, { animate: true, duration: 1.2 });
    }, 500);
  }, [center[0], center[1], ready]);

  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;

    // Clear old markers
    markers.current.forEach(m => m.remove());
    markers.current = [];

    // Add prospect markers
    prospects.forEach(p => {
      if (!p.lat || !p.lng) return;

      const color = p.score >= 85 ? "#10B981" : p.score >= 70 ? "#F59E0B" : p.score >= 50 ? "#EF4444" : "#6B7280";
      const size = p.score >= 85 ? 36 : p.score >= 70 ? 32 : 28;

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="
            width:${size}px;height:${size}px;border-radius:50%;
            background:${color};
            border:2px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"};
            display:flex;align-items:center;justify-content:center;
            color:white;font-size:11px;font-weight:700;
            box-shadow:0 2px 12px ${color}60;
            cursor:pointer;
            font-family:-apple-system,sans-serif;
            transition:transform 0.15s;
          " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">${p.score}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const popupBg = dark ? "#141414" : "#FFFFFF";
      const popupText = dark ? "#FAFAFA" : "#0A0A0A";
      const popupMuted = dark ? "#525252" : "#A3A3A3";
      const popupBorder = dark ? "#1C1C1C" : "#F0F0F0";

      const marker = L.marker([p.lat, p.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:-apple-system,sans-serif;min-width:200px;background:${popupBg};border:1px solid ${popupBorder};border-radius:10px;padding:14px;margin:-14px;">
            <div style="font-size:12px;font-weight:600;color:${popupText};margin-bottom:4px;">${p.adresse}</div>
            <div style="font-size:11px;color:${popupMuted};margin-bottom:8px;">${p.ville} · ${p.source}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
              <div style="width:8px;height:8px;border-radius:50%;background:${color};"></div>
              <span style="font-size:11px;font-weight:600;color:${color};">Score ${p.score}/100</span>
            </div>
            <div style="font-size:11px;color:${popupMuted};line-height:1.5;">${p.notes}</div>
          </div>
        `, {
          maxWidth: 240,
          className: "mandatly-popup"
        });

      if (onSelect) marker.on("click", () => onSelect(p));
      markers.current.push(marker);
    });
  }, [ready, prospects, dark]);

  return (
    <>
      <style>{`
        .mandatly-popup .leaflet-popup-content-wrapper {
          background: transparent !important;
          border: none !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
          border-radius: 10px !important;
          padding: 0 !important;
        }
        .mandatly-popup .leaflet-popup-tip { display: none; }
        .mandatly-popup .leaflet-popup-content { margin: 0 !important; }
        .leaflet-container { font-family: -apple-system, sans-serif; }
      `}</style>
      <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: "inherit" }} />
    </>
  );
}
