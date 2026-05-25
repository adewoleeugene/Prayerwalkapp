'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's broken default icon paths when bundled by webpack/turbopack
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export type LatLng = { latitude: number; longitude: number };

export type LeafletMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
  color?: string;
};

export type LeafletMapPolyline = {
  id: string;
  coordinates: LatLng[];
  color?: string;
  width?: number;
};

export type LeafletMapHandle = {
  centerOn: (center: LatLng, zoom?: number) => void;
  fitToCoordinates: (coordinates: LatLng[]) => void;
};

type Props = {
  initialCenter: LatLng;
  initialZoom?: number;
  markers?: LeafletMapMarker[];
  polylines?: LeafletMapPolyline[];
  onMarkerPress?: (markerId: string) => void;
  className?: string;
};

function makeDivIcon(color: string) {
  return L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:9px;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`,
  });
}

// Inner component that has access to the map instance via useMap()
function MapController({
  controllerRef,
}: {
  controllerRef: React.MutableRefObject<LeafletMapHandle | null>;
}) {
  const map = useMap();

  useEffect(() => {
    controllerRef.current = {
      centerOn: (center, zoom) => {
        map.setView([center.latitude, center.longitude], zoom ?? map.getZoom(), { animate: true });
      },
      fitToCoordinates: (coordinates) => {
        if (!coordinates || coordinates.length === 0) return;
        const bounds = L.latLngBounds(coordinates.map((c) => [c.latitude, c.longitude]));
        map.fitBounds(bounds, { padding: [36, 36], animate: true });
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [map, controllerRef]);

  return null;
}

const PwaMap = forwardRef<LeafletMapHandle, Props>(function PwaMap(
  {
    initialCenter,
    initialZoom = 13,
    markers = [],
    polylines = [],
    onMarkerPress,
    className,
  },
  ref
) {
  const controllerRef = useRef<LeafletMapHandle | null>(null);

  useImperativeHandle(ref, () => ({
    centerOn: (center, zoom) => controllerRef.current?.centerOn(center, zoom),
    fitToCoordinates: (coords) => controllerRef.current?.fitToCoordinates(coords),
  }));

  return (
    <MapContainer
      center={[initialCenter.latitude, initialCenter.longitude]}
      zoom={initialZoom}
      className={className ?? 'h-full w-full'}
      zoomControl={true}
    >
      <MapController controllerRef={controllerRef} />
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
        maxZoom={20}
      />
      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.latitude, m.longitude]}
          icon={makeDivIcon(m.color ?? '#2563EB')}
          eventHandlers={{ click: () => onMarkerPress?.(m.id) }}
        />
      ))}
      {polylines.map((p) => (
        <Polyline
          key={p.id}
          positions={p.coordinates.map((c) => [c.latitude, c.longitude])}
          color={p.color ?? '#2563EB'}
          weight={p.width ?? 5}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </MapContainer>
  );
});

export default PwaMap;
