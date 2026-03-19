import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { LEAFLET_CSS, LEAFLET_JS } from './leafletBundledAssets';

type LatLng = {
    latitude: number;
    longitude: number;
};

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

type MapPayload = {
    center: LatLng;
    zoom: number;
    markers: LeafletMapMarker[];
    polylines: LeafletMapPolyline[];
};

type LeafletMapProps = {
    style?: StyleProp<ViewStyle>;
    initialCenter: LatLng;
    initialZoom?: number;
    markers?: LeafletMapMarker[];
    polylines?: LeafletMapPolyline[];
    onMarkerPress?: (markerId: string) => void;
    onPolylinePress?: (polylineId: string) => void;
    onReady?: () => void;
};

export type LeafletMapHandle = {
    centerOn: (center: LatLng, zoom?: number) => void;
    fitToCoordinates: (coordinates: LatLng[]) => void;
};

const initialHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      ${LEAFLET_CSS}

      html, body, #map {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #f4f7fb;
      }
      .leaflet-container {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .leaflet-popup-content-wrapper {
        border-radius: 12px;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      ${LEAFLET_JS}

      let map;
      let markersLayer;
      let polylinesLayer;

      function postMessage(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }

      function escapeHtml(input) {
        return String(input)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function makeDivIcon(color) {
        return L.divIcon({
          className: '',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          html: '<div style="width:18px;height:18px;border-radius:9px;background:' + color + ';border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>'
        });
      }

      function renderMarkers(markers) {
        markersLayer.clearLayers();
        markers.forEach(function(marker) {
          const leafletMarker = L.marker(
            [marker.latitude, marker.longitude],
            { icon: makeDivIcon(marker.color || '#2563EB') }
          );

          if (marker.title || marker.description) {
            const title = marker.title ? '<strong>' + escapeHtml(marker.title) + '</strong>' : '';
            const desc = marker.description ? '<div style="margin-top:4px;">' + escapeHtml(marker.description) + '</div>' : '';
            leafletMarker.bindPopup(title + desc);
          }

          leafletMarker.on('click', function() {
            postMessage({ type: 'markerPress', id: marker.id });
          });

          leafletMarker.addTo(markersLayer);
        });
      }

      function renderPolylines(polylines) {
        polylinesLayer.clearLayers();
        polylines.forEach(function(polyline) {
          const line = L.polyline(
            polyline.coordinates.map(function(point) { return [point.latitude, point.longitude]; }),
            {
              color: polyline.color || '#2563EB',
              weight: polyline.width || 5,
              lineCap: 'round',
              lineJoin: 'round'
            }
          );

          line.on('click', function() {
            postMessage({ type: 'polylinePress', id: polyline.id });
          });

          line.addTo(polylinesLayer);
        });
      }

      function applyPayload(payload) {
        if (!map) return;
        renderMarkers(payload.markers || []);
        renderPolylines(payload.polylines || []);
      }

      function initializeMap() {
        if (!window.L) {
          setTimeout(initializeMap, 50);
          return;
        }

        map = L.map('map', { zoomControl: true }).setView([8.4657, -13.2317], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20
        }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        polylinesLayer = L.layerGroup().addTo(map);

        window.__leafletBridge = {
          update: function(payload) {
            applyPayload(payload);
          },
          centerOn: function(center, zoom) {
            if (!map) return;
            map.setView([center.latitude, center.longitude], zoom || map.getZoom(), { animate: true });
          },
          fitToCoordinates: function(coordinates) {
            if (!map || !coordinates || coordinates.length === 0) return;
            const bounds = L.latLngBounds(coordinates.map(function(point) {
              return [point.latitude, point.longitude];
            }));
            map.fitBounds(bounds, { padding: [36, 36], animate: true });
          }
        };

        postMessage({ type: 'ready' });
      }

      initializeMap();
    </script>
  </body>
</html>`;

export const LeafletMap = forwardRef<LeafletMapHandle, LeafletMapProps>(function LeafletMap(
    {
        style,
        initialCenter,
        initialZoom = 13,
        markers = [],
        polylines = [],
        onMarkerPress,
        onPolylinePress,
        onReady,
    },
    ref
) {
    const webViewRef = useRef<WebView>(null);
    const [isReady, setIsReady] = useState(false);

    const payload = useMemo<MapPayload>(() => ({
        center: initialCenter,
        zoom: initialZoom,
        markers,
        polylines,
    }), [initialCenter, initialZoom, markers, polylines]);

    const runScript = (script: string) => {
        if (!isReady) return;
        webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
    };

    useImperativeHandle(ref, () => ({
        centerOn: (center, zoom) => {
            runScript(`window.__leafletBridge && window.__leafletBridge.centerOn(${JSON.stringify(center)}, ${JSON.stringify(zoom ?? null)});`);
        },
        fitToCoordinates: (coordinates) => {
            runScript(`window.__leafletBridge && window.__leafletBridge.fitToCoordinates(${JSON.stringify(coordinates)});`);
        },
    }), [isReady]);

    useEffect(() => {
        runScript(`window.__leafletBridge && window.__leafletBridge.update(${JSON.stringify(payload)});`);
    }, [payload, isReady]);

    useEffect(() => {
        if (!isReady) return;
        runScript(`window.__leafletBridge && window.__leafletBridge.centerOn(${JSON.stringify(initialCenter)}, ${initialZoom});`);
    }, [initialCenter, initialZoom, isReady]);

    return (
        <View style={[styles.container, style]}>
            <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: initialHtml }}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                onMessage={(event) => {
                    try {
                        const message = JSON.parse(event.nativeEvent.data);
                        if (message.type === 'ready') {
                            setIsReady(true);
                            onReady?.();
                            return;
                        }

                        if (message.type === 'markerPress' && typeof message.id === 'string') {
                            onMarkerPress?.(message.id);
                            return;
                        }

                        if (message.type === 'polylinePress' && typeof message.id === 'string') {
                            onPolylinePress?.(message.id);
                        }
                    } catch {
                        // Ignore malformed bridge messages.
                    }
                }}
                setSupportMultipleWindows={false}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
    },
    webview: {
        flex: 1,
        backgroundColor: 'transparent',
    },
});
