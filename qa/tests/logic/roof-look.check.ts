// The roof visualizer's engine (2026-10-25, lib/roofLook): the measured rings land on the aerial as a mask; a tap on
// a street photo grows the roof and stops at the sky, the wall and the lawn; the mask is cleaned (specks, holes,
// edge); the paint keeps the picture's own shading and turns the roof the material's colour, with the pattern in the
// roof's orientation; the colours and words. Pure, on synthetic pictures.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-look.check.ts
import { LOOK_FAMILIES, ROOF_COLORS, brushMask, cleanMask, defaultPeriod, fillHoles, growMask, hexToRgb, lookColor, lookWords, maskStats, measuredMask, normalizedPolygons, paintRoof, polygonMask, ringsToPixels, type Raster } from "@/lib/roofLook";
import { ROOF_FAMILIES } from "@/lib/roofPackage/catalog";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const raster = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Raster => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fill(x, y); const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h };
};
const inside = (x: number, y: number, poly: Array<[number, number]>) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const count = (m: Uint8Array, pred: (p: number) => boolean) => { let n = 0; for (let p = 0; p < m.length; p++) if (m[p] >= 128 && pred(p)) n++; return n; };
const mean = (img: Raster, m: Uint8Array) => { let r = 0, g = 0, b = 0, n = 0; for (let p = 0; p < m.length; p++) if (m[p] >= 128) { r += img.data[p * 4]; g += img.data[p * 4 + 1]; b += img.data[p * 4 + 2]; n++; } return [r / n, g / n, b / n]; };

console.log("— the colours and words —");
check("every roof family of the catalogue has colours and a label", ROOF_FAMILIES.every((f) => (ROOF_COLORS[f.id] ?? []).length >= 4 && LOOK_FAMILIES.some((l) => l.id === f.id)), ROOF_FAMILIES.map((f) => f.id).join(","));
check("a colour is read by id, the first stands in for an unknown one", lookColor({ family: "metal", colorId: "burgundy" }).name === "Burgundy" && lookColor({ family: "metal", colorId: "nope" }).id === ROOF_COLORS.metal[0].id);
check("the words", lookWords({ family: "metal", colorId: "charcoal" }) === "Standing-seam metal · Charcoal Gray" && hexToRgb("#7a2f33").join(",") === "122,47,51");

console.log("— the measured roof on the aerial —");
// a house outline 40×28 m around the pin at zoom 20 on a 640-px frame
const pin = { lat: 47.69, lng: -122.17 };
const dLat = 14 / 111_320, dLng = 20 / (111_320 * Math.cos((47.69 * Math.PI) / 180));
const ring = [{ lat: pin.lat + dLat, lng: pin.lng - dLng }, { lat: pin.lat + dLat, lng: pin.lng + dLng }, { lat: pin.lat - dLat, lng: pin.lng + dLng }, { lat: pin.lat - dLat, lng: pin.lng - dLng }];
const frame = { kind: "satellite" as const, lat: pin.lat, lng: pin.lng, zoom: 20, px: 640 };
const px = ringsToPixels([ring], frame, 640, 640);
const bx = px[0].map((p) => p[0]), by = px[0].map((p) => p[1]);
check("the rings project around the picture's centre, east to the right, north up", Math.abs((Math.min(...bx) + Math.max(...bx)) / 2 - 320) < 1 && Math.abs((Math.min(...by) + Math.max(...by)) / 2 - 320) < 1 && px[0][0][1] < px[0][2][1] && px[0][0][0] < px[0][1][0], JSON.stringify(px[0].map((p) => p.map(Math.round))));
const widthPx = Math.max(...bx) - Math.min(...bx);
check("at zoom 20 near Seattle, 40 m of house is about 400 px wide", widthPx > 350 && widthPx < 460, String(Math.round(widthPx)));
const mm = measuredMask([ring], frame, 640, 640, 0);
const area = count(mm, () => true);
check("the measured mask covers the rectangle and nothing else", Math.abs(area - widthPx * (Math.max(...by) - Math.min(...by))) / area < 0.03 && count(mm, (p) => p % 640 < Math.min(...bx) - 2) === 0, String(area));

console.log("— a tap on a street photo —");
// sky on top, a gray roof trapezoid, a beige wall under it, green lawn at the bottom; some shading on the roof
const ROOF: Array<[number, number]> = [[60, 60], [340, 60], [380, 170], [20, 170]];
const photo = raster(400, 300, (x, y) => {
  // two planes: the lit left plane, a step down to the shaded right plane at the ridge (x = 200), a gentle gradient on each
  if (inside(x, y, ROOF)) { const shade = (x < 200 ? 1 : 0.68) - 0.06 * ((x - 20) / 360); return [Math.round(96 * shade), Math.round(98 * shade), Math.round(102 * shade)]; }
  if (y < 80) return [150, 190, 235];
  if (y < 230) return [205, 190, 160];
  return [90, 150, 70];
});
const grown = growMask(photo, [200, 115], 45);
const roofPx = count(grown.mask, (p) => inside(p % 400, Math.floor(p / 400), ROOF));
const offPx = count(grown.mask, (p) => !inside(p % 400, Math.floor(p / 400), ROOF));
const roofArea = (() => { let n = 0; for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) if (inside(x, y, ROOF)) n++; return n; })();
check("the grow fills the whole shaded roof and stops at the sky, the wall and the lawn", roofPx > roofArea * 0.97 && offPx < roofArea * 0.02, `roof ${roofPx}/${roofArea}, off ${offPx}`);
const tight = growMask(photo, [120, 115], 4);   // a tap on the lit plane (the ridge is at x = 200)
check("a tight tolerance stays on the tapped plane, the step to the other plane stops it", tight.added > roofArea * 0.3 && tight.added < roofArea * 0.6 && count(tight.mask, (p) => p % 400 > 210) === 0, String(tight.added));
const skyTap = growMask(photo, [200, 20], 45);
check("a tap on the sky grows the sky, not the roof", count(skyTap.mask, (p) => inside(p % 400, Math.floor(p / 400), ROOF)) === 0 && skyTap.added > 400 * 50);
const wide = growMask(photo, [200, 115], 100);
check("the grow is capped — it never swallows the whole picture", wide.added <= 400 * 300 * 0.86);

console.log("— cleaning the mask —");
const dirty = new Uint8Array(grown.mask);
dirty[50 * 400 + 390] = 255; dirty[50 * 400 + 391] = 255;            // a speck in the sky
for (let y = 100; y < 110; y++) for (let x = 150; x < 160; x++) dirty[y * 400 + x] = 0;   // a hole in the roof
const cleaned = cleanMask(dirty, 400, 300, { feather: 0 });
check("the speck is dropped and the hole filled (a corner pixel or two may round off)", cleaned[50 * 400 + 390] === 0 && cleaned[105 * 400 + 155] === 255 && count(cleaned, () => true) >= roofPx * 0.985, `${count(cleaned, () => true)} vs ${roofPx}`);
const feathered = cleanMask(dirty, 400, 300, { feather: 2 });
let soft = 0; for (let p = 0; p < feathered.length; p++) if (feathered[p] > 0 && feathered[p] < 255) soft++;
check("the feathered edge has in-between values", soft > 200, String(soft));
const holed = polygonMask(100, 100, [[[10, 10], [90, 10], [90, 90], [10, 90]], [[40, 40], [60, 40], [60, 60], [40, 60]]]);
check("even-odd: a ring inside a ring is a hole; fillHoles fills it", holed[50 * 100 + 50] === 0 && fillHoles(holed, 100, 100)[50 * 100 + 50] === 255);
const bm = new Uint8Array(100 * 100); brushMask(bm, 100, 100, [50, 50], 10, true);
const bc = count(bm, () => true);
brushMask(bm, 100, 100, [50, 50], 5, false);
check("the brush adds a disc and takes one away", bc > 290 && bc < 340 && count(bm, () => true) < bc && bm[50 * 100 + 50] === 0, String(bc));

console.log("— the paint —");
const st = maskStats(grown.mask, 400, 300);
check("the mask's stats: area, box, centre, the long axis along the eave", st.area === grown.added && st.bbox !== null && st.bbox.w >= 350 && Math.abs(st.cx - 200) < 6 && Math.abs(st.angle) < 0.15, `${st.cx} ${st.angle}`);
const red = paintRoof(photo, grown.mask, { family: "metal", colorId: "burgundy" }, { period: 10 });
const paintedMean = mean({ data: red, width: 400, height: 300 }, grown.mask);
check("the roof turns the material's colour (reddish), the wall and the sky stay", paintedMean[0] > paintedMean[1] * 1.8 && red[(250 * 400 + 200) * 4 + 1] === 150 && red[(20 * 400 + 200) * 4 + 2] === 235, paintedMean.map(Math.round).join(","));
// the shading survives: the roof's left (lit) is brighter than its right (shaded) after the paint, as before
const L = (x: number) => red[(115 * 400 + x) * 4] + red[(115 * 400 + x) * 4 + 1] + red[(115 * 400 + x) * 4 + 2];
let lit = 0, shaded = 0; for (let x = 40; x < 100; x++) lit += L(x); for (let x = 300; x < 360; x++) shaded += L(x);
check("the picture's own shading survives: the lit side stays brighter than the shaded side", lit > shaded * 1.1, `${lit} vs ${shaded}`);
const flat = paintRoof(photo, grown.mask, { family: "metal", colorId: "burgundy" }, { period: 0, shading: 0 });
let v = 0, n = 0; for (let y = 90; y < 140; y++) for (let x = 100; x < 300; x++) { v += flat[(y * 400 + x) * 4]; n++; }
let vv = 0; for (let y = 90; y < 140; y++) for (let x = 100; x < 300; x++) vv += Math.abs(flat[(y * 400 + x) * 4] - v / n);
check("with no shading and no pattern the roof is one flat colour", vv / n < 2, String(vv / n));
const seams = paintRoof(photo, grown.mask, { family: "metal", colorId: "galvalume" }, { period: 12, strength: 1, shading: 0 });
let darkLines = 0; for (let x = 100; x < 300; x++) if (seams[(115 * 400 + x) * 4] < seams[(115 * 400 + x + 3) * 4] * 0.85) darkLines++;
check("standing seams draw as regular dark lines across the roof", darkLines >= 8, String(darkLines));
check("a shingle period follows the roof's size in the picture", defaultPeriod("asphalt", st) > 5 && defaultPeriod("metal", st) > defaultPeriod("asphalt", st));
const untouched = paintRoof(photo, new Uint8Array(400 * 300), { family: "asphalt", colorId: "charcoal" });
check("an empty mask paints nothing", untouched.every((b, i) => b === photo.data[i]));

console.log("— a model's polygons —");
const polys = normalizedPolygons([[[0.1, 0.2], [0.9, 0.2], [0.9, 0.6], [0.1, 0.6]], [[0.5, 0.5]], "junk", [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.3, y: 0.5 }]], 400, 300);
check("polygons in 0…1 become pixels; a two-point one and junk are dropped; {x,y} points read too", polys.length === 2 && polys[0][1][0] === 360 && polys[0][2][1] === 180 && polys[1].length === 3);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
