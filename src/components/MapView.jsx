import { useEffect, useRef, useState, useCallback } from 'react';
import Map, { NavigationControl, ScaleControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addCogProtocol, TILE_SIZE } from '../lib/cogProtocol';
import Legend from './Legend';

// The COG URL — uses Vite's BASE_URL so it works both in dev and on GitHub Pages
const COG_URL = `${import.meta.env.BASE_URL}DeltaX_Atchafalaya_Terrebonne_channels_vv.tif`;

// Atchafalaya Basin centre
const INITIAL_VIEW = {
  longitude: -91.1,
  latitude: 29.4,
  zoom: 10,
};

// Lightweight OSM-compatible style (no API key needed)
const MAP_STYLE = {
  version: 8,
  name: 'Dark Base',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export default function MapView() {
  const mapRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  // Register the COG protocol once
  useEffect(() => {
    addCogProtocol(maplibregl, COG_URL);
    return () => {
      maplibregl.removeProtocol('cog');
    };
  }, []);

  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Add COG raster tile source
    map.addSource('cog-source', {
      type: 'raster',
      tiles: ['cog://{z}/{x}/{y}'],
      tileSize: TILE_SIZE,
      minzoom: 6,
      maxzoom: 15,
    });

    // Add COG layer on top of the basemap
    map.addLayer({
      id: 'cog-layer',
      type: 'raster',
      source: 'cog-source',
      paint: {
        'raster-opacity': 0.85,
        'raster-fade-duration': 0,
      },
    });

    setLoaded(true);
  }, []);

  return (
    <div className="map-wrapper">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        onLoad={onMapLoad}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={true}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" />
      </Map>

      {/* Info header */}
      <div className="info-panel">
        <h1>COG Viewer</h1>
        <p className="subtitle">DeltaX Atchafalaya · Channel Classification VV</p>
        {!loaded && <p className="loading-hint">Loading COG tiles…</p>}
      </div>

      {/* Legend */}
      <Legend />
    </div>
  );
}
