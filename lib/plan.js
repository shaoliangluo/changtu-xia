/** Safe canvas budget. Keeps a single tile under both the dimension cap and a memory cap. */
export const MAX_DIM = 16384;
export const SAFE_PIXELS = 100_000_000;
export const MAX_FRAMES = 250;

/**
 * Scroll offsets that cover `total` using a viewport of `viewport`.
 * The last stop lands on the true bottom so the tail is never dropped.
 * Middle stops overlap only when the remainder is shorter than one viewport.
 */
export function scrollStops(total, viewport) {
  const size = Math.max(0, Math.round(Number(total) || 0));
  const view = Math.max(1, Math.round(Number(viewport) || 1));
  if (size <= view) return [0];
  const max = size - view;
  const stops = [];
  for (let pos = 0; pos < max; pos += view) stops.push(pos);
  if (stops[stops.length - 1] !== max) stops.push(max);
  return stops;
}

export function layoutTiles(fullW, fullH) {
  const width = Math.max(1, Math.round(fullW));
  const height = Math.max(1, Math.round(fullH));
  const tileW = Math.min(width, MAX_DIM);
  const tileH = Math.max(1, Math.min(height, MAX_DIM, Math.floor(SAFE_PIXELS / tileW)));
  const tiles = [];
  for (let y = 0; y < height; y += tileH) {
    for (let x = 0; x < width; x += tileW) {
      tiles.push({
        x,
        y,
        w: Math.min(tileW, width - x),
        h: Math.min(tileH, height - y),
      });
    }
  }
  return tiles;
}

/** Intersection of a placed sprite and a tile, in both sprite space and tile space. */
export function intersectBlit(sprite, tile) {
  const x0 = Math.max(sprite.x, tile.x);
  const y0 = Math.max(sprite.y, tile.y);
  const x1 = Math.min(sprite.x + sprite.w, tile.x + tile.w);
  const y1 = Math.min(sprite.y + sprite.h, tile.y + tile.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    sx: x0 - sprite.x,
    sy: y0 - sprite.y,
    sw: x1 - x0,
    sh: y1 - y0,
    dx: x0 - tile.x,
    dy: y0 - tile.y,
  };
}

/** Pull a slice up by a pixel or two so rounding cannot leave a hairline gap. */
export function closeGap(desired, covered) {
  if (desired > covered) return covered;
  return desired;
}
