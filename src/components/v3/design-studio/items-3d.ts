// WHAT'S IN THE ROOM, IN 3D (Home Design Studio, milestone 3 — 2026-10-17). Every cabinet and appliance drawn from
// its own numbers (no 3D files): a cabinet is a toe kick, a box and its fronts — shaker, slab or raised — with the
// hardware; counters run over the base cabinets with a 1 in overhang; the backsplash rises behind them to the wall
// cabinets (or the hood); the range, fridge, dishwasher and hood in stainless; pendants and recessed lights glow.
// Builders return THREE groups in the item's own frame: x across its width, y up, its FRONT toward −z.
import * as THREE from "three";
import type { DesignItem, Finishes } from "@/lib/design/model";
import { COUNTER_T, HARDWARE_HEX, counterPreset, floorPreset, lib, splashPreset, type CounterPreset, type FloorPreset, type SplashPreset } from "@/lib/design/library";
import { frameOf } from "@/lib/design/kitchen";

export const FT = 1 / 12;

/* ── Textures ──────────────────────────────────────────────────────────────────────────────────────────────────── */

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A 60 in × 60 in patch of the floor (the texture repeats every 5 ft). */
export function floorTexture(p: FloorPreset, pattern: Finishes["floor"]["pattern"]): THREE.CanvasTexture {
  seed = 11;
  const S = 1024;
  const px = S / 60; // pixels per inch
  return canvas(S, S, (g) => {
    if (p.kind === "tile") {
      const tw = (p.tile?.w ?? 12) * px;
      const th = (p.tile?.h ?? 12) * px;
      g.fillStyle = p.grout ?? "#999";
      g.fillRect(0, 0, S, S);
      for (let y = 0, row = 0; y < S; y += th, row++)
        for (let x = pattern === "offset" && row % 2 ? -tw / 2 : 0, col = 0; x < S; x += tw, col++) {
          const checker = p.hex2 && (row + col) % 2 === 1;
          g.fillStyle = checker ? p.hex2! : shade(p.hex, 0.95 + rnd() * 0.08);
          g.fillRect(x + 1.5, y + 1.5, tw - 3, th - 3);
          if (p.id === "tile-marble") {
            g.strokeStyle = "rgba(120,115,110,0.18)";
            g.lineWidth = 1.2;
            g.beginPath();
            g.moveTo(x + rnd() * tw, y);
            g.bezierCurveTo(x + rnd() * tw, y + th * 0.3, x + rnd() * tw, y + th * 0.7, x + rnd() * tw, y + th);
            g.stroke();
          }
        }
      return;
    }
    // Planks, `plank` inches wide; herringbone as 2 × 12 in blocks.
    const pw = (p.plank ?? 5) * px;
    g.fillStyle = shade(p.hex, 0.8);
    g.fillRect(0, 0, S, S);
    const board = (x: number, y: number, w: number, h: number, vertical: boolean) => {
      const tone = 0.88 + rnd() * 0.22;
      g.fillStyle = shade(rnd() > 0.5 && p.hex2 ? p.hex2 : p.hex, tone);
      g.fillRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6);
      g.strokeStyle = `rgba(60,35,15,${p.kind === "lvp" ? 0.08 : 0.14})`;
      g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        if (vertical) {
          const xx = x + (w * (k + 0.5)) / 5;
          g.moveTo(xx, y);
          g.bezierCurveTo(xx + 2, y + h * 0.3, xx - 2, y + h * 0.6, xx, y + h);
        } else {
          const yy = y + (h * (k + 0.5)) / 5;
          g.moveTo(x, yy);
          g.bezierCurveTo(x + w * 0.3, yy + 2, x + w * 0.6, yy - 2, x + w, yy);
        }
        g.stroke();
      }
    };
    if (pattern === "herringbone") {
      const bw = 2.5 * px;
      const bl = 12 * px;
      for (let y = -bl; y < S + bl; y += bw * 2)
        for (let x = -bl; x < S + bl; x += bl) {
          board(x + ((y / (bw * 2)) % 2 ? bl / 2 : 0), y, bl / 2, bw, false);
          board(x + ((y / (bw * 2)) % 2 ? bl / 2 : 0) + bl / 2, y, bw, bl / 2, true);
        }
      return;
    }
    for (let y = 0, row = 0; y < S; y += pw, row++) {
      let x = -((row * 37 * px) % (48 * px));
      while (x < S) {
        const len = (36 + rnd() * 48) * px;
        board(x, y, len, pw, false);
        x += len;
      }
    }
  });
}

export function counterTexture(c: CounterPreset): THREE.CanvasTexture {
  seed = 23;
  return canvas(512, 512, (g) => {
    g.fillStyle = c.hex;
    g.fillRect(0, 0, 512, 512);
    if (c.look === "veined") {
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = c.id === "soapstone" ? "rgba(200,205,200,0.25)" : `rgba(110,105,100,${0.12 + rnd() * 0.18})`;
        g.lineWidth = 0.6 + rnd() * 2.2;
        g.beginPath();
        let x = rnd() * 512;
        let y = 0;
        g.moveTo(x, y);
        while (y < 512) {
          x += (rnd() - 0.5) * 60;
          y += 30 + rnd() * 50;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    } else if (c.look === "speckled") {
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.25)";
        g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
      }
    } else if (c.look === "wood") {
      for (let y = 0; y < 512; y += 24) {
        g.fillStyle = shade(c.hex, 0.85 + rnd() * 0.25);
        g.fillRect(0, y, 512, 23);
      }
    }
  });
}

/** A 24 in × 12 in patch of backsplash tile. */
export function splashTexture(sp: SplashPreset): THREE.CanvasTexture {
  seed = 31;
  const W = 512;
  const H = 256;
  const px = W / 24;
  return canvas(W, H, (g) => {
    g.fillStyle = sp.grout ?? "#ccc";
    g.fillRect(0, 0, W, H);
    const t = sp.tile ?? { w: 6, h: 3 };
    const tw = t.w * px;
    const th = t.h * px;
    if (t.herring) {
      for (let y = -tw; y < H + tw; y += th * 2)
        for (let x = -tw; x < W + tw; x += tw) {
          g.fillStyle = shade(sp.hex, 0.94 + rnd() * 0.1);
          g.fillRect(x + 1, y + 1, tw / 2 - 2, th - 2);
          g.fillRect(x + tw / 2 + 1, y + 1, th - 2, tw / 2 - 2);
        }
      return;
    }
    for (let y = 0, row = 0; y < H; y += th, row++)
      for (let x = t.offset && row % 2 ? -tw / 2 : 0; x < W; x += tw) {
        g.fillStyle = shade(sp.hex, sp.id.startsWith("zellige") ? 0.82 + rnd() * 0.3 : 0.96 + rnd() * 0.06);
        g.fillRect(x + 1.2, y + 1.2, tw - 2.4, th - 2.4);
      }
  });
}

/** Wall texture as a bump map: orange peel, knockdown, skim. */
export function wallBump(kind: Finishes["wall"]["texture"]): THREE.CanvasTexture | null {
  if (kind === "smooth") return null;
  seed = 5;
  return canvas(256, 256, (g) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, 256, 256);
    const n = kind === "orange" ? 2600 : kind === "knockdown" ? 240 : 600;
    for (let i = 0; i < n; i++) {
      const r = kind === "orange" ? 1 + rnd() * 1.6 : kind === "knockdown" ? 4 + rnd() * 9 : 3 + rnd() * 6;
      g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${kind === "skim" ? 0.06 : 0.16})`;
      g.beginPath();
      g.ellipse(rnd() * 256, rnd() * 256, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/* ── Materials, made once per build ───────────────────────────────────────────────────────────────────────────── */

export type Mats = {
  get: (key: string, make: () => THREE.Material) => THREE.Material;
  tex: (key: string, make: () => THREE.Texture) => THREE.Texture;
  dispose: () => void;
};

export function matCache(): Mats {
  const m = new Map<string, THREE.Material>();
  const t = new Map<string, THREE.Texture>();
  return {
    get: (key, make) => {
      let v = m.get(key);
      if (!v) {
        v = make();
        m.set(key, v);
      }
      return v;
    },
    tex: (key, make) => {
      let v = t.get(key);
      if (!v) {
        v = make();
        t.set(key, v);
      }
      return v;
    },
    dispose: () => {
      for (const v of m.values()) v.dispose();
      for (const v of t.values()) v.dispose();
    },
  };
}

const std = (mats: Mats, hex: string, rough = 0.6, metal = 0) => mats.get(`std:${hex}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
const steel = (mats: Mats) => mats.get("steel", () => new THREE.MeshStandardMaterial({ color: 0xc8cbcd, roughness: 0.28, metalness: 0.9 }));
const darkGlass = (mats: Mats) => mats.get("darkglass", () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.12, metalness: 0.3 }));

/* ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────── */

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
/** A box by inches: center (x, y, z), size (w, h, d). */
function box(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, shadows = true) {
  const m = new THREE.Mesh(unitBox, mat);
  m.scale.set(Math.max(0.01, w) * FT, Math.max(0.01, h) * FT, Math.max(0.01, d) * FT);
  m.position.set(x * FT, y * FT, z * FT);
  m.castShadow = shadows;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
function cyl(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, axis: "y" | "x" | "z" = "y") {
  const m = new THREE.Mesh(unitCyl, mat);
  m.scale.set(r * 2 * FT, h * FT, r * 2 * FT);
  if (axis === "x") m.rotation.z = Math.PI / 2;
  if (axis === "z") m.rotation.x = Math.PI / 2;
  m.position.set(x * FT, y * FT, z * FT);
  m.castShadow = true;
  g.add(m);
  return m;
}

/** A door or drawer front on the face plane (z = front), with its style and hardware. */
function front(g: THREE.Group, mats: Mats, f: Finishes, color: string, x0: number, x1: number, y0: number, y1: number, zFront: number, kind: "door" | "drawer" | "panel", hingeLeft = true) {
  const gap = 0.125;
  const w = x1 - x0 - gap;
  const h = y1 - y0 - gap;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const mat = std(mats, color, 0.55);
  const t = 0.75;
  const zc = zFront - t / 2;
  if (f.cabinets.style === "slab" || kind === "panel" || h < 5) box(g, mat, cx, cy, zc, w, h, t);
  else {
    // Shaker: a recessed center panel inside a 2¼ in frame (raised: the panel stands proud).
    const rail = Math.min(2.25, w / 5, h / 5);
    const darker = std(mats, shade(color, 0.93), 0.55);
    box(g, f.cabinets.style === "raised" ? mat : darker, cx, cy, zc + 0.2, w - 2 * rail, h - 2 * rail, t - 0.4, false);
    if (f.cabinets.style === "raised") box(g, mat, cx, cy, zc - 0.1, w - 2 * rail - 2, h - 2 * rail - 2, t, false);
    box(g, mat, cx, y1 - gap / 2 - rail / 2, zc, w, rail, t, false);
    box(g, mat, cx, y0 + gap / 2 + rail / 2, zc, w, rail, t, false);
    box(g, mat, x0 + gap / 2 + rail / 2, cy, zc, rail, h - 2 * rail, t, false);
    box(g, mat, x1 - gap / 2 - rail / 2, cy, zc, rail, h - 2 * rail, t, false);
  }
  if (kind === "panel") return;
  // Hardware: drawers get a centered pull; doors one near the opening edge.
  const hw = std(mats, HARDWARE_HEX[f.hardware.finish], 0.3, 0.8);
  const zHw = zFront - t - 0.6;
  if (f.hardware.kind === "knob") {
    const kx = kind === "drawer" ? cx : hingeLeft ? x1 - 2 : x0 + 2;
    const ky = kind === "drawer" ? cy : y1 - 3 > cy ? (y1 > 50 ? y0 + 3 : y1 - 3) : cy;
    cyl(g, hw, kx, ky, zHw, 0.6, 1.1, "z");
    return;
  }
  const len = kind === "drawer" ? Math.min(12, w * 0.45) : Math.min(8, h * 0.3);
  if (kind === "drawer") box(g, hw, cx, cy, zHw, len, 0.45, 0.45, false);
  else {
    const kx = hingeLeft ? x1 - 1.8 : x0 + 1.8;
    // Base doors: the pull at the top; wall doors: at the bottom.
    const ky = y0 > 40 ? y0 + 2.5 + len / 2 : y1 - 2.5 - len / 2;
    box(g, hw, kx, ky, zHw, 0.45, f.hardware.kind === "cup" ? 2.5 : len, 0.45, false);
  }
}

/* ── One item ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export type ItemCtx = { mats: Mats; f: Finishes; ceiling: number; /** Highest backsplash top behind this item. */ splashTop: number };

export function buildItem(it: DesignItem, ctx: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const { mats, f } = ctx;
  const e = lib(it.lib);
  const w = it.w;
  const d = it.d;
  const h = it.h;
  const zF = -d / 2; // the front plane
  const cabColor = e?.cat === "island" ? f.cabinets.island ?? f.cabinets.color : e?.cat === "wall" ? f.cabinets.uppers ?? f.cabinets.color : f.cabinets.color;
  const carcass = std(mats, shade(cabColor, 0.97), 0.7);
  const kick = std(mats, shade(cabColor, 0.45), 0.8);
  const cp = counterPreset(f.counter.id);
  const counterMat = mats.get(`counter:${cp.id}`, () => new THREE.MeshStandardMaterial({ map: mats.tex(`ctex:${cp.id}`, () => counterTexture(cp)), roughness: cp.look === "wood" ? 0.55 : 0.22, metalness: 0 }));
  // The counter over a base cabinet: its full width, 1 in past the front.
  const counter = () => box(g, counterMat, 0, h + COUNTER_T / 2, -0.5, w, COUNTER_T, d + 1);

  const baseBox = () => {
    box(g, kick, 0, 2, 1.5, w - 0.2, 4, d - 3);
    box(g, carcass, 0, 4 + (h - 4) / 2, 0.375, w, h - 4, d - 0.75);
  };
  switch (it.lib) {
    case "B":
    case "BC": {
      baseBox();
      const top = h;
      const dr = 6;
      front(g, mats, f, cabColor, -w / 2, w / 2, top - dr, top, zF, "drawer");
      if (w >= 24 && it.lib === "B") {
        front(g, mats, f, cabColor, -w / 2, 0, 4, top - dr, zF, "door", false);
        front(g, mats, f, cabColor, 0, w / 2, 4, top - dr, zF, "door", true);
      } else front(g, mats, f, cabColor, -w / 2, w / 2, 4, top - dr, zF, "door", (it.opts?.hinge ?? "right") !== "left");
      counter();
      break;
    }
    case "DB": {
      baseBox();
      const hs = [6, 10.25, h - 4 - 16.25];
      let y = h;
      for (const hh of hs) {
        front(g, mats, f, cabColor, -w / 2, w / 2, y - hh, y, zF, "drawer");
        y -= hh;
      }
      counter();
      break;
    }
    case "SB": {
      baseBox();
      front(g, mats, f, cabColor, -w / 2, w / 2, h - 6, h, zF, "panel");
      front(g, mats, f, cabColor, -w / 2, 0, 4, h - 6, zF, "door", false);
      front(g, mats, f, cabColor, 0, w / 2, 4, h - 6, zF, "door", true);
      counter();
      sinkAndFaucet(g, mats, w, d, h, String(it.opts?.sink ?? "single"));
      break;
    }
    case "BF":
      baseBox();
      front(g, mats, f, cabColor, -w / 2, w / 2, 4, h, zF, "panel");
      counter();
      break;
    case "W":
    case "WR": {
      box(g, carcass, 0, h / 2, 0.375, w, h, d - 0.75);
      if (it.lib === "WR" || w > 21) {
        front(g, mats, f, cabColor, -w / 2, 0, 0, h, zF, "door", false);
        front(g, mats, f, cabColor, 0, w / 2, 0, h, zF, "door", true);
      } else front(g, mats, f, cabColor, -w / 2, w / 2, 0, h, zF, "door", (it.opts?.hinge ?? "right") !== "left");
      break;
    }
    case "WF":
      box(g, carcass, 0, h / 2, 0.375, w, h, d - 0.75);
      front(g, mats, f, cabColor, -w / 2, w / 2, 0, h, zF, "panel");
      break;
    case "P":
    case "OV": {
      box(g, kick, 0, 2, 1.5, w - 0.2, 4, d - 3);
      box(g, carcass, 0, 4 + (h - 4) / 2, 0.375, w, h - 4, d - 0.75);
      if (it.lib === "P") {
        const split = 4 + (h - 4) * 0.42;
        for (const [a, b] of [[4, split], [split, h]] as Array<[number, number]>) {
          if (w > 21) {
            front(g, mats, f, cabColor, -w / 2, 0, a, b, zF, "door", false);
            front(g, mats, f, cabColor, 0, w / 2, a, b, zF, "door", true);
          } else front(g, mats, f, cabColor, -w / 2, w / 2, a, b, zF, "door");
        }
      } else {
        // Oven tower: a drawer, the wall oven, the microwave, a door to the top.
        front(g, mats, f, cabColor, -w / 2, w / 2, 4, 16, zF, "drawer");
        box(g, steel(mats), 0, 16 + 14, zF - 0.4, w - 3, 27, 1);
        box(g, darkGlass(mats), 0, 16 + 13, zF - 1, w - 9, 14, 0.3, false);
        box(g, steel(mats), 0, 46 + 9, zF - 0.4, w - 3, 17, 1);
        box(g, darkGlass(mats), -3, 46 + 9, zF - 1, w - 13, 11, 0.3, false);
        front(g, mats, f, cabColor, -w / 2, w / 2, 65, h, zF, "door");
      }
      break;
    }
    case "ISL": {
      const seats = !!it.opts?.seats;
      const cabD = seats ? Math.min(24, d - 10) : d;
      // Cabinets on the work side (the front), a panel back; the counter over all of it.
      const zc = -d / 2 + cabD / 2;
      box(g, kick, 0, 2, zc + 1.5, w - 0.2, 4, cabD - 3);
      box(g, carcass, 0, 4 + (h - 4) / 2, zc + 0.375, w, h - 4, cabD - 0.75);
      const bays = Math.max(2, Math.round(w / 30));
      const bw = w / bays;
      for (let i = 0; i < bays; i++) {
        const x0 = -w / 2 + i * bw;
        front(g, mats, f, cabColor, x0, x0 + bw, h - 6, h, zF, "drawer");
        front(g, mats, f, cabColor, x0, x0 + bw, 4, h - 6, zF, "door", i % 2 === 1);
      }
      if (seats) box(g, std(mats, shade(cabColor, 0.9), 0.6), 0, h / 2, zc + cabD / 2 - 0.4, w, h, 0.75);
      // The counter: the whole island plus 1 in at the work side.
      box(g, counterMat, 0, h + COUNTER_T / 2, -0.5, w + 2, COUNTER_T, d + 1);
      if (it.opts?.sink) sinkAndFaucet(g, mats, w, cabD, h, String(it.opts.sink), zc - d / 2 + cabD / 2);
      break;
    }
    case "DW": {
      box(g, kick, 0, 2, 1.5, w - 0.2, 4, d - 3);
      box(g, carcass, 0, 4 + (h - 4) / 2, 0.375, w, h - 4, d - 0.75);
      box(g, steel(mats), 0, 4 + (h - 4) / 2, zF - 0.4, w - 0.4, h - 4.4, 0.8);
      box(g, steel(mats), 0, h - 3, zF - 1.4, w * 0.7, 0.8, 0.8, false);
      counter();
      break;
    }
    case "RNG": {
      box(g, steel(mats), 0, 18, 0, w, 36, d);
      box(g, darkGlass(mats), 0, 36.05, 0.5, w - 1, 0.3, d - 3, false);
      const ring = mats.get("burner", () => new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.6 }));
      for (const [bx, bz] of [[-w / 4, -d / 5], [w / 4, -d / 5], [-w / 4, d / 5], [w / 4, d / 5]]) cyl(g, ring, bx, 36.5, bz, w >= 36 ? 4 : 3.2, 0.6);
      box(g, darkGlass(mats), 0, 17, zF - 0.1, w - 8, 14, 0.4, false);
      box(g, steel(mats), 0, 28.5, zF - 1.2, w - 6, 0.8, 0.8, false);
      for (let i = 0; i < 4; i++) cyl(g, ring, -w / 2 + 5 + (i * (w - 10)) / 3, 33, zF - 0.6, 0.8, 1.2, "z");
      break;
    }
    case "CT": {
      box(g, darkGlass(mats), 0, 0.15, 0, w, 0.3, d, false);
      const ring = mats.get("ringlit", () => new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.4 }));
      for (const [bx, bz] of [[-w / 4, -d / 5], [w / 4, -d / 5], [-w / 4, d / 5], [w / 4, d / 5]]) cyl(g, ring, bx, 0.35, bz, 3.2, 0.1);
      break;
    }
    case "REF": {
      const fh = h;
      box(g, steel(mats), 0, fh / 2, 0, w, fh, d);
      const seam = std(mats, "#2b2c2e", 0.6);
      box(g, seam, 0, fh * 0.34, zF - 0.05, w - 0.4, 0.4, 0.2, false);
      box(g, seam, 0, fh * 0.67, zF - 0.05, 0.4, fh * 0.66, 0.2, false);
      const handle = steel(mats);
      box(g, handle, -1.6, fh * 0.67, zF - 1.4, 0.8, fh * 0.45, 0.8, false);
      box(g, handle, 1.6, fh * 0.67, zF - 1.4, 0.8, fh * 0.45, 0.8, false);
      box(g, handle, 0, fh * 0.3, zF - 1.4, w * 0.6, 0.8, 0.8, false);
      break;
    }
    case "HD": {
      // A chimney hood: the canopy, then its flue to the ceiling.
      box(g, steel(mats), 0, h / 2, 0, w, h, d);
      const top = Math.max(h, ctx.ceiling - it.z);
      box(g, steel(mats), 0, h + (top - h) / 2, d / 2 - 6, 12, top - h, 10);
      break;
    }
    case "MW":
      box(g, steel(mats), 0, h / 2, 0, w, h, d);
      box(g, darkGlass(mats), -3, h / 2, zF - 0.1, w - 12, h - 6, 0.3, false);
      break;
    case "PEN": {
      const cord = std(mats, "#1b1b1d", 0.6);
      const drop = Math.max(2, ctx.ceiling - it.z - h);
      cyl(g, cord, 0, h + drop / 2, 0, 0.15, drop);
      const shadeMat = std(mats, HARDWARE_HEX[f.hardware.finish], 0.35, 0.7);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.15 * FT, (w / 2) * FT, h * FT, 24, 1, true), shadeMat);
      m.position.y = (h / 2) * FT;
      g.add(m);
      (m.geometry as THREE.BufferGeometry).userData.own = true;
      const glow = mats.get("glow", () => new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a8, emissiveIntensity: 1.4 }));
      cyl(g, glow, 0, 1, 0, w / 2 - 0.6, 0.3);
      break;
    }
    case "CAN": {
      const glow = mats.get("glow", () => new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a8, emissiveIntensity: 1.4 }));
      cyl(g, std(mats, "#f2f2f0", 0.5), 0, 0.3, 0, w / 2 + 0.8, 0.4);
      cyl(g, glow, 0, 0, 0, w / 2, 0.2);
      break;
    }
    case "STL": {
      const seat = std(mats, f.cabinets.island ?? "#3a3b3e", 0.6);
      const leg = std(mats, HARDWARE_HEX[f.hardware.finish], 0.35, 0.7);
      cyl(g, seat, 0, h - 0.8, 0, w / 2, 1.6);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(g, leg, lx * (w / 2 - 2), (h - 1.6) / 2, lz * (w / 2 - 2), 0.45, h - 1.6);
      box(g, leg, 0, 9, 0, w - 4, 0.6, 0.6, false);
      break;
    }
    case "TBL": {
      const top = std(mats, "#8a6a4c", 0.6);
      box(g, top, 0, h - 0.6, 0, w, 1.25, d);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, top, lx * (w / 2 - 3), (h - 1.2) / 2, lz * (d / 2 - 3), 2, h - 1.2, 2);
      break;
    }
    case "CHR": {
      const wood = std(mats, "#6d4f37", 0.6);
      box(g, wood, 0, 18, 0, w, 1.2, d);
      box(g, wood, 0, 26, d / 2 - 0.6, w, 16, 1.2);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, wood, lx * (w / 2 - 1), 9, lz * (d / 2 - 1), 1.2, 18, 1.2);
      break;
    }
    default:
      box(g, carcass, 0, h / 2, 0, w, h, d);
  }
  // The backsplash behind a counter against a wall: tile (or the slab) from the counter up.
  if (it.wallId && e && (e.counter || it.lib === "RNG") && it.lib !== "ISL" && ctx.splashTop > 36.5) {
    const sp = splashPreset(f.backsplash.id);
    if (sp.id !== "none") {
      const top = ctx.splashTop;
      const hgt = top - 36;
      const mat = sp.slab
        ? counterMat
        : mats.get(`splash:${sp.id}`, () => {
            const t = mats.tex(`stex:${sp.id}`, () => splashTexture(sp));
            return new THREE.MeshStandardMaterial({ map: t, roughness: 0.25 });
          });
      const m = box(g, mat, 0, 36 + hgt / 2, d / 2 - 0.15, w + 0.02, hgt, 0.3, false);
      if (!sp.slab) {
        // Repeat by the real size (the patch is 24 × 12 in).
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 24), uv.getY(i) * (hgt / 12));
        m.geometry = geo;
        geo.userData.own = true;
      }
    }
  }
  return g;
}

function sinkAndFaucet(g: THREE.Group, mats: Mats, w: number, d: number, h: number, kind: string, zc = 0) {
  const basin = mats.get("basin", () => new THREE.MeshStandardMaterial({ color: 0x8d9093, roughness: 0.35, metalness: 0.85 }));
  const top = h + COUNTER_T + 0.02;
  const bw = Math.min(w - 6, kind === "double" ? 30 : 24);
  if (kind === "double") {
    box(g, basin, -bw / 4 - 0.5, top, zc - 1, bw / 2 - 1.5, 0.1, 16, false);
    box(g, basin, bw / 4 + 0.5, top, zc - 1, bw / 2 - 1.5, 0.1, 16, false);
  } else box(g, basin, 0, top, zc - 1, bw, 0.1, 16, false);
  // Gooseneck faucet at the back of the sink.
  const chrome = mats.get("chrome", () => new THREE.MeshStandardMaterial({ color: 0xdfe2e4, roughness: 0.15, metalness: 1 }));
  cyl(g, chrome, 0, top + 7, zc + d / 2 - 4, 0.6, 14);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(3 * FT, 0.6 * FT, 10, 20, Math.PI), chrome);
  arc.position.set(0, (top + 14) * FT, (zc + d / 2 - 7) * FT);
  arc.rotation.y = Math.PI / 2;
  (arc.geometry as THREE.BufferGeometry).userData.own = true;
  g.add(arc);
}

/** Place a built item in the scene: its frame onto the plan, its height off the floor. */
export function placeItem(grp: THREE.Group, it: DesignItem) {
  const { f, u } = frameOf(it);
  const u3 = new THREE.Vector3(u.x, 0, u.y);
  const up = new THREE.Vector3(0, 1, 0);
  const back = new THREE.Vector3().crossVectors(u3, up); // = −front
  const m = new THREE.Matrix4().makeBasis(u3, up, back);
  grp.quaternion.setFromRotationMatrix(m);
  grp.position.set(it.x * FT, it.z * FT, it.y * FT);
  void f;
}

/** Free the geometries an item made for itself (the unit box and cylinder are shared). */
export function disposeOwn(grp: THREE.Object3D) {
  grp.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.geometry as THREE.BufferGeometry).userData.own) o.geometry.dispose();
  });
}

export { floorPreset };
