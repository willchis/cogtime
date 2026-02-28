# COG Viewer

A frontend-only viewer for [Cloud Optimized GeoTIFFs](https://www.cogeo.org/) (COGs). Renders raster data over an interactive map — no backend needed.

Built with **React** + **react-map-gl** + **MapLibre GL JS** + **GeoTIFF.js**.

## How it Works

```
Browser (React + Vite)
├─ react-map-gl ← MapLibre GL JS (WebGL map)
│  └─ CARTO Dark basemap
│  └─ Custom "cog://" raster tile source
│     └─ cogProtocol.js → GeoTIFF.js
│        └─ HTTP range requests → static GeoTIFF
└─ UI: Info panel + Color legend
```

The key piece is a **custom MapLibre protocol** (`cog://`) in [`src/lib/cogProtocol.js`](src/lib/cogProtocol.js). For each map tile:

1. **Picks the best overview** level from the COG for the current zoom
2. **Reads only the needed pixels** via HTTP range requests (no full file download)
3. **Reprojects per-pixel** from EPSG:4326 → Web Mercator to avoid Y-axis distortion
4. **Applies a colormap** and returns the tile as a PNG to MapLibre

### Tile Rendering Pipeline

MapLibre's raster tile sources expect image data, not raw numeric arrays. So for each 256×256 tile, the protocol:

1. Reads raw pixel values from the COG (int16 data via HTTP range request)
2. Maps values through a colormap → RGBA pixels on an `OffscreenCanvas`
3. Encodes the canvas as a **PNG blob** (`convertToBlob`)
4. Returns the PNG bytes to MapLibre for display

All of this happens in-browser — no server is generating images. The tradeoff is a small per-tile overhead from PNG encode/decode. An alternative would be rendering directly to WebGL textures (skipping the PNG round-trip), but that requires writing a custom MapLibre layer with shaders.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:5173/
```

## Project Structure

```
src/
├── lib/
│   └── cogProtocol.js    # Custom MapLibre COG protocol (core logic)
├── components/
│   ├── MapView.jsx       # Map component with react-map-gl
│   └── Legend.jsx         # Floating color legend
├── App.jsx               # Root component
├── main.jsx              # Entry point
└── index.css             # Dark glassmorphism theme
public/
└── DeltaX_...tif         # GeoTIFF (symlinked from project root)
```

## Deploy to GitHub Pages

```bash
./build-ghpages.sh <repo-name>   # builds with correct base path
npx gh-pages -d dist             # deploys dist/ to gh-pages branch
```

The build script temporarily sets the Vite `base` path to `/<repo-name>/`, builds, then restores the config for local dev. See [`build-ghpages.sh`](build-ghpages.sh) for details.

## Using a Different GeoTIFF

1. Place your COG in the project root
2. Symlink it into `public/`: `ln -s $(pwd)/your-file.tif public/your-file.tif`
3. Update `COG_URL` in [`src/components/MapView.jsx`](src/components/MapView.jsx)
4. Adjust `DATA_MIN`, `DATA_MAX`, `NODATA` in [`src/lib/cogProtocol.js`](src/lib/cogProtocol.js) to match your dataset
5. Update `INITIAL_VIEW` in `MapView.jsx` to center on your data's extent

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React (Vite) |
| Map | [react-map-gl](https://visgl.github.io/react-map-gl/) + [MapLibre GL JS](https://maplibre.org/) |
| COG decoding | [GeoTIFF.js](https://geotiffjs.github.io/) |
| Basemap | [CARTO Dark Matter](https://carto.com/basemaps/) (no API key) |
