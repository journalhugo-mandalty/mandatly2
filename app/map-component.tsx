"use client";
import { useEffect, useRef, useState } from "react";

type Prospect = {
  id: any;
  adresse: string;
  ville: string;
  score: number;
  source: string;
  notes: string;
  lat: number;
  lng: number;
};

type Props = {
  prospects: Prospect[];
  onSelect?: (p: Prospect) => void;
  center: [number, number];
  dark?: boolean;
};

export default function MapComponent({ prospects, onSelect, center, dark = true }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const prevCenter = useRef<[number,number]>(center);

  // Init map once
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
      const map = L.map(mapRef.current, {
        center: [44.837, -0.579],
        zoom: 6,
        zoomControl: false,
        attributionControl: false,
      });

      const tile = dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      L.tileLayer(tile, { maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      mapInstance.current = map;
      setReady(true);
    };
    document.head.appendChild(script);

    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  // Animate to new center when it changes
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    const [prevLat, prevLng] = prevCenter.current;
    const [newLat, newLng] = center;
    if (Math.abs(prevLat - newLat) < 0.001 && Math.abs(prevLng - newLng) < 0.001) return;

    prevCenter.current = center;

    // Step 1: zoom out smoothly
    map.flyTo([prevLat, prevLng], 5, { animate: true, duration: 0.8 });

    // Step 2: fly to new city and zoom in
    setTimeout(() => {
      map.flyTo([newLat, newLng], 13, { animate: true, duration: 1.4 });
    }, 900);
  }, [center[0], center[1], ready]);

  // Update markers when prospects change
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const L = (window as any).L;
    const map = mapInstance.current;

    // Remove old markers
    markers.current.forEach(m => m.remove());
    markers.current = [];

    prospects.forEach(p => {
      if (!p.lat || !p.lng) return;

      const color = p.score >= 85 ? "#10B981" : p.score >= 70 ? "#F59E0B" : p.score >= 50 ? "#EF4444" : "#6B7280";
      const size = p.score >= 85 ? 36 : p.score >= 70 ? 32 : 28;

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;box-shadow:0 2px 12px ${color}60;cursor:pointer;font-family:-apple-system,sans-serif;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${p.score}</div>`,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);

      // Click: select in left panel (no popup)
      marker.on("click", () => {
        if (onSelect) onSelect(p);
      });

      markers.current.push(marker);
    });
  }, [ready, prospects, dark]);

  return (
    <>
      <style>{`.leaflet-container{font-family:-apple-system,sans-serif;}`}</style>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}
