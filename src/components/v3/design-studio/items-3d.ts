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
    if (p.kind === "carpet") {
      // Pile: the colour, flecked lighter and darker so it reads as fibre, not paint.
      g.fillStyle = p.hex;
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 26000; i++) {
        g.fillStyle = shade(p.hex, 0.82 + rnd() * 0.34);
        g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
      }
      return;
    }
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

const unitSph = new THREE.SphereGeometry(0.5, 18, 12);
/** An ellipsoid by inches: center (x, y, z), size (w, h, d). */
function sph(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
  const m = new THREE.Mesh(unitSph, mat);
  m.scale.set(w * FT, h * FT, d * FT);
  m.position.set(x * FT, y * FT, z * FT);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
const porcelain = (mats: Mats) => mats.get("porcelain", () => new THREE.MeshStandardMaterial({ color: 0xf6f6f3, roughness: 0.16, metalness: 0 }));
const chromeMat = (mats: Mats) => mats.get("chrome", () => new THREE.MeshStandardMaterial({ color: 0xdfe2e4, roughness: 0.15, metalness: 1 }));
const glassMat = (mats: Mats) =>
  mats.get("glass", () => new THREE.MeshStandardMaterial({ color: 0xd8e6ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }));
const fabric = (mats: Mats, hex: string) => std(mats, hex, 0.95);
const woodMat = (mats: Mats, hex = "#8a6a4c") => std(mats, hex, 0.62);
/** A piece's own colour when the designer set one (opts.color), else its default. */
const tint = (it: DesignItem, hex: string) => (typeof it.opts?.color === "string" && /^#[0-9a-f]{6}$/i.test(it.opts.color) ? it.opts.color : hex);
const legs = (g: THREE.Group, mat: THREE.Material, w: number, d: number, h: number, inset = 2, t = 1.5) => {
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, mat, lx * (w / 2 - inset), h / 2, lz * (d / 2 - inset), t, h, t);
};

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
    /* ── Every room (2026-10-18): the bath, the bedroom, the living room and the rest, each from its numbers ── */
    case "VAN": {
      // The cabinet in the cabinets' colour, its top in the counter, a basin (two from 60 in) and faucets.
      box(g, kick, 0, 2, 1.5, w - 0.2, 4, d - 3);
      box(g, carcass, 0, 4 + (h - 4) / 2, 0.375, w, h - 4, d - 0.75);
      const pull = std(mats, HARDWARE_HEX[f.hardware.finish], 0.35, 0.8);
      const doors = Math.max(2, Math.round(w / 18));
      for (let i = 0; i < doors; i++) {
        const x0 = -w / 2 + (w / doors) * i;
        box(g, carcass, x0 + w / doors / 2, 4 + (h - 4) / 2, zF - 0.25, w / doors - 0.4, h - 5, 0.75);
        box(g, pull, x0 + w / doors / 2 + (i % 2 ? -1 : 1) * (w / doors / 2 - 2), h - 6, zF - 0.9, 0.5, 5, 0.6);
      }
      box(g, counterMat, 0, h + COUNTER_T / 2, -0.5, w + 1, COUNTER_T, d + 1);
      const sinks = w >= 60 ? [-w / 4, w / 4] : [0];
      for (const sx of sinks) {
        const basin = sph(g, porcelain(mats), sx, h + COUNTER_T - 1.5, -1, 16, 4, 12);
        basin.castShadow = false;
        cyl(g, chromeMat(mats), sx, h + COUNTER_T + 4, d / 2 - 4, 0.6, 8);
        box(g, chromeMat(mats), sx, h + COUNTER_T + 7.6, d / 2 - 6, 0.9, 0.8, 5);
      }
      break;
    }
    case "WC": {
      const pc = porcelain(mats);
      box(g, pc, 0, 22, d / 2 - 4.5, 17, 15, 8);
      box(g, pc, 0, 30.2, d / 2 - 4.5, 18, 1.2, 9);
      sph(g, pc, 0, 9, -d / 2 + 11, 14, 18, 18);
      box(g, pc, 0, 6, -d / 2 + 13, 9, 12, 12);
      sph(g, pc, 0, 15.6, -d / 2 + 11, 14.5, 1.6, 18);
      cyl(g, chromeMat(mats), -7, 27, d / 2 - 9, 0.4, 1.2, "x");
      break;
    }
    case "TUB": {
      const pc = porcelain(mats);
      const t = 2.5;
      box(g, pc, 0, 1, 0, w, 2, d);
      box(g, pc, 0, h / 2, -d / 2 + t / 2, w, h, t);
      box(g, pc, 0, h / 2, d / 2 - t / 2, w, h, t);
      box(g, pc, -w / 2 + t / 2, h / 2, 0, t, h, d);
      box(g, pc, w / 2 - t / 2, h / 2, 0, t, h, d);
      const water = mats.get("tubwater", () => new THREE.MeshStandardMaterial({ color: 0xcfe0e6, roughness: 0.05, metalness: 0.1 }));
      box(g, water, 0, 2.2, 0, w - 2 * t, 0.4, d - 2 * t, false);
      cyl(g, chromeMat(mats), w / 2 - 6, h + 3, d / 2 - 2, 0.7, 6);
      box(g, chromeMat(mats), w / 2 - 6, h + 6, d / 2 - 4.5, 1, 1, 5);
      break;
    }
    case "FTUB": {
      const pc = porcelain(mats);
      const shell = cyl(g, pc, 0, h / 2, 0, 0.5, h);
      shell.scale.set(w * FT, h * FT, d * FT);
      const inner = mats.get("tubin", () => new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.1 }));
      const top = cyl(g, inner, 0, h - 0.4, 0, 0.5, 0.6);
      top.scale.set((w - 5) * FT, 0.6 * FT, (d - 5) * FT);
      cyl(g, chromeMat(mats), w / 2 + 6, 18, 0, 0.8, 36);
      break;
    }
    case "SHW": {
      const pc = porcelain(mats);
      box(g, pc, 0, 1.5, 0, w, 3, d);
      const glass = glassMat(mats);
      const front = box(g, glass, 0, 3 + (h - 3) / 2, -d / 2 + 0.25, w, h - 3, 0.5, false);
      front.castShadow = false;
      const trim = chromeMat(mats);
      box(g, trim, 0, h, -d / 2 + 0.25, w, 0.6, 0.8, false);
      box(g, trim, -w / 2 + 0.3, 3 + (h - 3) / 2, -d / 2 + 0.25, 0.6, h - 3, 0.8, false);
      box(g, trim, w / 6, 3 + (h - 3) / 2, -d / 2 + 0.25, 0.4, h - 3, 0.9, false);
      cyl(g, trim, 0, 74, d / 2 - 3, 0.5, 6, "z");
      cyl(g, trim, 0, 72, d / 2 - 7, 3, 0.6);
      break;
    }
    case "MIR": {
      const frame = std(mats, HARDWARE_HEX[f.hardware.finish], 0.4, 0.6);
      box(g, frame, 0, h / 2, 0.2, w, h, 0.6);
      const mirror = mats.get("mirror", () => new THREE.MeshStandardMaterial({ color: 0xe4ecef, roughness: 0.02, metalness: 1 }));
      box(g, mirror, 0, h / 2, -0.15, w - 2, h - 2, 0.2, false);
      break;
    }
    case "WSH":
    case "DRY": {
      const white = std(mats, "#f2f3f3", 0.35);
      box(g, white, 0, h / 2, 0, w, h, d);
      box(g, std(mats, "#d9dcdf", 0.4), 0, h - 2.5, d / 2 - 3, w - 1, 5, 6);
      const door = cyl(g, it.lib === "WSH" ? darkGlass(mats) : std(mats, "#e7e9ea", 0.3), 0, h / 2 - 2, -d / 2 - 0.2, 8, 1.2, "z");
      door.castShadow = false;
      cyl(g, steel(mats), 0, h / 2 - 2, -d / 2 - 0.5, 9, 0.5, "z");
      cyl(g, steel(mats), w / 2 - 5, h - 2.5, d / 2 - 6.2, 1.2, 0.8, "z");
      break;
    }
    case "USK": {
      const white = std(mats, "#eeefef", 0.3);
      box(g, white, 0, h / 2, 0, w, h, d);
      box(g, std(mats, "#cfd3d4", 0.3), 0, h - 4, -1, w - 4, 0.4, d - 6, false);
      cyl(g, chromeMat(mats), 0, h + 5, d / 2 - 3, 0.6, 10);
      break;
    }
    case "BED": {
      const frame = woodMat(mats, tint(it, "#7b5a40"));
      box(g, frame, 0, 6, 0, w, 8, d);
      legs(g, frame, w, d, 2, 2, 2);
      box(g, std(mats, "#f4f2ee", 0.9), 0, 15, 0.5, w - 2, 10, d - 3);
      const duvet = fabric(mats, typeof it.opts?.fabric === "string" && /^#[0-9a-f]{6}$/i.test(it.opts.fabric) ? it.opts.fabric : "#c7cfd3");
      box(g, duvet, 0, 20.6, -d / 2 + (d * 0.72) / 2 - 0.5, w + 0.6, 1.6, d * 0.72);
      box(g, duvet, 0, 12, -d / 2 + 0.2, w + 0.6, 17, 0.6);
      const pillows = w >= 54 ? [-w / 4, w / 4] : [0];
      for (const px of pillows) sph(g, std(mats, "#fbfaf7", 0.95), px, 22.5, d / 2 - 11, Math.min(26, w / pillows.length - 6), 6, 15);
      box(g, fabric(mats, "#b9b1a4"), 0, 24 + 12, d / 2 - 1.5, w + 2, 40, 3);
      break;
    }
    case "NS":
    case "DRS":
    case "SBD": {
      const wood = woodMat(mats, tint(it, it.lib === "SBD" ? "#6f5240" : "#8a6a4c"));
      box(g, wood, 0, (h - 4) / 2 + 4, 0, w, h - 4, d);
      legs(g, wood, w, d, 4, 1.5, 1.6);
      const line = std(mats, "#4a3a2c", 0.7);
      const rows = it.lib === "DRS" ? 3 : 1;
      for (let r = 1; r < rows + 1; r++) {
        const y = 4 + ((h - 4) / (rows + 1)) * r;
        if (it.lib === "SBD") box(g, line, 0, (h - 4) / 2 + 4, -d / 2 - 0.05, 0.3, h - 6, 0.2, false);
        else box(g, line, 0, y, -d / 2 - 0.05, w - 2, 0.3, 0.2, false);
      }
      const knob = std(mats, HARDWARE_HEX[f.hardware.finish], 0.35, 0.8);
      if (it.lib === "DRS") for (const r of [1, 2, 3]) for (const kx of [-w / 4, w / 4]) cyl(g, knob, kx, 4 + ((h - 4) / 4) * r + (h - 4) / 8, -d / 2 - 0.6, 0.6, 0.8, "z");
      if (it.lib === "NS") {
        cyl(g, knob, 0, h * 0.62, -d / 2 - 0.6, 0.5, 0.8, "z");
        cyl(g, std(mats, "#d8d2c6", 0.6), 0, h + 1, 2, 2.5, 2);
        cyl(g, std(mats, "#4f4a44", 0.5), 0, h + 7, 2, 0.4, 10);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(3.2 * FT, 5 * FT, 7 * FT, 18, 1, true), std(mats, "#f1ece2", 0.9));
        (shade.geometry as THREE.BufferGeometry).userData.own = true;
        shade.position.set(0, (h + 14) * FT, 2 * FT);
        g.add(shade);
      }
      break;
    }
    case "SOFA":
    case "ARM": {
      const cloth = fabric(mats, tint(it, it.lib === "ARM" ? "#a39686" : "#8e8b85"));
      const arm = Math.min(6, w / 6);
      box(g, cloth, 0, 9, 0, w, 10, d);
      box(g, cloth, 0, 20, d / 2 - 4.5, w, 26, 9);
      box(g, cloth, -w / 2 + arm / 2, 15, 0, arm, 22, d);
      box(g, cloth, w / 2 - arm / 2, 15, 0, arm, 22, d);
      const seats = it.lib === "ARM" ? 1 : w >= 84 ? 3 : 2;
      const sw = (w - 2 * arm) / seats;
      const cushion = fabric(mats, tint(it, it.lib === "ARM" ? "#ada190" : "#99958e"));
      for (let i = 0; i < seats; i++) box(g, cushion, -w / 2 + arm + sw * (i + 0.5), 16, -1.5, sw - 0.6, 5, d - 11);
      legs(g, woodMat(mats, "#3b2b20"), w, d, 4, 3, 1.4);
      break;
    }
    case "CTB":
    case "STB":
    case "CON":
    case "DSK": {
      const wood = woodMat(mats, tint(it, it.lib === "DSK" ? "#a17c56" : "#7d5d43"));
      box(g, wood, 0, h - 0.75, 0, w, 1.5, d);
      legs(g, it.lib === "CTB" ? wood : std(mats, "#2b2c2e", 0.5, 0.4), w, d, h - 1.5, 2, it.lib === "CTB" ? 2.2 : 1.2);
      if (it.lib === "CTB") box(g, wood, 0, 5, 0, w - 6, 0.8, d - 6);
      if (it.lib === "DSK") {
        box(g, darkGlass(mats), 0, h + 9, d / 2 - 5, Math.min(24, w - 12), 13, 0.8);
        box(g, std(mats, "#2b2c2e", 0.5), 0, h + 1.5, d / 2 - 5, 6, 3, 4);
      }
      break;
    }
    case "TVC": {
      const wood = woodMat(mats, tint(it, "#5d4635"));
      box(g, wood, 0, (h - 4) / 2 + 4, 0, w, h - 4, d);
      legs(g, wood, w, d, 4, 2, 1.6);
      box(g, std(mats, "#3a2c22", 0.7), 0, (h - 4) / 2 + 4, -d / 2 - 0.05, 0.3, h - 6, 0.2, false);
      const tvW = Math.min(65, w - 4) * 0.87;
      box(g, darkGlass(mats), 0, h + 3 + (tvW * 0.56) / 2, d / 2 - 4, tvW, tvW * 0.56, 1.2);
      box(g, std(mats, "#1c1d1f", 0.5), 0, h + 1.5, d / 2 - 4, 10, 1, 6);
      break;
    }
    case "SHF":
    case "SHU": {
      const metal = it.lib === "SHU";
      const mat = metal ? std(mats, "#9da2a6", 0.45, 0.6) : woodMat(mats, tint(it, "#8f6c4d"));
      const t = metal ? 1 : 0.75;
      if (metal) for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, mat, lx * (w / 2 - 0.5), h / 2, lz * (d / 2 - 0.5), 1, h, 1);
      else {
        box(g, mat, -w / 2 + t / 2, h / 2, 0, t, h, d);
        box(g, mat, w / 2 - t / 2, h / 2, 0, t, h, d);
        box(g, mat, 0, h / 2, d / 2 - 0.25, w, h, 0.5);
      }
      const shelves = Math.max(3, Math.round(h / 15));
      const colors = ["#7a4b3a", "#3f5a6b", "#c2a35e", "#5d6b52", "#8c8c86", "#a5583e"];
      for (let i = 0; i <= shelves; i++) {
        const y = 2 + ((h - 3) / shelves) * i;
        box(g, mat, 0, y, 0, w - 2 * t, t, d - 0.5);
        if (!metal && i < shelves) {
          let x = -w / 2 + t + 1;
          let k = i * 3;
          while (x < w / 2 - t - 6) {
            const bw = 1 + ((k * 7) % 3);
            const bh = 8 + ((k * 5) % 4);
            box(g, std(mats, colors[k % colors.length], 0.8), x + bw / 2, y + t / 2 + bh / 2, 0, bw, bh, d - 3);
            x += bw + 0.15;
            k++;
          }
        }
      }
      break;
    }
    case "OCH": {
      const dark = std(mats, "#2b2c2e", 0.5);
      cyl(g, dark, 0, 1, 0, 11, 1.2);
      cyl(g, steel(mats), 0, 9, 0, 1, 16);
      box(g, fabric(mats, tint(it, "#3d4146")), 0, 18, 0, 19, 3, 19);
      box(g, fabric(mats, tint(it, "#3d4146")), 0, 29, d / 2 - 2.5, 18, 18, 2.5);
      break;
    }
    case "BNC": {
      const wood = woodMat(mats, tint(it, "#8a6a4c"));
      box(g, fabric(mats, "#b6ab9b"), 0, h - 1.5, 0, w, 3, d);
      box(g, wood, 0, h - 3.5, 0, w, 1, d);
      legs(g, wood, w, d, h - 4, 2, 1.6);
      break;
    }
    case "CLS": {
      const wood = woodMat(mats, "#e9e2d4");
      box(g, wood, 0, 0.4, 0, w, 0.8, d - 2);
      cyl(g, chromeMat(mats), 0, -2.5, -d / 2 + 6, 0.6, w, "x");
      const cloth = ["#3b4a5a", "#c9b79c", "#7a2f2f", "#e9e6df", "#556b5a", "#2d2d30"];
      for (let x = -w / 2 + 4, k = 0; x < w / 2 - 3; x += 2.2, k++) box(g, fabric(mats, cloth[k % cloth.length]), x, -2.5 - 18, -d / 2 + 6, 1.8, 34 - ((k * 7) % 10), 18);
      break;
    }
    case "WBN": {
      const wood = woodMat(mats, "#b38b5c");
      box(g, wood, 0, h - 0.75, 0, w, 1.5, d);
      legs(g, wood, w, d, h - 1.5, 2, 3);
      box(g, wood, 0, 8, 0, w - 4, 1, d - 4);
      box(g, std(mats, "#c9b38a", 0.8), 0, h + 18, d / 2 - 0.4, w, 36, 0.8);
      break;
    }
    case "LNG": {
      const frame = woodMat(mats, "#9c7a54");
      box(g, frame, 0, 8, -6, w, 3, d - 12);
      legs(g, frame, w, d - 12, 7, 2, 1.5);
      const back = box(g, fabric(mats, tint(it, "#e7e1d4")), 0, 16, d / 2 - 9, w, 3, 22);
      back.rotation.x = -0.75;
      box(g, fabric(mats, tint(it, "#e7e1d4")), 0, 10.5, -6, w - 1, 2, d - 14);
      break;
    }
    case "GRL": {
      const black = std(mats, "#26272a", 0.5, 0.5);
      box(g, black, 0, 30, 0, w - 18, 14, d);
      cyl(g, black, 0, 36, 0, d / 2 - 1, w - 18, "x");
      box(g, steel(mats), -w / 2 + 6, 32, 0, 12, 1, d - 2);
      box(g, steel(mats), w / 2 - 6, 32, 0, 12, 1, d - 2);
      legs(g, black, w - 18, d, 23, 2, 1.5);
      break;
    }
    case "RUG": {
      const border = fabric(mats, tint(it, "#6d5d4d"));
      box(g, border, 0, 0.2, 0, w, 0.4, d, false);
      box(g, fabric(mats, "#b8a68b"), 0, 0.42, 0, w - 8, 0.05, d - 8, false);
      break;
    }
    case "PLT": {
      cyl(g, std(mats, "#b56a43", 0.8), 0, 7, 0, w / 2 - 1, 14);
      const leaf = std(mats, "#4f7a4a", 0.8);
      sph(g, leaf, 0, 24, 0, w + 4, 22, w + 4);
      sph(g, leaf, -3, 33, 2, w - 2, 14, w - 2);
      sph(g, leaf, 3, 30, -2, w - 4, 12, w - 4);
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
