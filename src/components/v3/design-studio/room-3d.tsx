"use client";
// THE ROOM IN 3D (Home Design Studio, 2026-10-17). The plan's walls stood up to their height and cut around every door
// and window, the floor of each room, doors hung on their hinge and swung part-open the way they swing, windows glazed,
// and what the plan drew inside (cabinets, appliances, fixtures) traced on the floor until they are designed. The room
// being designed stands full height; the rest of the house is cut low so the camera sees in — a dollhouse. "Walk in"
// puts the camera at eye height inside the room.
// Plain three.js like the deck/roof/fence models. Plan inches → scene feet: plan x → X, plan y (down the sheet) → Z.
import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DesignDoc, Opening, Wall } from "@/lib/design/model";
import { finishesFor, floorPreset, lib } from "@/lib/design/library";
import { splashTopFor } from "@/lib/design/kitchen";
import { buildItem, disposeOwn, floorTexture, matCache, placeItem, wallBump } from "./items-3d";
import { centroid, pointInPoly, roomsOf, wallDir, wallLen, wallPieces, type Room } from "@/lib/design/geometry";

const pointInPolyBox = (b: { x: number; y: number; w: number; h: number }, poly: Array<{ x: number; y: number }>) => pointInPoly({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly);

const FT = 1 / 12;
const CUT = 36; // inches: the rest of the house is cut to this height
const EYE = 64; // inches: eye height walking in

export type Room3DProps = {
  doc: DesignDoc;
  /** The room being designed (its label id); null shows the whole house at full height. */
  focus: string | null;
  selectedWall?: string | null;
  onPickWall?: (id: string | null) => void;
  selectedItem?: string | null;
  onPickItem?: (id: string) => void;
  /** "orbit" — look in from above; "walk" — stand in the room. */
  view?: "orbit" | "walk";
  /** Changes re-frame the camera. */
  frameToken?: number;
  className?: string;
  label?: string;
};

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  // Planks: 5 in wide boards, staggered ends, a little colour play board to board.
  const boards = 12;
  for (let i = 0; i < boards; i++) {
    const y = (i * 512) / boards;
    const hBoard = 512 / boards;
    let x = -((i * 173) % 512);
    while (x < 512) {
      const len = 220 + ((i * 97 + Math.floor(x)) % 180);
      const tone = 150 + ((i * 37 + Math.floor(x / 7)) % 30);
      g.fillStyle = `rgb(${tone + 40},${tone + 6},${Math.round(tone * 0.62)})`;
      g.fillRect(x, y, len, hBoard);
      g.strokeStyle = "rgba(60,35,15,0.35)";
      g.lineWidth = 2;
      g.strokeRect(x, y, len, hBoard);
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(90,55,25,${0.08 + (k % 3) * 0.03})`;
        g.beginPath();
        const yy = y + (hBoard * (k + 0.5)) / 6;
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + 2, x + len * 0.6, yy - 2, x + len, yy);
        g.stroke();
      }
      x += len;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function labelSprite(text: string, sub: string): { sprite: THREE.Sprite; dispose: () => void } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = "800 44px system-ui, -apple-system, Segoe UI, sans-serif";
  const font2 = "600 30px system-ui, -apple-system, Segoe UI, sans-serif";
  g.font = font;
  const w1 = g.measureText(text.toUpperCase()).width;
  g.font = font2;
  const w2 = g.measureText(sub).width;
  c.width = Math.ceil(Math.max(w1, w2) + 48);
  c.height = 112;
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#0f172a";
  g.lineWidth = 4;
  g.strokeRect(2, 2, c.width - 4, c.height - 4);
  g.fillStyle = "#0f172a";
  g.font = font;
  g.textBaseline = "top";
  g.fillText(text.toUpperCase(), 24, 12);
  g.font = font2;
  g.fillStyle = "#475569";
  g.fillText(sub, 24, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.aspect = c.width / c.height;
  sprite.renderOrder = 10;
  return { sprite, dispose: () => { tex.dispose(); mat.dispose(); } };
}

type Built = { group: THREE.Group; dispose: () => void; wallMeshes: THREE.Mesh[]; itemGroups: THREE.Object3D[]; frame: { center: THREE.Vector3; radius: number; floorPoly: Array<{ x: number; z: number }> | null } };


/** The focus room's walls standing between the camera and the room (camera and room center on opposite sides). */
function nearWalls(doc: DesignDoc, room: Room | null, cam: THREE.Vector3 | null): Set<string> {
  const out = new Set<string>();
  if (!room || !cam) return out;
  const c = centroid(room.poly);
  const camP = { x: cam.x / FT, y: cam.z / FT };
  for (const w of doc.walls) {
    if (!room.wallIds.includes(w.id)) continue;
    const side = (p: { x: number; y: number }) => (w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x);
    if (Math.sign(side(c)) !== Math.sign(side(camP)) && Math.abs(side(camP)) > 1) out.add(w.id);
  }
  return out;
}

function build(doc: DesignDoc, focus: string | null, rooms: Room[], selected: string | null, wood: THREE.Texture, cut: Set<string> = new Set(), selectedItem: string | null = null): Built {
  const group = new THREE.Group();
  const owned: Array<{ dispose: () => void }> = [];
  const wallMeshes: THREE.Mesh[] = [];
  const itemGroups: THREE.Object3D[] = [];
  const mats = matCache();
  owned.push(mats);
  const focusRoom = focus ? rooms.find((r) => r.labelId === focus) ?? null : null;
  const focusWalls = new Set(focusRoom?.wallIds ?? []);
  const fin = finishesFor(doc.finishes, focus);

  // Floors: the room's own floor where it has finishes (the room being designed always), plain elsewhere.
  const floorMatFocus = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0 });
  const floorMatOther = new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.95 });
  owned.push(floorMatFocus, floorMatOther);
  const floorOf = (labelId: string | null): THREE.Material => {
    const f = labelId === focus ? fin : labelId && doc.finishes?.[labelId] ? finishesFor(doc.finishes, labelId) : null;
    if (!f) return floorMatOther;
    const fp = floorPreset(f.floor.id);
    return mats.get(`floor:${fp.id}:${f.floor.pattern}`, () => {
      const t = mats.tex(`ftex:${fp.id}:${f.floor.pattern}`, () => floorTexture(fp, f.floor.pattern));
      if (f.floor.pattern === "diagonal") {
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 4;
      }
      return new THREE.MeshStandardMaterial({ map: t, roughness: fp.kind === "tile" ? 0.35 : 0.6, metalness: 0 });
    });
  };
  for (const r of rooms) {
    const shape = new THREE.Shape(r.poly.map((p) => new THREE.Vector2(p.x * FT, -p.y * FT)));
    const geo = new THREE.ShapeGeometry(shape);
    // Planks ~5" wide: the texture (12 boards) repeats every 5 ft.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5, uv.getY(i) / 5);
    owned.push(geo);
    const isFocus = !focusRoom || r === focusRoom;
    const m = new THREE.Mesh(geo, isFocus && !doc.finishes && !focus ? floorMatFocus : floorOf(r.labelId));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.001;
    m.receiveShadow = true;
    group.add(m);
    const c = centroid(r.poly);
    const tag = labelSprite(r.names.length > 1 ? r.names.join(" · ") : r.name, `${Math.round(r.sqft)} sq ft`);
    owned.push(tag);
    tag.sprite.position.set(c.x * FT, (focusRoom && r !== focusRoom ? CUT : 30) * FT + 0.4, c.y * FT);
    tag.sprite.userData.dim = true;
    group.add(tag.sprite);
  }

  // Walls, cut around their openings — the room being designed in its paint (sheen, texture, an accent wall).
  const SHEEN = { flat: 0.95, eggshell: 0.85, satin: 0.7, semi: 0.5 } as const;
  const bump = wallBump(fin.wall.texture);
  if (bump) owned.push(bump);
  const paint = (hex: string) => mats.get(`paint:${hex}:${fin.wall.sheen}:${fin.wall.texture}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: SHEEN[fin.wall.sheen], bumpMap: bump ?? undefined, bumpScale: 0.6 }));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
  const wallMatExt = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9 });
  const wallMatSel = new THREE.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.7, emissive: 0x1d4ed8, emissiveIntensity: 0.12 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  owned.push(wallMat, wallMatExt, wallMatSel, capMat);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  owned.push(unit);
  const placeBox = (w: Wall, t0: number, t1: number, z0: number, z1: number, thick: number, mat: THREE.Material, shadows = true) => {
    const d = wallDir(w);
    const mid = (t0 + t1) / 2;
    const m = new THREE.Mesh(unit, mat);
    m.scale.set((t1 - t0) * FT, (z1 - z0) * FT, thick * FT);
    m.position.set((w.a.x + d.x * mid) * FT, ((z0 + z1) / 2) * FT, (w.a.y + d.y * mid) * FT);
    m.rotation.y = -Math.atan2(d.y, d.x);
    m.castShadow = shadows;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (const w of doc.walls) {
    const L = wallLen(w);
    if (L < 0.5 || w.boundary) continue; // a room boundary is open floor
    // The dollhouse: the room's own walls stand full height except those between the camera and the room.
    const full = (!focusRoom || focusWalls.has(w.id)) && !cut.has(w.id);
    const H = full ? w.height : Math.min(CUT, w.height);
    const accent = fin.accents?.find((a) => a.wallId === w.id);
    const mat = w.id === selected ? wallMatSel : focusRoom && focusWalls.has(w.id) ? paint(accent?.color ?? fin.wall.color) : w.exterior ? wallMatExt : wallMat;
    // Each piece runs a hair past the wall's ends so corners close (half the thickness each way).
    for (const pc of wallPieces({ ...w, height: H }, doc.openings)) {
      const t0 = pc.t0 === 0 ? -w.thick / 2 : pc.t0;
      const t1 = pc.t1 >= L - 0.01 ? L + w.thick / 2 : pc.t1;
      const m = placeBox(w, t0, t1, pc.z0, pc.z1, w.thick, mat);
      m.userData.wallId = w.id;
      wallMeshes.push(m);
    }
    // The cut top of a lowered wall reads as a section: a dark cap.
    if (!full) placeBox(w, -w.thick / 2, L + w.thick / 2, H, H + 0.4, w.thick + 0.2, capMat, false);
  }

  // Doors and windows.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfdbfe, roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.45 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xfafaf9, roughness: 0.55 });
  owned.push(glass, frameMat, doorMat);
  const byId = new Map(doc.walls.map((w) => [w.id, w]));
  const addOpening = (o: Opening) => {
    const w = byId.get(o.wallId);
    if (!w) return;
    const L = wallLen(w);
    const t0 = Math.max(0, o.at - o.width / 2);
    const t1 = Math.min(L, o.at + o.width / 2);
    const lowered = (focusRoom && !focusWalls.has(w.id)) || cut.has(w.id);
    if (o.kind === "window") {
      if (lowered && o.sill >= CUT) return;
      const top = Math.min(lowered ? CUT : w.height, o.sill + o.height);
      placeBox(w, t0, t1, o.sill, top, 0.6, glass, false);
      placeBox(w, t0, t1, o.sill - 1, o.sill, w.thick + 1, frameMat, false); // sill
      return;
    }
    if (o.kind === "opening") return;
    const d = wallDir(w);
    const n = { x: d.y, y: -d.x }; // left of a→b
    const side = o.swing === "right" ? -1 : 1;
    const H = Math.min(o.height, lowered ? CUT : o.height);
    const leaf = (hingeT: number, width: number, dirSign: number) => {
      // A leaf hung at hingeT, swung 60° open toward the swing side.
      const hinge = { x: w.a.x + d.x * hingeT + n.x * side * (w.thick / 2), y: w.a.y + d.y * hingeT + n.y * side * (w.thick / 2) };
      const ang = Math.atan2(d.y, d.x) + dirSign * side * -((60 * Math.PI) / 180);
      const m = new THREE.Mesh(unit, doorMat);
      m.scale.set(width * FT, H * FT, 1.6 * FT);
      const cx = hinge.x + Math.cos(ang) * (width / 2) * dirSign;
      const cy = hinge.y + Math.sin(ang) * (width / 2) * dirSign;
      m.position.set(cx * FT, (H / 2) * FT, cy * FT);
      m.rotation.y = -ang;
      m.castShadow = true;
      group.add(m);
    };
    if (o.kind === "door" || o.kind === "pocket") {
      if (o.hinge === "b") leaf(t1, o.width, -1);
      else leaf(t0, o.width, 1);
    } else if (o.kind === "double") {
      leaf(t0, o.width / 2, 1);
      leaf(t1, o.width / 2, -1);
    } else if (o.kind === "slider") {
      // Two panels in the wall's thickness, one slid half over the other.
      const mid = (t0 + t1) / 2;
      placeBox(w, t0, mid + 2, 0, H, 1.2, glass, false);
      const m = placeBox(w, mid - 2, t1, 0, H, 1.2, glass, false);
      m.position.x += n.x * 1.5 * FT;
      m.position.z += n.y * 1.5 * FT;
    }
  };
  for (const o of doc.openings) addOpening(o);

  // What's placed in the rooms: cabinets, appliances, lights, furniture — each built from its numbers.
  const items = doc.items ?? [];
  const lowered = (wallId: string | null | undefined) => !!wallId && (cut.has(wallId) || (!!focusRoom && !focusWalls.has(wallId)));
  for (const it of items) {
    // Wall-hung things on a wall that is cut away would float in the way.
    if (it.z >= 40 && lowered(it.wallId) && lib(it.lib)?.cat !== "light") continue;
    const f = finishesFor(doc.finishes, it.room ?? focus);
    const ceiling = (it.room ? doc.labels.find((l) => l.id === it.room)?.ceiling : focusRoom?.ceiling) ?? 96;
    const g = buildItem(it, { mats, f, ceiling, splashTop: splashTopFor(it, items, f.backsplash.height, ceiling) });
    placeItem(g, it);
    g.userData.itemId = it.id;
    g.traverse((o) => (o.userData.itemId = it.id));
    if (it.id === selectedItem) {
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(it.w * FT, it.h * FT, it.d * FT));
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1d4ed8 }));
      line.position.y = (it.h / 2) * FT;
      owned.push(edges, line.material as THREE.Material);
      g.add(line);
    }
    group.add(g);
    itemGroups.push(g);
    owned.push({ dispose: () => disposeOwn(g) });
  }

  // What the plan drew inside: traced on the floor until it is designed (hidden in a room that has its cabinets).
  const designedRoom = focusRoom && items.some((i) => i.room === focus) ? focusRoom : null;
  const markColor = { cabinet: 0xb45309, appliance: 0x0d9488, plumbing: 0x15803d } as const;
  for (const role of ["cabinet", "appliance", "plumbing"] as const) {
    const pos: number[] = [];
    for (const m of doc.marks) if (m.role === role && !(designedRoom && pointInPolyBox(m.box, designedRoom.poly))) for (const [a, b] of m.lines) pos.push(a.x * FT, 0.02, a.y * FT, b.x * FT, 0.02, b.y * FT);
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: markColor[role] });
    owned.push(geo, mat);
    group.add(new THREE.LineSegments(geo, mat));
  }

  // What to frame: what's been placed in the room (and a walkway round it), else the room, else the house.
  const placed = focusRoom ? items.filter((i) => i.room === focus && lib(i.lib)?.cat !== "light") : [];
  const pts = placed.length
    ? placed.flatMap((i) => {
        const r = Math.hypot(i.w, i.d) / 2 + 36;
        return [{ x: i.x - r, y: i.y - r }, { x: i.x + r, y: i.y + r }];
      })
    : focusRoom
      ? focusRoom.poly
      : doc.walls.flatMap((w) => [w.a, w.b]);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x * FT);
    x1 = Math.max(x1, p.x * FT);
    z0 = Math.min(z0, p.y * FT);
    z1 = Math.max(z1, p.y * FT);
  }
  if (!Number.isFinite(x0)) {
    x0 = z0 = 0;
    x1 = z1 = 12;
  }
  const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const radius = Math.max(6, Math.hypot(x1 - x0, z1 - z0) / 2);
  return {
    group,
    wallMeshes,
    itemGroups,
    frame: { center, radius, floorPoly: focusRoom ? focusRoom.poly.map((p) => ({ x: p.x * FT, z: p.y * FT })) : null },
    dispose: () => {
      for (const o of owned) o.dispose();
    },
  };
}

export function Room3D({ doc, focus, selectedWall = null, onPickWall, selectedItem = null, onPickItem, view = "orbit", frameToken = 0, className, label }: Room3DProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const api = React.useRef<{ set: (doc: DesignDoc, focus: string | null, selected: string | null, selItem: string | null) => void; frame: (walk: boolean) => void } | null>(null);
  const pickRef = React.useRef(onPickWall);
  const pickItemRef = React.useRef(onPickItem);
  const [supported] = React.useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    pickRef.current = onPickWall;
    pickItemRef.current = onPickItem;
  }, [onPickWall, onPickItem]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !supported) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    const w0 = mount.clientWidth || 800;
    const h0 = mount.clientHeight || 520;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w0, h0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color(0xeef2f6);
    const camera = new THREE.PerspectiveCamera(48, w0 / h0, 0.05, 2000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.15);
    world.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    world.add(sun, sun.target);
    // A soft room around everything, so stainless and glass read as what they are.
    let envTex: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = new RoomEnvironment();
      envTex = pmrem.fromScene(env, 0.04).texture;
      world.environment = envTex;
      world.environmentIntensity = 0.55;
      pmrem.dispose();
      env.dispose?.();
    } catch {
      /* optional */
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xdfe5ec, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);
    const wood = woodTexture();

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 0.5;

    let content: Built | null = null;
    let walk = false;
    let dirty = true;
    let span = 12;
    orbit.addEventListener("change", () => (dirty = true));

    const frame = (walkMode: boolean) => {
      if (!content) return;
      walk = walkMode;
      const { center, radius } = content.frame;
      span = radius;
      if (walkMode) {
        // Stand at the room's center at eye height, looking toward its longest side.
        camera.fov = 70;
        camera.position.set(center.x, EYE * FT, center.z + 0.01);
        orbit.target.set(center.x + 0.01, EYE * FT, center.z - 1);
        orbit.minDistance = 0.01;
        orbit.maxDistance = 0.02;
        orbit.enablePan = false;
        orbit.rotateSpeed = -0.35;
      } else {
        camera.fov = 48;
        // Frame the room with its walls: aim at mid-wall height, far enough back to see the far walls' tops.
        const r = Math.max(radius, 5.5);
        const dist = r * 2.6 + 4;
        camera.position.set(center.x + dist * 0.5, dist * 0.92 + 2, center.z + dist * 0.72);
        orbit.target.set(center.x, 2.5, center.z);
        orbit.minDistance = 0.5;
        orbit.maxDistance = radius * 8;
        orbit.enablePan = true;
        orbit.rotateSpeed = 1;
      }
      camera.updateProjectionMatrix();
      sun.position.set(center.x + radius * 1.4, radius * 3.2, center.z + radius * 0.9);
      sun.target.position.copy(center);
      const sc = sun.shadow.camera as THREE.OrthographicCamera;
      sc.left = sc.bottom = -radius * 2;
      sc.right = sc.top = radius * 2;
      sc.far = radius * 10;
      sc.updateProjectionMatrix();
      ground.scale.set(radius * 12, radius * 12, 1);
      ground.position.set(center.x, -0.01, center.z);
      orbit.update();
      dirty = true;
    };

    let args: { d: DesignDoc; f: string | null; sel: string | null; selItem: string | null; rooms: Room[] } | null = null;
    let cutKey = "";
    const rebuild = () => {
      if (!args) return;
      const room = args.f ? args.rooms.find((r) => r.labelId === args!.f) ?? null : null;
      const cut = walk ? new Set<string>() : nearWalls(args.d, room, camera.position);
      cutKey = [...cut].sort().join("|");
      if (content) {
        world.remove(content.group);
        content.dispose();
      }
      content = build(args.d, args.f, args.rooms, args.sel, wood, cut, args.selItem);
      world.add(content.group);
      dirty = true;
    };
    // Turning the camera round: re-cut when a different wall comes between it and the room.
    orbit.addEventListener("end", () => {
      if (!args || walk) return;
      const room = args.f ? args.rooms.find((r) => r.labelId === args!.f) ?? null : null;
      const key = [...nearWalls(args.d, room, camera.position)].sort().join("|");
      if (key !== cutKey) rebuild();
    });
    api.current = {
      set: (d, f, sel, selItem) => {
        args = { d, f, sel, selItem, rooms: roomsOf(d) };
        rebuild();
      },
      frame: (walkMode) => {
        frame(walkMode);
        rebuild();
      },
    };

    // Picking a wall: a click that didn't drag.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !content) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...content.itemGroups, ...content.wallMeshes], true)[0];
      const itemId = hit?.object.userData.itemId as string | undefined;
      if (itemId && pickItemRef.current) {
        pickItemRef.current(itemId);
        return;
      }
      pickRef.current?.((hit?.object.userData.wallId as string | undefined) ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // Walking: arrow keys / WASD move on the floor while walking in.
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (!walk) return;
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
      if (e.type === "keydown") keys.add(k);
      else keys.delete(k);
      e.preventDefault();
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.addEventListener("keydown", onKey);
    renderer.domElement.addEventListener("keyup", onKey);

    let raf = 0;
    let last = performance.now();
    const fwd = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (walk && keys.size) {
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const step = 4 * dt; // 4 ft a second
        const mv = new THREE.Vector3();
        if (keys.has("w") || keys.has("arrowup")) mv.add(fwd);
        if (keys.has("s") || keys.has("arrowdown")) mv.sub(fwd);
        if (keys.has("d") || keys.has("arrowright")) mv.add(right);
        if (keys.has("a") || keys.has("arrowleft")) mv.sub(right);
        mv.multiplyScalar(step);
        camera.position.add(mv);
        orbit.target.add(mv);
        dirty = true;
      }
      const moved = orbit.update();
      if (!moved && !dirty) return;
      dirty = false;
      if (content) {
        const d = camera.position.distanceTo(orbit.target);
        const size = walk ? 0.55 : Math.max(0.5, Math.min(span * 0.12, d * 0.05));
        content.group.traverse((o) => {
          if (o instanceof THREE.Sprite && o.userData.dim) o.scale.set(size * (o.userData.aspect as number), size, 1);
        });
      }
      renderer.render(world, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || w0;
      const h = mount.clientHeight || h0;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    });
    ro.observe(mount);

    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("keydown", onKey);
      renderer.domElement.removeEventListener("keyup", onKey);
      orbit.dispose();
      if (content) {
        world.remove(content.group);
        content.dispose();
      }
      wood.dispose();
      envTex?.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [supported]);

  // The design, the room and the selection: rebuild; the camera only moves when asked (frameToken, view).
  React.useEffect(() => {
    api.current?.set(doc, focus, selectedWall, selectedItem);
  }, [doc, focus, selectedWall, selectedItem]);
  React.useEffect(() => {
    api.current?.frame(view === "walk");
  }, [view, frameToken, focus]);

  if (!supported) return <div className={className}>3D needs WebGL, which this browser has turned off.</div>;
  return <div ref={mountRef} className={className} role="img" aria-label={label ?? "The room in 3D"} />;
}
