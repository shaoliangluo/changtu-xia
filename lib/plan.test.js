import { closeGap, intersectBlit, layoutTiles, scrollStops, MAX_FRAMES } from "./plan.js";

let failed = 0;

function eq(actual, expected, name) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got !== want) {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${got}\n  want ${want}`);
  }
}

eq(scrollStops(800, 1000), [0], "shorter than one viewport");
eq(scrollStops(2000, 1000), [0, 1000], "exact two screens");
eq(scrollStops(2500, 1000), [0, 1000, 1500], "tail overlap");
eq(scrollStops(1000, 800), [0, 200], "short tail");
eq(scrollStops(0, 800), [0], "empty page");

const tiles = layoutTiles(4000, 50000);
eq(tiles[0], { x: 0, y: 0, w: 4000, h: 16384 }, "first tile capped");
eq(tiles.length, 4, "tall page splits into four tiles");
eq(tiles[tiles.length - 1].y + tiles[tiles.length - 1].h, 50000, "tiles cover the bottom");

const wide = layoutTiles(20000, 3000);
eq(wide.length > 1, true, "wide page splits");
eq(wide[0].w, 16384, "wide tile respects max dimension");
eq(wide[wide.length - 1].x + wide[wide.length - 1].w, 20000, "wide tiles cover the right edge");

eq(
  intersectBlit({ x: 0, y: 1000, w: 500, h: 400 }, { x: 0, y: 1200, w: 800, h: 800 }),
  { sx: 0, sy: 200, sw: 500, sh: 200, dx: 0, dy: 0 },
  "sprite crosses the top of a tile",
);
eq(intersectBlit({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 }), null, "no overlap");

eq(closeGap(1002, 1000), 1000, "close a hairline gap");
eq(closeGap(900, 1000), 900, "keep a real overlap");
eq(MAX_FRAMES < 1000, true, "frame cap stays conservative");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("plan ok");
