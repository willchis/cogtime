/**
 * COG Protocol for MapLibre
 *
 * Reads a Cloud Optimized GeoTIFF (COG) client-side and serves it as
 * raster tiles to MapLibre via a custom `cog://` protocol.
 *
 * KEY CHALLENGE — Projection Mismatch:
 *   The COG is stored in EPSG:4326 (geographic lat/lon), where pixels are
 *   evenly spaced in degrees. But MapLibre tiles use Web Mercator (EPSG:3857),
 *   which has NON-LINEAR latitude spacing — stretching more near the poles.
 *
 *   A naive approach (linearly resampling a source window to 256×256) would
 *   cause visible Y-axis distortion when zoomed out, because Mercator tile
 *   rows don't map evenly to latitudes. The distortion is negligible at high
 *   zoom (small lat range per tile) but very noticeable at low zoom.
 *
 *   SOLUTION: For each output pixel, we compute its actual lat/lon using
 *   Mercator math, then map that coordinate back to the source raster's pixel
 *   space. This per-pixel reprojection correctly handles the non-linear
 *   Mercator latitude warping. The X axis doesn't need this — Mercator's
 *   longitude spacing is linear, same as EPSG:4326.
 *
 * COG EFFICIENCY:
 *   We use GeoTIFF.js's `readRasters({ window })` with pixel coordinates
 *   (not bbox) so that only the needed internal tiles are fetched via HTTP
 *   range requests. We also select the best overview level for the zoom,
 *   avoiding reading full-resolution data when zoomed out.
 */
import { fromUrl } from 'geotiff';

// ─── COG cache ───────────────────────────────────────────────────────
let tiffPromise = null;
let tiffMeta = null;

async function getTiff(url) {
  if (!tiffPromise) {
    tiffPromise = fromUrl(url);
  }
  const tiff = await tiffPromise;

  if (!tiffMeta) {
    const image = await tiff.getImage(0);
    const origin = image.getOrigin();         // [originX, originY]
    const resolution = image.getResolution(); // [resX, resY] (resY < 0)
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox();       // [minX, minY, maxX, maxY]

    const imageCount = await tiff.getImageCount();
    const overviews = [{ index: 0, width, height }];
    for (let i = 1; i < imageCount; i++) {
      const img = await tiff.getImage(i);
      overviews.push({ index: i, width: img.getWidth(), height: img.getHeight() });
    }

    tiffMeta = { origin, resolution, width, height, bbox, overviews };
  }
  return { tiff, meta: tiffMeta };
}

// ─── Colormap ────────────────────────────────────────────────────────
function colormap(t) {
  const r = Math.max(0, Math.min(255, Math.round(255 * (0.267 + 2.2 * t * t - 1.8 * t * t * t))));
  const g = Math.max(0, Math.min(255, Math.round(255 * (0.004 + t * (1.55 - 0.65 * t)))));
  const b = Math.max(0, Math.min(255, Math.round(255 * (0.329 + 0.85 * t - 1.3 * t * t + 0.5 * t * t * t))));
  return [r, g, b];
}

// ─── Mercator helpers ────────────────────────────────────────────────

/**
 * Convert Web Mercator tile coords (z/x/y) to an EPSG:4326 bounding box.
 * X is linear (simple division of 360°), but Y uses the inverse Mercator
 * formula — this is where the non-linear lat spacing originates.
 */
function tileToBBox(z, x, y) {
  const n = Math.pow(2, z);
  const lonMin = (x / n) * 360 - 180;
  const lonMax = ((x + 1) / n) * 360 - 180;
  const latMax = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latMin = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return [lonMin, latMin, lonMax, latMax];
}

/**
 * For a given Mercator tile row (0..TILE_SIZE-1), return the latitude.
 *
 * This is the heart of the reprojection fix. In a Mercator tile, pixel
 * rows are evenly spaced in Mercator-Y, but NOT evenly spaced in latitude.
 * This function converts a pixel row to its true latitude using the
 * inverse Mercator formula, so we can then look up the correct source
 * pixel in the EPSG:4326 raster.
 *
 * At high zoom the difference is negligible (small lat range per tile),
 * but at low zoom a single tile can span several degrees of latitude,
 * making the non-linearity clearly visible if not accounted for.
 */
function tileRowToLat(z, y, row, tileSize) {
  const n = Math.pow(2, z);
  // Fractional tile y for this pixel row
  const tileY = y + row / tileSize;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n)));
  return (latRad * 180) / Math.PI;
}

function bboxOverlaps(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

// ─── COG pixel math ─────────────────────────────────────────────────

/**
 * Convert a geographic bbox to a pixel window in an overview image,
 * using the full-res geotransform.
 */
function bboxToWindow(tileBbox, meta, ovWidth, ovHeight) {
  const [originX, originY] = meta.origin;
  const [resX, resY] = meta.resolution;

  const pxLeft = (tileBbox[0] - originX) / resX;
  const pxRight = (tileBbox[2] - originX) / resX;
  const pxTop = (tileBbox[3] - originY) / resY;
  const pxBottom = (tileBbox[1] - originY) / resY;

  const scaleX = ovWidth / meta.width;
  const scaleY = ovHeight / meta.height;

  return [
    Math.max(0, Math.floor(pxLeft * scaleX)),
    Math.max(0, Math.floor(pxTop * scaleY)),
    Math.min(ovWidth, Math.ceil(pxRight * scaleX)),
    Math.min(ovHeight, Math.ceil(pxBottom * scaleY)),
  ];
}

/**
 * Convert a latitude to a pixel row in an overview image.
 * This is a linear mapping because the COG is in EPSG:4326 (regular grid).
 * The geotransform gives us: row = (lat - originY) / resY
 */
function latToOverviewRow(lat, meta, ovHeight) {
  const [, originY] = meta.origin;
  const [, resY] = meta.resolution;
  const fullRow = (lat - originY) / resY;
  return (fullRow / meta.height) * ovHeight;
}

/** Convert a longitude to a column in an overview image. */
function lonToOverviewCol(lon, meta, ovWidth) {
  const [originX] = meta.origin;
  const [resX] = meta.resolution;
  const fullCol = (lon - originX) / resX;
  return (fullCol / meta.width) * ovWidth;
}

/** Pick the best overview for a tile's resolution. */
function pickOverview(meta, tileBbox) {
  const tileRes = (tileBbox[2] - tileBbox[0]) / TILE_SIZE;
  const fullRes = Math.abs(meta.resolution[0]);
  let best = meta.overviews[0];

  for (let i = meta.overviews.length - 1; i >= 0; i--) {
    const ov = meta.overviews[i];
    const ovRes = (fullRes * meta.width) / ov.width;
    if (ovRes <= tileRes * 2) {
      best = ov;
      break;
    }
  }
  return best;
}

/** Return a transparent 1×1 PNG ArrayBuffer. */
async function transparentTile() {
  const c = new OffscreenCanvas(1, 1);
  c.getContext('2d');
  const blob = await c.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

// ─── Constants ───────────────────────────────────────────────────────
const TILE_SIZE = 256;
const NODATA = -9999;
const DATA_MIN = -1;
const DATA_MAX = 2;

// ─── Protocol ────────────────────────────────────────────────────────

/**
 * Register a `cog://` protocol with MapLibre.
 *
 * For each tile request:
 *   1. Pick the best overview for the zoom level
 *   2. Read the pixel window from the overview via HTTP range request
 *   3. Reproject from EPSG:4326 to Web Mercator per-row to avoid
 *      Y-axis distortion at lower zoom levels
 */
export function addCogProtocol(maplibregl, cogUrl) {
  maplibregl.addProtocol('cog', async (params, abortController) => {
    const parts = params.url.replace('cog://', '').split('/');
    const z = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);

    const tileBbox = tileToBBox(z, x, y);

    try {
      const { tiff, meta } = await getTiff(cogUrl);

      if (!bboxOverlaps(tileBbox, meta.bbox)) {
        return { data: await transparentTile() };
      }

      // Pick overview and read the pixel window at native resolution
      const ov = pickOverview(meta, tileBbox);
      const image = await tiff.getImage(ov.index);
      const [left, top, right, bottom] = bboxToWindow(tileBbox, meta, ov.width, ov.height);

      if (right <= left || bottom <= top) {
        return { data: await transparentTile() };
      }

      // Read the source window at its native pixel resolution.
      // We do NOT let GeoTIFF.js resample to 256×256 here, because that
      // resampling would be linear in pixel space — which doesn't match
      // the non-linear Mercator Y spacing. Instead we read native pixels
      // and do the reprojection ourselves below.
      const srcW = right - left;
      const srcH = bottom - top;
      const rasters = await image.readRasters({
        window: [left, top, right, bottom],
        width: srcW,
        height: srcH,
        interleave: false,
        signal: abortController.signal,
      });

      const srcData = rasters[0];
      const range = DATA_MAX - DATA_MIN || 1;

      // ── Per-pixel reprojection: EPSG:4326 → Web Mercator ──────────
      // For each output pixel in the 256×256 Mercator tile:
      //   1. Compute its true lat/lon (lat is non-linear in Mercator)
      //   2. Map that lat/lon back to a source raster pixel coordinate
      //   3. Sample the source raster (nearest-neighbour)
      //
      // The X axis (longitude) is linear in both projections, so it's
      // a simple lerp. Only the Y axis needs the Mercator correction.
      const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

      for (let outY = 0; outY < TILE_SIZE; outY++) {
        // Latitude for this Mercator tile row (non-linear spacing)
        const lat = tileRowToLat(z, y, outY, TILE_SIZE);
        // Map latitude to overview pixel row
        const srcRow = latToOverviewRow(lat, meta, ov.height) - top;

        for (let outX = 0; outX < TILE_SIZE; outX++) {
          const off = (outY * TILE_SIZE + outX) * 4;

          // Longitude for this column (linear)
          const lon = tileBbox[0] + (outX / TILE_SIZE) * (tileBbox[2] - tileBbox[0]);
          const srcCol = lonToOverviewCol(lon, meta, ov.width) - left;

          // Nearest-neighbour sample
          const si = Math.round(srcCol);
          const sj = Math.round(srcRow);

          if (si < 0 || si >= srcW || sj < 0 || sj >= srcH) {
            rgba[off + 3] = 0; // out of bounds → transparent
            continue;
          }

          const v = srcData[sj * srcW + si];
          if (v === NODATA || v <= NODATA + 1 || isNaN(v)) {
            rgba[off + 3] = 0;
          } else {
            const t = Math.max(0, Math.min(1, (v - DATA_MIN) / range));
            const [r, g, b] = colormap(t);
            rgba[off] = r;
            rgba[off + 1] = g;
            rgba[off + 2] = b;
            rgba[off + 3] = 200;
          }
        }
      }

      const imageData = new ImageData(rgba, TILE_SIZE, TILE_SIZE);
      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
      const ctx = canvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return { data: await blob.arrayBuffer() };
    } catch (err) {
      if (err.name === 'AbortError') return { data: new ArrayBuffer(0) };
      console.warn(`COG tile error [${z}/${x}/${y}]:`, err);
      return { data: await transparentTile() };
    }
  });
}

export { TILE_SIZE, DATA_MIN, DATA_MAX, colormap };
