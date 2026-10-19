// The three nameplate photos the shoot uploads into the real intake step: the
// landing demo's drawn plates (landing-e/hvac-estimator-demo/plates.ts — an
// outdoor unit, a furnace, the panel door open, each stamped EXAMPLE), rendered
// to PNG at 2× so the real nameplate reader gets a photo-sized image.
//   npx tsx advertisement/hvac/plates.ts
import sharp from "sharp";
import path from "node:path";
import { PLATE_OUTDOOR, PLATE_INDOOR, PLATE_PANEL } from "../../src/components/v3/landing-e/hvac-estimator-demo/plates";

const OUT = path.join(__dirname, "assets");
const svgOf = (url: string) => Buffer.from(decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, "")));
(async () => {
  for (const [name, url] of [["plate-outdoor", PLATE_OUTDOOR], ["plate-indoor", PLATE_INDOOR], ["plate-panel", PLATE_PANEL]] as const) {
    await sharp(svgOf(url), { density: 192 }).png().toFile(path.join(OUT, `${name}.png`));
    console.log(name);
  }
})();
