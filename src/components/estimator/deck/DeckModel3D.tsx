"use client";
// THE DECK STUDIO'S 3D (2026-10-04; roofs 2026-10-10; version 3 M3 2026-10-10).
// Vanilla Three.js, like FenceModel3D and RoofModel3D: the renderer, the sky,
// the lights and the ground are built ONCE; the structure itself is a group
// rebuilt whenever the scene's data changes, and the things that change many
// times a second — how much is standing, the x-ray, the night — only touch
// instance counts, material opacity and light intensity.
//
// Owner (M3): "show it as it is made in real — the cuts in degrees, the
// bolts, the hangers; zoom in on any part; the lights light up." So:
//   · every box is placed by its own matrix, and a sloped member (a rafter,
//     a hip, a rake board, a stringer) is SHEARED so its ends are plumb cuts,
//     the way a saw leaves them, instead of square to the slope;
//   · the hardware layer draws the lags, hangers, ties, bases, caps and
//     flashing where the engine put them, in galvanized grey;
//   · a touch on any part names it from the scene's legend (its stock, its
//     length, its cuts, its fasteners) and a click flies the camera to it;
//     the Connections toggle numbers the joints worth a look;
//   · the night view drops the sun, and the fixtures glow (a few of them
//     throw real light) — a fixture the client brings is drawn as a
//     see-through sample;
//   · when the studio is placing a fixture, a click reports the spot and
//     what it landed on, nothing more.
//
// The data is lib/deck/scene.ts's box list, in feet: x along the house, y
// out from it, z up. Here x stays X, z becomes Y (up) and y becomes Z, with
// the deck's middle at the origin, so the house is behind the deck and the
// camera stands in the yard.
import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { SCENE_LAYERS, sceneBuildLayers, type DeckScene, type SceneHandle, type SceneLayer, type SceneLegend } from "@/lib/deck/scene";

/** A drag on a handle: the design number it moves, and the value it should take now (feet for sizes, inches for heights). */
export interface DeckEdit {
  kind: SceneHandle["kind"];
  id: string;
  value: number;
  /** The pointer came up: the last value of this drag. */
  done: boolean;
}

/** What a touch landed on, for the studio's label and the fixture placer. */
export interface DeckPick {
  /** The part's legend entry (null for the ground, the house or a part with no tag). */
  legend: SceneLegend | null;
  layer: SceneLayer | "ground" | "house" | null;
  /** The point hit, in the scene's feet: x along the house, y out from it, z up. */
  point: [number, number, number];
  /** What a fixture placed here would be mounted on. */
  mount: "post" | "header" | "rail" | "deck" | "ceiling" | "wall" | "stair" | "peak";
}

export interface DeckModel3DProps {
  scene: DeckScene;
  /** Layers standing, counted in build order over the layers this scene has (lib/deck/scene sceneBuildLayers): 0 … n. A fraction stands part of a layer, piece by piece. Left out: everything stands. */
  built?: number;
  /** Fade the boards, the roofing, the ceiling and the ground. */
  xray?: boolean;
  /** Evening: the sun down, the fixtures lit. */
  night?: boolean;
  /** Number the connections worth a look. */
  connections?: boolean;
  /** A click reports the spot (for placing a fixture) instead of flying to the part. */
  placing?: boolean;
  className?: string;
  /** Read out for the canvas. */
  label?: string;
  /** Change it to put the camera back on the three-quarter view from the yard. */
  resetToken?: number;
  /** A part touched or clicked (null when the touch left every part). */
  onPick?: (pick: DeckPick | null, kind: "hover" | "click") => void;
  /** Fly to this point in the scene's feet when it changes. */
  focus?: [number, number, number] | null;
  /** Show the handles and let them be dragged. */
  edit?: boolean;
  /** A handle moved: the design number it stands for, and its new value. */
  onEdit?: (edit: DeckEdit) => void;
  /** The house's own wall from the contractor's photo, standing where the house is (null: the drawn house). */
  backdrop?: DeckBackdrop | null;
}

/**
 * THE PHOTO AS THE WALL (2026-10-10). Owner: "make that picture turnable like
 * a 3D — on the 3D page, when the picture is adapted, let me work with this
 * wall when I'm building the deck." The photo the studio placed the
 * elevation on stands in the scene as the house: the same scale and ground
 * line the placement used (lib/deck/elevation elevationOverlay), so the deck
 * meets the wall exactly where the photo view shows it. Where the wall
 * steps (the read's jogs), the picture is cut at the step and each part
 * stands at its own depth, with a plain return wall between them.
 */
export interface DeckBackdrop {
  /** The picture's read link. */
  href: string;
  /** Its pixels. */
  w: number;
  h: number;
  /** Where the deck's elevation was placed on it: the ground line's left end and its width, as fractions of the picture. */
  placed: { x: number; y: number; w: number };
  /** The elevation that placement was made for: its width, and where the deck's x = 0 lands in it, ft. */
  elevWidthFt: number;
  elevLeftFt: number;
  /** Where the wall steps, as fractions of the picture's width; "toward" brings the part to the right nearer by `depthFt`. */
  jogs: Array<{ x: number; dir: "toward" | "away"; depthFt: number | null }>;
}
/** A step in the wall the read could not size. */
const JOG_DEFAULT_FT = 2;
const RETURN_WALL = 0xb9b3a8;

const LAYER_COUNT = SCENE_LAYERS.length;
const layerIndex = (name: SceneLayer) => SCENE_LAYERS.indexOf(name);
const DECKING = layerIndex("decking");
const FASCIA = layerIndex("fascia");
const FOOTING = layerIndex("footing");
const BRACE = layerIndex("brace");
const SHEATHING = layerIndex("sheathing");
const ROOFING = layerIndex("roofing");
const CEILING = layerIndex("ceiling");
const TRIM = layerIndex("trim");
const GUTTER = layerIndex("gutter");
const SLAB = layerIndex("slab");
const GLASS = layerIndex("glass");
const SCREEN = layerIndex("screen");
const WALL = layerIndex("wall");
const HARDWARE = layerIndex("hardware");
const LIGHT = layerIndex("light");
const WIRE = layerIndex("wire");
/** Layers the x-ray fades. */
const FADES = new Set([DECKING, FASCIA, SHEATHING, ROOFING, CEILING, TRIM, GLASS, SCREEN, WALL]);
/** Legend roles whose ends are plumb cuts (sheared boxes). */
const PLUMB_CUT = /^(rafter|jack|fly|hip|fascia rake|stringer|stair rail|roof brace|brace)$/;
const MOUNT_OF: Partial<Record<SceneLayer, DeckPick["mount"]>> = { post: "post", "roof-post": "post", header: "header", beam: "header", rail: "rail", glass: "rail", decking: "deck", fascia: "deck", rim: "deck", joist: "deck", ceiling: "ceiling", rafter: "ceiling", sheathing: "ceiling", roofing: "ceiling", ridge: "peak", stair: "stair", wall: "wall", screen: "wall", ledger: "wall", light: "deck", wire: "deck" };

const CONCRETE = 0xb9b6ad;
const GRASS = 0x8fa078;
const SIDING = 0xe9e5db;
const FOUNDATION = 0xa9a69d;
const ROOF = 0x55524c;
const GLASS_C = 0x2f3a44;
const TRIM_WHITE = 0xf7f5ef;
const OSB = 0xd6bf90;
const CEILING_WOOD = 0xe6d5b2;
const ALUMINUM = 0xd9d6cf;
const GALV = 0x9a9ea3;
const WIRE_C = 0x3a3a3f;
const LIGHT_C = 0xf4efe4;
const INK = 0x0f1419;

function webglSupported(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A little lighter or darker, the same for the same piece every time. */
function jitter(base: THREE.Color, i: number, amount: number): THREE.Color {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const t = (n - Math.floor(n) - 0.5) * 2 * amount;
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + t)));
}

/* ── Procedural textures: lap siding, wood grain, shingles, metal ribs, grass, concrete ── */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function sidingTexture() {
  return canvasTexture(8, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 8, 64);
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.fillRect(0, 60, 8, 4);
    g.fillStyle = "rgba(0,0,0,0.05)";
    g.fillRect(0, 52, 8, 8);
  });
}
/** Wood grain: fine streaks along x, a pale base the instance colour tints. */
function grainTexture() {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * 64;
      const a = 0.04 + Math.random() * 0.09;
      g.strokeStyle = `rgba(60,40,20,${a})`;
      g.lineWidth = 0.6 + Math.random() * 1.4;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 1.5);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(80,55,30,${0.05 + Math.random() * 0.06})`;
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 64, 6 + Math.random() * 10, 2 + Math.random() * 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}
/** Shingle courses: a shadow line under every course, tabs staggered. */
function shingleTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      const y = row * 32;
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(0, y + 29, 128, 3);
      g.fillStyle = "rgba(0,0,0,0.10)";
      g.fillRect(0, y + 24, 128, 5);
      const off = row % 2 ? 21 : 0;
      for (let x = -off; x < 128; x += 42) {
        g.fillStyle = "rgba(0,0,0,0.22)";
        g.fillRect(x + 40, y + 8, 2, 24);
      }
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        g.fillRect(Math.random() * 128, y + Math.random() * 28, 3, 2);
      }
    }
  });
}
/** Standing seams / panel ribs every so often. */
function ribTexture() {
  return canvasTexture(128, 16, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, 0, 3, 16);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(3, 0, 2, 16);
    g.fillStyle = "rgba(0,0,0,0.06)";
    g.fillRect(64, 0, 1, 16);
  });
}
function grassTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 40},${40 + Math.random() * 30},${10 + Math.random() * 20},${0.06 + Math.random() * 0.14})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 3);
    }
  });
}
function concreteTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 64, Math.random() * 64, 1, 1);
    }
  });
}

/** A dimension's figure, or a callout's number, on a small white tag. */
function tagSprite(text: string, accent = false): { sprite: THREE.Sprite; dispose: () => void } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const pad = 14;
  const font = "700 44px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  let w = 160;
  if (g) {
    g.font = font;
    w = Math.max(72, Math.ceil(g.measureText(text).width) + pad * 2);
  }
  c.width = w;
  c.height = 72;
  if (g) {
    g.fillStyle = accent ? "#1854a0" : "#ffffff";
    if (accent) {
      g.beginPath();
      g.roundRect(2, 2, w - 4, 68, 34);
      g.fill();
    } else g.fillRect(0, 0, w, 72);
    g.strokeStyle = accent ? "#ffffff" : "#0f1419";
    g.lineWidth = 4;
    if (accent) {
      g.beginPath();
      g.roundRect(2, 2, w - 4, 68, 34);
      g.stroke();
    } else g.strokeRect(2, 2, w - 4, 68);
    g.font = font;
    g.fillStyle = accent ? "#ffffff" : "#0f1419";
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillText(text, w / 2, 38);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  sprite.userData.aspect = w / 72;
  return { sprite, dispose: () => { tex.dispose(); mat.dispose(); } };
}

const feetInches = (ft: number) => {
  const inches = Math.round(ft * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
};

interface Built {
  group: THREE.Group;
  /** Per layer: the instanced meshes, how many pieces each holds, and which box each instance is. */
  layers: Array<Array<{ mesh: THREE.InstancedMesh; total: number; boxIdx: number[] }>>;
  /** Per layer: the flat polygons as one geometry, with the index end of each and the poly index of each range. */
  polys: Array<{ mesh: THREE.Mesh; ends: number[]; polyIdx: number[] } | null>;
  /** Braces, drawn one mesh each. */
  braces: THREE.Mesh[];
  /** Boards cut to a shape: one geometry, a range of it per board. */
  diagonal: { mesh: THREE.Mesh; ends: number[] } | null;
  /** Each layer's step in this scene's build-up (−1 = not in the scene). */
  rank: number[];
  fade: THREE.Material[];
  lightMat: THREE.MeshStandardMaterial | null;
  pointLights: THREE.PointLight[];
  callouts: THREE.Sprite[];
  /** The edit handles, one mesh each, with the handle they stand for. */
  handles: THREE.Mesh[];
  /** The DOM knob over each handle (same order). */
  knobs: HTMLButtonElement[];
  /** The world-space centre and size of every box (for the fly-to). */
  centres: Array<[THREE.Vector3, number]>;
  dispose: () => void;
}

export function DeckModel3D({ scene, built = Number.POSITIVE_INFINITY, xray = false, night = false, connections = false, placing = false, className, label, resetToken = 0, onPick, focus = null, edit = false, onEdit, backdrop = null }: DeckModel3DProps) {
  const mountRef = React.useRef<HTMLDivElement>(null);
  const [supported] = React.useState(webglSupported);
  const sceneRef = React.useRef(scene);
  const backdropRef = React.useRef(backdrop);
  const builtRef = React.useRef(built);
  const xrayRef = React.useRef(xray);
  const nightRef = React.useRef(night);
  const connRef = React.useRef(connections);
  const placingRef = React.useRef(placing);
  const editRef = React.useRef(edit);
  const pickRef = React.useRef(onPick);
  const editCbRef = React.useRef(onEdit);
  React.useEffect(() => {
    pickRef.current = onPick;
    editCbRef.current = onEdit;
  }, [onPick, onEdit]);
  /** Set by the mount effect: rebuild from the scene, re-apply what is standing, go back to the first view, fly somewhere. */
  const api = React.useRef<{ rebuild: () => void; apply: () => void; reset: () => void; flyTo: (p: [number, number, number], size?: number) => void } | null>(null);

  React.useEffect(() => {
    if (resetToken) api.current?.reset();
  }, [resetToken]);
  // Rebuilt when the picture, its placement or a step changes — by value, so a parent's fresh object alone does not.
  const backdropKey = backdrop ? JSON.stringify(backdrop) : "";
  React.useEffect(() => {
    backdropRef.current = backdrop;
    api.current?.rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the backdrop's value
  }, [backdropKey]);
  React.useEffect(() => {
    if (focus) api.current?.flyTo(focus, 4);
  }, [focus]);
  React.useEffect(() => {
    sceneRef.current = scene;
    api.current?.rebuild();
  }, [scene]);
  React.useEffect(() => {
    builtRef.current = built;
    xrayRef.current = xray;
    nightRef.current = night;
    connRef.current = connections;
    placingRef.current = placing;
    editRef.current = edit;
    api.current?.apply();
  }, [built, xray, night, connections, placing, edit]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !supported) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    let coarse = false;
    try {
      coarse = window.matchMedia("(pointer: coarse)").matches;
    } catch {
      coarse = false;
    }
    const w0 = mount.clientWidth || 800;
    const h0 = mount.clientHeight || 480;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w0, h0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);
    // The edit knobs (M3): DOM buttons that follow the handles across the screen — a thumb's size, focusable, with the arrow keys as a second way to move them.
    if (getComputedStyle(mount).position === "static") mount.style.position = "relative";
    const knobLayer = document.createElement("div");
    knobLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    knobLayer.dataset.deckKnobs = "";
    mount.appendChild(knobLayer);

    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, w0 / h0, 0.1, 4000);

    // Sky and light: a warm sun over the yard by day; by night the sun goes under and the fixtures take over.
    const sunDay = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(140));
    const sunNight = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(93), THREE.MathUtils.degToRad(140));
    const tuneSky = (s: Sky, nightTime: boolean) => {
      const u = (s.material as THREE.ShaderMaterial).uniforms;
      u.sunPosition.value.copy(nightTime ? sunNight : sunDay);
      u.turbidity.value = nightTime ? 2 : 5;
      u.rayleigh.value = nightTime ? 0.2 : 1.3;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
    };
    const sky = new Sky();
    sky.scale.setScalar(3000);
    tuneSky(sky, false);
    world.add(sky);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a8468, 0.75);
    world.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.castShadow = true;
    key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    key.shadow.bias = -0.0004;
    world.add(key);
    world.add(key.target);
    let envTex: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const envSky = new Sky();
      envSky.scale.setScalar(3000);
      tuneSky(envSky, false);
      envScene.add(envSky);
      envTex = pmrem.fromScene(envScene).texture;
      world.environment = envTex;
      world.environmentIntensity = 0.45;
      envSky.geometry.dispose();
      (envSky.material as THREE.Material).dispose();
      pmrem.dispose();
    } catch {
      /* the environment is optional */
    }

    const grass = grassTexture();
    const groundGeo = new THREE.PlaneGeometry(1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, metalness: 0, transparent: true, opacity: 1, map: grass });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI * 0.495;
    orbit.minDistance = 1.2;

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    const siding = sidingTexture();
    const grain = grainTexture();
    const shingles = shingleTexture();
    const ribs = ribTexture();
    const concrete = concreteTexture();
    let dirty = true;
    let content: Built | null = null;
    // A handle drag: the pointer's movement along the handle's axis, read on a plane through the handle; `last` is the value last sent.
    let drag: { handle: SceneHandle; plane: THREE.Plane; start: THREE.Vector3; last: number } | null = null;
    // The knob that had the keyboard, so a rebuild hands it back.
    let focusedKnob: string | null = null;
    let span = 20;
    let fitted: { w: number; d: number; h: number } | null = null;

    // The photo of the house as a texture, loaded once per link; a failed load leaves the wall plain.
    const textures = new Map<string, THREE.Texture>();
    const photoMats: THREE.MeshBasicMaterial[] = [];
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const photoTexture = (href: string): THREE.Texture => {
      const hit = textures.get(href);
      if (hit) return hit;
      mount.dataset.deck3dBackdrop = "loading";
      const tex = loader.load(
        href,
        () => {
          mount.dataset.deck3dBackdrop = "loaded";
          dirty = true;
        },
        undefined,
        () => {
          mount.dataset.deck3dBackdrop = "failed";
          for (const m of photoMats) {
            if (m.map === tex) {
              m.map = null;
              m.color.set(SIDING);
              m.needsUpdate = true;
            }
          }
          dirty = true;
        },
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      textures.set(href, tex);
      return tex;
    };

    /** The camera's first view for this deck, or the same angle refitted to a new size. */
    const frame = (reset: boolean) => {
      const s = sceneRef.current;
      const peak = Math.max(s.heightFt, s.peakFt ?? s.heightFt);
      const next = Math.max(s.widthFt, s.depthFt, peak * 1.4, 10);
      const target = new THREE.Vector3(0, Math.max(1, peak * 0.45), 0);
      const narrow = Math.max(1, 1.4 / Math.max(0.3, camera.aspect));
      if (reset || !fitted) {
        camera.position.set(target.x + next * 0.9 * narrow, target.y + (next * 0.5 + peak * 0.3) * narrow, target.z + next * 1.2 * narrow);
      } else {
        const offset = camera.position.clone().sub(orbit.target).multiplyScalar(next / span);
        camera.position.copy(target).add(offset);
      }
      span = next;
      orbit.target.copy(target);
      orbit.maxDistance = span * 6;
      camera.near = Math.max(0.05, span / 600);
      camera.far = span * 60 + 4000;
      camera.updateProjectionMatrix();
      ground.scale.set(span * 14, span * 14, 1);
      grass.repeat.set(span * 1.4, span * 1.4);
      key.position.set(span * 0.9, span * 1.6 + peak, span * 0.75);
      key.target.position.set(0, 0, 0);
      const sc = key.shadow.camera as THREE.OrthographicCamera;
      sc.left = -span * 1.5;
      sc.right = span * 1.5;
      sc.top = span * 1.5;
      sc.bottom = -span * 1.5;
      sc.near = 0.1;
      sc.far = span * 6 + peak * 4;
      sc.updateProjectionMatrix();
      key.shadow.normalBias = span * 0.0012;
      fitted = { w: s.widthFt, d: s.depthFt, h: peak };
      orbit.update();
      dirty = true;
    };

    /** The ground's tilt: the lawn falls away from the house (and across) as the site says. */
    const tiltGround = () => {
      const s = sceneRef.current;
      const g = s.ground;
      const ox = s.widthFt / 2;
      const oz = s.depthFt / 2;
      const outPerFt = g ? g.outDropFt / Math.max(1, s.depthFt) : 0;
      const acrossPerFt = g ? g.acrossDropFt / Math.max(1, s.widthFt) : 0;
      // The plane z = −out·y − across·x in scene feet, zero at the house line's left corner.
      const n = new THREE.Vector3(acrossPerFt, 1, outPerFt).normalize();
      ground.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      ground.position.set(0, -(outPerFt * oz + acrossPerFt * ox), 0);
    };

    const build = (): Built => {
      const s = sceneRef.current;
      const group = new THREE.Group();
      const ox = s.widthFt / 2;
      const oz = s.depthFt / 2;
      const owned: Array<{ dispose: () => void }> = [];
      const fade: THREE.Material[] = [];
      const centres: Array<[THREE.Vector3, number]> = [];
      const frameColor = new THREE.Color(s.colors.frame);
      const deckColor = new THREE.Color(s.colors.decking);
      const roofColor = new THREE.Color(s.colors.roofing ?? "#565250");
      const railColor = new THREE.Color(s.colors.rail ?? s.colors.frame);
      const metalRoof = s.colors.roofing === "#6f7478" || s.colors.roofing === "#3f4a55";
      const tone = (c: THREE.Color, by: number) => jitter(c, 1, 0).offsetHSL(0, 0, by);
      const baseOf = (name: SceneLayer): THREE.Color => {
        switch (name) {
          case "decking":
            return deckColor;
          case "fascia":
            return tone(deckColor, -0.05);
          case "footing":
          case "slab":
            return new THREE.Color(CONCRETE);
          case "beam":
          case "header":
            return tone(frameColor, -0.05);
          case "post":
          case "roof-post":
            return tone(frameColor, -0.08);
          case "ridge":
            return tone(frameColor, -0.03);
          case "stair":
            return tone(deckColor, -0.02);
          case "rail":
            return railColor;
          case "glass":
            return new THREE.Color(0xbfe0ef);
          case "screen":
            return new THREE.Color(0x30343a);
          case "wall":
            return new THREE.Color(SIDING);
          case "hardware":
            return new THREE.Color(GALV);
          case "light":
            return new THREE.Color(LIGHT_C);
          case "wire":
            return new THREE.Color(WIRE_C);
          case "sheathing":
            return new THREE.Color(OSB);
          case "roofing":
            return roofColor;
          case "trim":
            return new THREE.Color(TRIM_WHITE);
          case "gutter":
            return new THREE.Color(ALUMINUM);
          case "ceiling":
            return new THREE.Color(CEILING_WOOD);
          default:
            return frameColor;
        }
      };
      const woodLayer = (i: number) => i !== FOOTING && i !== SLAB && i !== HARDWARE && i !== LIGHT && i !== WIRE && i !== GLASS && i !== SCREEN && i !== WALL && i !== GUTTER && i !== TRIM && i !== SHEATHING && i !== ROOFING && i !== CEILING;
      let lightMat: THREE.MeshStandardMaterial | null = null;
      const mats: THREE.MeshStandardMaterial[] = SCENE_LAYERS.map((name, i) => {
        const base = baseOf(name);
        const tinted = i !== FOOTING && i !== SLAB;
        const m = new THREE.MeshStandardMaterial({
          color: tinted ? 0xffffff : base,
          roughness: i === DECKING ? 0.72 : i === GUTTER ? 0.5 : i === HARDWARE ? 0.45 : i === ROOFING ? 0.85 : i === GLASS ? 0.1 : i === LIGHT ? 0.4 : 0.9,
          metalness: i === GUTTER ? 0.4 : i === HARDWARE ? 0.65 : i === GLASS ? 0.2 : 0,
          map: woodLayer(i) ? grain : i === FOOTING || i === SLAB ? concrete : null,
          transparent: i === GLASS || i === SCREEN,
          opacity: i === GLASS ? 0.35 : i === SCREEN ? 0.55 : 1,
          side: i === GLASS || i === SCREEN ? THREE.DoubleSide : THREE.FrontSide,
        });
        if (i === LIGHT) {
          m.emissive = new THREE.Color(0xffe2b0);
          m.emissiveIntensity = 0.15;
          lightMat = m;
        }
        m.userData.base = base;
        owned.push(m);
        if (FADES.has(i)) fade.push(m);
        return m;
      });

      const order = sceneBuildLayers(s);
      const rank = SCENE_LAYERS.map((name) => order.indexOf(name));
      const legendOf = (i: number): SceneLegend | null => (s.tags.length === s.boxes.length && s.tags[i] >= 0 ? s.legend[s.tags[i]] ?? null : null);

      const layers: Built["layers"] = SCENE_LAYERS.map(() => []);
      const braces: THREE.Mesh[] = [];
      const basis = new THREE.Matrix4();
      const shear = new THREE.Matrix4();
      const scale = new THREE.Matrix4();
      const trans = new THREE.Matrix4();
      const m4 = new THREE.Matrix4();
      const ax = new THREE.Vector3();
      const ay = new THREE.Vector3();
      const az = new THREE.Vector3();
      for (let L = 0; L < LAYER_COUNT; L++) {
        if (L === FOOTING) continue;
        const idx: number[] = [];
        s.boxes.forEach((b, i) => {
          if (b[0] === L && b[7] === 0) idx.push(i);
        });
        if (idx.length) {
          const mesh = new THREE.InstancedMesh(unitBox, mats[L], idx.length);
          mesh.castShadow = L !== HARDWARE && L !== WIRE && L !== LIGHT && L !== GLASS && L !== SCREEN;
          mesh.receiveShadow = true;
          const base = mats[L].userData.base as THREE.Color;
          idx.forEach((bi, k) => {
            const b = s.boxes[bi];
            const turned = b.length >= 10 && (b[8] !== 0 || b[9] !== 0);
            const yaw = turned ? b[8] : 0;
            const tilt = turned ? b[9] : 0;
            if (turned) {
              // A turned member: its axis points `yaw` from +x in plan and rises `tilt`.
              ax.set(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
              ay.set(-Math.cos(yaw) * Math.sin(tilt), Math.cos(tilt), -Math.sin(yaw) * Math.sin(tilt));
              az.set(-Math.sin(yaw), 0, Math.cos(yaw));
              basis.makeBasis(ax, ay, az);
            } else basis.identity();
            // A sloped member's ends are plumb cuts: shear the box so each end face stands vertical in the world.
            const lg = legendOf(bi);
            const plumb = turned && Math.abs(tilt) > 0.02 && Math.abs(tilt) < 1.45 && !!lg && PLUMB_CUT.test(lg.role);
            shear.identity();
            if (plumb) shear.elements[4] = Math.tan(tilt) * (b[6] / b[4]);
            scale.makeScale(b[4], b[6], b[5]);
            trans.makeTranslation(b[1] - ox, b[3], b[2] - oz);
            m4.copy(trans).multiply(basis).multiply(shear).multiply(scale);
            mesh.setMatrixAt(k, m4);
            mesh.setColorAt(k, L === LIGHT && s.glows.some((g) => Math.abs(g[0] - b[1]) < 0.05 && Math.abs(g[1] - b[2]) < 0.05 && Math.abs(g[2] - b[3]) < 0.05) ? new THREE.Color(s.glows.find((g) => Math.abs(g[0] - b[1]) < 0.05 && Math.abs(g[1] - b[2]) < 0.05 && Math.abs(g[2] - b[3]) < 0.05)![3]).lerp(new THREE.Color(0xffffff), 0.45) : jitter(base, bi + L * 97, L === DECKING ? 0.045 : L === TRIM || L === GUTTER || L === HARDWARE ? 0.01 : 0.03));
            centres[bi] = [new THREE.Vector3(b[1] - ox, b[3], b[2] - oz), Math.max(b[4], b[5], b[6])];
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.userData.layer = L;
          group.add(mesh);
          layers[L].push({ mesh, total: idx.length, boxIdx: idx });
        }
      }
      // Knee braces: a 2x4 on the diagonal of its box.
      const braceMat = new THREE.MeshStandardMaterial({ color: tone(frameColor, -0.02), roughness: 0.9, map: grain });
      owned.push(braceMat);
      s.boxes.forEach((b, bi) => {
        if (b[0] !== BRACE || b[7] === 0) return;
        const alongX = b[7] === 1 || b[7] === 2;
        const run = alongX ? b[4] : b[5];
        const rise = b[6];
        const length = Math.hypot(run, rise);
        const angle = Math.atan2(rise, run);
        const mesh = new THREE.Mesh(unitBox, braceMat);
        mesh.castShadow = true;
        mesh.position.set(b[1] - ox, b[3], b[2] - oz);
        if (alongX) {
          mesh.scale.set(length, 3.5 / 12, 1.5 / 12);
          mesh.rotation.z = b[7] === 1 ? angle : -angle;
        } else {
          mesh.scale.set(1.5 / 12, 3.5 / 12, length);
          mesh.rotation.x = b[7] === 3 ? -angle : angle;
        }
        mesh.userData.layer = BRACE;
        mesh.userData.boxIdx = bi;
        centres[bi] = [mesh.position.clone(), length];
        group.add(mesh);
        braces.push(mesh);
      });

      // Footings: the pad at the bottom of the hole, the pier up to its top.
      if (s.footings.length) {
        const mat = mats[FOOTING];
        const pads = new THREE.InstancedMesh(unitCyl, mat, s.footings.length);
        const piers = new THREE.InstancedMesh(unitCyl, mat, s.footings.length);
        const dummy = new THREE.Object3D();
        s.footings.forEach((f, i) => {
          const [x, y, pad, thick, pier, depth, top] = f;
          dummy.quaternion.identity();
          dummy.position.set(x - ox, -depth + thick / 2, y - oz);
          dummy.scale.set(pad, thick, pad);
          dummy.updateMatrix();
          pads.setMatrixAt(i, dummy.matrix);
          const pierHeight = Math.max(0.05, depth - thick + top);
          dummy.position.set(x - ox, top - pierHeight / 2, y - oz);
          dummy.scale.set(pier, pierHeight, pier);
          dummy.updateMatrix();
          piers.setMatrixAt(i, dummy.matrix);
        });
        pads.instanceMatrix.needsUpdate = true;
        piers.instanceMatrix.needsUpdate = true;
        piers.castShadow = true;
        piers.receiveShadow = true;
        pads.userData.layer = FOOTING;
        piers.userData.layer = FOOTING;
        group.add(pads, piers);
        layers[FOOTING].push({ mesh: pads, total: s.footings.length, boxIdx: [] }, { mesh: piers, total: s.footings.length, boxIdx: [] });
      }

      /** Flat rings into one geometry: a fan per ring, both faces, planar UVs, a range of the index per ring. */
      const fanGeometry = (rings: Array<{ pts: Array<[number, number, number]>; color: THREE.Color }>, uvScale: number): { geo: THREE.BufferGeometry; ends: number[] } => {
        const positions: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        const ends: number[] = [];
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const p0 = new THREE.Vector3();
        const pv = new THREE.Vector3();
        for (const ring of rings) {
          const start = positions.length / 3;
          // UVs on the ring's own plane: u along its first edge, v up the slope.
          p0.set(...ring.pts[0]);
          e1.set(...ring.pts[1]).sub(p0).normalize();
          e2.set(...ring.pts[Math.min(2, ring.pts.length - 1)]).sub(p0);
          nrm.crossVectors(e1, e2).normalize();
          e2.crossVectors(nrm, e1).normalize();
          for (const p of ring.pts) {
            positions.push(p[0], p[1], p[2]);
            colors.push(ring.color.r, ring.color.g, ring.color.b);
            pv.set(p[0], p[1], p[2]).sub(p0);
            uvs.push(pv.dot(e1) * uvScale, pv.dot(e2) * uvScale);
          }
          for (let k = 1; k + 1 < ring.pts.length; k++) index.push(start, start + k, start + k + 1);
          ends.push(index.length);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        return { geo, ends };
      };

      // Boards cut to a shape (a bow, a clip, a diagonal): each ring a thin prism, all in one geometry.
      let diagonal: Built["diagonal"] = null;
      if (s.diagonal && s.diagonal.boards.length) {
        const positions: number[] = [];
        const colors: number[] = [];
        const index: number[] = [];
        const ends: number[] = [];
        s.diagonal.boards.forEach((ring, bi) => {
          const top = s.diagonal!.zs?.[bi] ?? s.heightFt;
          const bottom = top - s.diagonal!.thickFt;
          const n = ring.length / 2;
          const start = positions.length / 3;
          const c = jitter(deckColor, bi, 0.045);
          for (const y of [top, bottom]) {
            for (let k = 0; k < n; k++) {
              positions.push(ring[k * 2] - ox, y, ring[k * 2 + 1] - oz);
              colors.push(c.r, c.g, c.b);
            }
          }
          for (let k = 1; k + 1 < n; k++) {
            index.push(start, start + k + 1, start + k);
            index.push(start + n, start + n + k, start + n + k + 1);
          }
          for (let k = 0; k < n; k++) {
            const a = start + k;
            const b2 = start + ((k + 1) % n);
            index.push(a, b2, a + n, b2, b2 + n, a + n);
          }
          ends.push(index.length);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, flatShading: true, side: THREE.DoubleSide });
        owned.push(geo, mat);
        fade.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.layer = DECKING;
        group.add(mesh);
        diagonal = { mesh, ends };
      }

      // The roof's faces, the ceiling, the soffit, a slab, glass, screens, walls: flat polygons, one geometry per layer.
      const polys: Built["polys"] = SCENE_LAYERS.map(() => null);
      for (let L = 0; L < LAYER_COUNT; L++) {
        const mine: number[] = [];
        s.polys.forEach((p, i) => {
          if (p[0] === L) mine.push(i);
        });
        if (!mine.length) continue;
        const base = mats[L].userData.base as THREE.Color;
        const rings = mine.map((pi, i) => {
          const p = s.polys[pi];
          const pts: Array<[number, number, number]> = [];
          for (let k = 1; k + 2 < p.length; k += 3) pts.push([p[k] - ox, p[k + 2], p[k + 1] - oz]);
          return { pts, color: jitter(base, i + L * 31, L === ROOFING ? 0.03 : 0.015) };
        });
        const { geo, ends } = fanGeometry(rings, L === ROOFING ? (metalRoof ? 1 / 3 : 1 / 2.7) : L === SLAB ? 0.5 : 0.25);
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: L === ROOFING ? (metalRoof ? 0.45 : 0.9) : L === GLASS ? 0.1 : 0.9,
          metalness: L === ROOFING && metalRoof ? 0.4 : L === GLASS ? 0.2 : 0,
          flatShading: true,
          side: THREE.DoubleSide,
          map: L === ROOFING ? (metalRoof ? ribs : shingles) : L === SLAB ? concrete : null,
          transparent: L === GLASS || L === SCREEN,
          opacity: L === GLASS ? 0.35 : L === SCREEN ? 0.5 : 1,
        });
        owned.push(geo, mat);
        if (FADES.has(L)) fade.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = L !== GLASS && L !== SCREEN;
        mesh.receiveShadow = true;
        mesh.userData.layer = L;
        group.add(mesh);
        polys[L] = { mesh, ends, polyIdx: mine };
      }

      // The house: wall, foundation band, a roof slab, a door onto the deck and a window each side — unless the photo stands for it.
      const bd = backdropRef.current;
      if (!bd) mount.dataset.deck3dBackdrop = "none";
      if (s.house && !bd) {
        const wallMat = new THREE.MeshStandardMaterial({ color: SIDING, roughness: 0.95, map: siding });
        const baseMat = new THREE.MeshStandardMaterial({ color: FOUNDATION, roughness: 1, map: concrete });
        const roofMat = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.9 });
        const glassMat = new THREE.MeshStandardMaterial({ color: GLASS_C, roughness: 0.15, metalness: 0.4 });
        const trimMat = new THREE.MeshStandardMaterial({ color: TRIM_WHITE, roughness: 0.8 });
        owned.push(wallMat, baseMat, roofMat, glassMat, trimMat);
        const height = s.house.heightFt;
        const band = Math.min(1.5, Math.max(0.5, s.heightFt - 0.6));
        siding.repeat.set(1, height / 0.5);
        for (const [x0, y0, x1, y1] of s.house.blocks) {
          const w = x1 - x0;
          const d = y1 - y0;
          const cx = (x0 + x1) / 2 - ox;
          const cz = (y0 + y1) / 2 - oz;
          const wall = new THREE.Mesh(unitBox, wallMat);
          wall.scale.set(w, height - band, d);
          wall.position.set(cx, band + (height - band) / 2, cz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          wall.userData.layer = -2;
          const base = new THREE.Mesh(unitBox, baseMat);
          base.scale.set(w + 0.02, band, d + 0.02);
          base.position.set(cx, band / 2, cz);
          base.receiveShadow = true;
          base.userData.layer = -2;
          const roof = new THREE.Mesh(unitBox, roofMat);
          roof.scale.set(w + 2, 0.5, d + 2);
          roof.position.set(cx, height + 0.25, cz);
          roof.castShadow = true;
          roof.userData.layer = -2;
          const eave = new THREE.Mesh(unitBox, trimMat);
          eave.scale.set(w + 2, 0.6, 0.15);
          eave.position.set(cx, height - 0.05, cz + d / 2 + 1);
          eave.userData.layer = -2;
          group.add(wall, base, roof, eave);
        }
        if (s.house.door) {
          const [dx, dw, dh] = s.house.door;
          const sill = s.heightFt;
          const opening = (x: number, w: number, h: number, y: number, door: boolean) => {
            const trim = new THREE.Mesh(unitBox, trimMat);
            trim.scale.set(w + 0.5, h + 0.5, 0.12);
            trim.position.set(x - ox, y + h / 2, -oz + 0.03);
            trim.userData.layer = -2;
            const glass = new THREE.Mesh(unitBox, glassMat);
            glass.scale.set(w, h, 0.14);
            glass.position.set(x - ox, y + h / 2, -oz + 0.04);
            glass.userData.layer = -2;
            group.add(trim, glass);
            // Mullions: a door splits into two leaves, a window into four lights.
            const bars = door ? [[x - ox, y + h / 2, 0.1, h]] : [[x - ox, y + h / 2, 0.08, h], [x - ox, y + h / 2, w, 0.08]];
            for (const [bx, by, bw, bh] of bars) {
              const m = new THREE.Mesh(unitBox, trimMat);
              m.scale.set(bw, bh, 0.16);
              m.position.set(bx, by, -oz + 0.05);
              m.userData.layer = -2;
              group.add(m);
            }
            if (door) {
              const handle = new THREE.Mesh(unitBox, glassMat);
              handle.scale.set(0.08, 0.5, 0.2);
              handle.position.set(x - ox + 0.35, y + 3, -oz + 0.12);
              handle.userData.layer = -2;
              group.add(handle);
            }
          };
          opening(dx, dw, dh, sill, true);
          const main = s.house.blocks[0];
          for (const side of [-1, 1]) {
            const wx = dx + side * (dw / 2 + 4.5);
            if (wx - 1.5 > Math.max(main[0], 0) && wx + 1.5 < Math.min(main[2], s.widthFt)) opening(wx, 3, 4, sill + 2.7, false);
          }
        }
      }

      // The fixtures' light at night: a few real lights, the rest glow.
      const pointLights: THREE.PointLight[] = [];
      const lit = s.glows.filter((g) => g[4] === 0).slice(0, 6);
      for (const g of lit) {
        const pl = new THREE.PointLight(g[3], 0, 22, 2);
        pl.position.set(g[0] - ox, g[2] - 0.3, g[1] - oz);
        group.add(pl);
        pointLights.push(pl);
      }
      // A sample fixture (the client's own) reads see-through.
      if (s.glows.some((g) => g[4] === 1) && layers[LIGHT].length) {
        const sampleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.4, emissive: new THREE.Color(0xffe2b0), emissiveIntensity: 0.15 });
        owned.push(sampleMat);
        const { mesh, boxIdx } = layers[LIGHT][0];
        const samples = boxIdx.map((bi) => s.glows.some((g) => g[4] === 1 && Math.abs(g[0] - s.boxes[bi][1]) < 0.05 && Math.abs(g[1] - s.boxes[bi][2]) < 0.05));
        if (samples.some(Boolean)) {
          const sampleMesh = new THREE.InstancedMesh(unitBox, sampleMat, samples.filter(Boolean).length);
          let k = 0;
          const tmp = new THREE.Matrix4();
          samples.forEach((isSample, i) => {
            if (!isSample) return;
            mesh.getMatrixAt(i, tmp);
            sampleMesh.setMatrixAt(k++, tmp);
            // Hide the solid one.
            tmp.makeScale(0.0001, 0.0001, 0.0001);
            mesh.setMatrixAt(i, tmp);
          });
          mesh.instanceMatrix.needsUpdate = true;
          sampleMesh.instanceMatrix.needsUpdate = true;
          sampleMesh.userData.layer = LIGHT;
          group.add(sampleMesh);
          layers[LIGHT].push({ mesh: sampleMesh, total: k, boxIdx: [] });
        }
      }

      // The callouts: numbered tags at the connections.
      const callouts: THREE.Sprite[] = [];
      s.callouts.forEach((c, i) => {
        const tag = tagSprite(String(i + 1), true);
        owned.push(tag);
        tag.sprite.position.set(c[0] - ox, c[2], c[1] - oz);
        tag.sprite.userData.callout = i;
        tag.sprite.userData.legend = c[3];
        tag.sprite.userData.dim = true;
        tag.sprite.visible = false;
        group.add(tag.sprite);
        callouts.push(tag.sprite);
      });

      // The edit handles: a blueprint-blue knob at each thing a drag can change; shown only in edit mode.
      const handleGeo = new THREE.SphereGeometry(0.42, 18, 14);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x1854a0, roughness: 0.35, metalness: 0.1, emissive: new THREE.Color(0x1854a0), emissiveIntensity: 0.25 });
      owned.push(handleGeo, handleMat);
      const handles: THREE.Mesh[] = [];
      for (const h of s.handles) {
        const m = new THREE.Mesh(handleGeo, handleMat);
        m.position.set(h.x - ox, h.z + 0.3, h.y - oz);
        m.userData.handle = h;
        m.userData.layer = -3;
        m.visible = false;
        m.renderOrder = 5;
        group.add(m);
        handles.push(m);
      }
      const knobs: HTMLButtonElement[] = [];
      handles.forEach((m, i) => {
        const h = s.handles[i];
        const key = `${h.kind}:${h.id}`;
        const knob = document.createElement("button");
        knob.type = "button";
        knob.dataset.deckHandle = h.kind;
        knob.dataset.deckHandleId = h.id;
        knob.setAttribute("aria-label", `${h.label} — drag, or press the arrow keys`);
        knob.title = h.label;
        knob.textContent = h.axis === "z" ? "↕" : "↔";
        knob.style.cssText = `position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2.5px solid #fff;background:#1854a0;color:#fff;font:700 14px/1 system-ui,sans-serif;display:none;place-items:center;padding:0;box-shadow:0 1px 5px rgba(0,0,0,.35);pointer-events:auto;touch-action:none;cursor:${h.axis === "z" ? "ns-resize" : "move"}`;
        knob.addEventListener("pointerdown", (e) => knobDown(e, m, knob));
        knob.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY, false));
        knob.addEventListener("pointerup", (e) => dragMove(e.clientX, e.clientY, true));
        knob.addEventListener("pointercancel", () => onCancel());
        knob.addEventListener("pointerenter", () => hoverHandle(h));
        knob.addEventListener("pointerleave", () => {
          if (!drag) pickRef.current?.(null, "hover");
        });
        knob.addEventListener("focus", () => {
          focusedKnob = key;
          hoverHandle(h);
        });
        knob.addEventListener("keydown", (e) => knobKey(e, h));
        knobLayer.appendChild(knob);
        knobs.push(knob);
        if (focusedKnob === key && editRef.current) queueMicrotask(() => knob.focus({ preventScroll: true }));
      });

      // THE PHOTO AS THE WALL: the picture the elevation was placed on, standing on the house line at the placement's scale.
      if (bd && bd.placed.w > 0 && bd.elevWidthFt > 0 && bd.w > 0 && bd.h > 0) {
        const pxPerFt = (bd.placed.w * bd.w) / bd.elevWidthFt;
        const wFt = bd.w / pxPerFt;
        const hFt = bd.h / pxPerFt;
        const leftX = -bd.placed.x * wFt - bd.elevLeftFt;
        const zTop = bd.placed.y * hFt;
        const zBottom = Math.max(0, (bd.placed.y - 1) * hFt);
        const v0 = 1 - Math.min(1, Math.max(0, bd.placed.y));
        if (zTop - zBottom > 0.2 && wFt > 0.5) {
          const tex = photoTexture(bd.href);
          const photoMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
          const returnMat = new THREE.MeshStandardMaterial({ color: RETURN_WALL, roughness: 0.95, side: THREE.DoubleSide });
          owned.push(photoMat, returnMat);
          photoMats.push(photoMat);
          // The wall's parts between its steps, each at its depth; the part under the deck's middle stands on the house line.
          const jogs = [...bd.jogs].filter((j) => j.x > 0.005 && j.x < 0.995).sort((a, b) => a.x - b.x);
          const xs = [0, ...jogs.map((j) => j.x), 1];
          const depths: number[] = [0];
          for (const j of jogs) depths.push(depths[depths.length - 1] + (j.dir === "toward" ? 1 : -1) * (j.depthFt ?? JOG_DEFAULT_FT));
          const centreFrac = (s.widthFt / 2 - leftX) / wFt;
          let mine = 0;
          for (let i = 0; i + 1 < xs.length; i++) if (centreFrac >= xs[i] && centreFrac <= xs[i + 1]) mine = i;
          const shift = depths[mine];
          const height = zTop - zBottom;
          const yMid = (zTop + zBottom) / 2;
          for (let i = 0; i + 1 < xs.length; i++) {
            const u0 = xs[i];
            const u1 = xs[i + 1];
            if (u1 - u0 < 0.002) continue;
            const geo = new THREE.PlaneGeometry((u1 - u0) * wFt, height);
            geo.setAttribute("uv", new THREE.Float32BufferAttribute([u0, 1, u1, 1, u0, v0, u1, v0], 2));
            owned.push(geo);
            const plane = new THREE.Mesh(geo, photoMat);
            plane.position.set(leftX + ((u0 + u1) / 2) * wFt - ox, yMid, depths[i] - shift - oz - 0.05);
            group.add(plane);
          }
          // The return walls at each step.
          for (let i = 1; i + 1 < xs.length; i++) {
            const run = depths[i] - depths[i - 1];
            if (Math.abs(run) < 0.05) continue;
            const geo = new THREE.PlaneGeometry(Math.abs(run), height);
            owned.push(geo);
            const wall = new THREE.Mesh(geo, returnMat);
            wall.rotation.y = Math.PI / 2;
            wall.position.set(leftX + xs[i] * wFt - ox, yMid, (depths[i] + depths[i - 1]) / 2 - shift - oz - 0.05);
            group.add(wall);
          }
        }
      }

      // The overall dimensions, drawn on the ground a little outside the deck, and the height at the corner.
      const lineMat = new THREE.LineBasicMaterial({ color: INK });
      owned.push(lineMat);
      const dims = new THREE.Group();
      const dim = (a: THREE.Vector3, b: THREE.Vector3, text: string, tick: THREE.Vector3) => {
        const pts = [a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick)];
        const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
        owned.push(geo);
        dims.add(new THREE.LineSegments(geo, lineMat));
        const tag = tagSprite(text);
        owned.push(tag);
        tag.sprite.position.copy(a).add(b).multiplyScalar(0.5);
        tag.sprite.userData.dim = true;
        dims.add(tag.sprite);
      };
      const out = 2.2;
      const tall = Math.max(s.heightFt, s.peakFt ?? 0);
      dim(new THREE.Vector3(-ox, 0.05, oz + out), new THREE.Vector3(ox, 0.05, oz + out), feetInches(s.widthFt), new THREE.Vector3(0, 0, 0.4));
      dim(new THREE.Vector3(ox + out, 0.05, -oz), new THREE.Vector3(ox + out, 0.05, oz), feetInches(s.depthFt), new THREE.Vector3(0.4, 0, 0));
      if (s.heightFt > 0.5) dim(new THREE.Vector3(ox + out, 0, oz + out), new THREE.Vector3(ox + out, s.heightFt, oz + out), feetInches(s.heightFt), new THREE.Vector3(0.3, 0, 0.3));
      if (tall > s.heightFt + 1) dim(new THREE.Vector3(-ox - out, 0, oz + out), new THREE.Vector3(-ox - out, tall, oz + out), feetInches(tall), new THREE.Vector3(0.3, 0, 0.3));
      dims.userData.dims = true;
      group.add(dims);

      return {
        group,
        layers,
        polys,
        braces,
        diagonal,
        rank,
        fade,
        lightMat,
        pointLights,
        callouts,
        handles,
        knobs,
        centres,
        dispose: () => {
          for (const k of knobs) k.remove();
          for (const o of owned) o.dispose();
          for (const l of layers) for (const { mesh } of l) mesh.dispose();
        },
      };
    };

    const apply = () => {
      if (!content) return;
      const b = builtRef.current;
      const x = xrayRef.current;
      const nightTime = nightRef.current;
      const share = (L: number) => (content!.rank[L] < 0 ? 1 : Math.min(1, Math.max(0, b - content!.rank[L])));
      content.layers.forEach((meshes, L) => {
        const f = share(L);
        for (const { mesh, total } of meshes) {
          mesh.count = Math.round(f * total);
          mesh.visible = mesh.count > 0;
        }
      });
      const braceShare = share(BRACE);
      content.braces.forEach((m, i) => (m.visible = i < Math.round(braceShare * content!.braces.length)));
      if (content.diagonal) {
        const f = share(DECKING);
        const boards = Math.round(f * content.diagonal.ends.length);
        content.diagonal.mesh.visible = boards > 0;
        content.diagonal.mesh.geometry.setDrawRange(0, boards > 0 ? content.diagonal.ends[boards - 1] : 0);
      }
      content.polys.forEach((p, L) => {
        if (!p) return;
        const f = share(L);
        const n = Math.round(f * p.ends.length);
        p.mesh.visible = n > 0;
        p.mesh.geometry.setDrawRange(0, n > 0 ? p.ends[n - 1] : 0);
      });
      for (const m of content.fade) {
        const mm = m as THREE.MeshStandardMaterial;
        const glassy = mm.userData.base && (mm.opacity === 0.35 || mm.opacity === 0.5 || mm.opacity === 0.55);
        if (glassy) continue;
        m.transparent = x;
        m.opacity = x ? 0.2 : 1;
        m.depthWrite = !x;
        m.needsUpdate = true;
      }
      groundMat.opacity = x ? 0.55 : 1;
      groundMat.depthWrite = !x;
      groundMat.needsUpdate = true;
      // Night: the sun under, the sky dark, the fixtures lit.
      tuneSky(sky, nightTime);
      (sky.material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
      hemi.intensity = nightTime ? 0.12 : 0.75;
      hemi.color.set(nightTime ? 0x3a4a6a : 0xcfe0ff);
      key.intensity = nightTime ? 0.08 : 2.3;
      key.color.set(nightTime ? 0x9fb4ff : 0xfff4e6);
      world.environmentIntensity = nightTime ? 0.06 : 0.45;
      renderer.toneMappingExposure = nightTime ? 0.75 : 0.9;
      if (content.lightMat) content.lightMat.emissiveIntensity = nightTime ? 2.2 : 0.15;
      const lightShare = share(LIGHT);
      for (const pl of content.pointLights) pl.intensity = nightTime && lightShare >= 1 ? 30 : 0;
      for (const c of content.callouts) c.visible = connRef.current;
      for (const h of content.handles) h.visible = editRef.current;
      for (const k of content.knobs) k.style.display = editRef.current ? "grid" : "none";
      if (!editRef.current && drag) {
        drag = null;
        orbit.enabled = true;
        renderer.domElement.style.cursor = "";
      }
      renderer.domElement.style.cursor = placingRef.current ? "crosshair" : "";
      dirty = true;
    };

    /** Fly the camera to a point (scene feet), framing a part `size` ft across. */
    const flyTo = (p: [number, number, number], size = 4) => {
      const s = sceneRef.current;
      const target = new THREE.Vector3(p[0] - s.widthFt / 2, p[2], p[1] - s.depthFt / 2);
      const dir = camera.position.clone().sub(orbit.target).normalize();
      if (dir.lengthSq() < 0.01) dir.set(0.6, 0.4, 0.7).normalize();
      const dist = Math.max(2.5, size * 2.2);
      const from = camera.position.clone();
      const fromT = orbit.target.clone();
      const to = target.clone().add(dir.multiplyScalar(dist));
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 650);
        const e = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(from, to, e);
        orbit.target.lerpVectors(fromT, target, e);
        orbit.update();
        dirty = true;
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    };

    const rebuild = () => {
      if (content) {
        world.remove(content.group);
        content.dispose();
      }
      content = build();
      world.add(content.group);
      tiltGround();
      const s = sceneRef.current;
      const peak = Math.max(s.heightFt, s.peakFt ?? s.heightFt);
      const resized = !fitted || fitted.w !== s.widthFt || fitted.d !== s.depthFt || fitted.h !== peak;
      if (resized && !drag) frame(false);
      apply();
    };

    api.current = { rebuild, apply, reset: () => frame(true), flyTo };
    rebuild();

    // Picking: a touch names the part, a click flies to it (or places a fixture there).
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hover: { mesh: THREE.InstancedMesh; id: number; color: THREE.Color } | null = null;
    let downAt: { x: number; y: number; t: number } | null = null;
    const pickAt = (clientX: number, clientY: number): { pick: DeckPick; boxIdx: number | null; mesh: THREE.InstancedMesh | null; instanceId: number | null; calloutLegend: number | null } | null => {
      if (!content) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const s = sceneRef.current;
      const ox = s.widthFt / 2;
      const oz = s.depthFt / 2;
      // Callout tags first.
      if (connRef.current) {
        const tagHits = ray.intersectObjects(content.callouts.filter((c) => c.visible), false);
        if (tagHits.length) {
          const sp = tagHits[0].object as THREE.Sprite;
          const lg = s.legend[sp.userData.legend as number] ?? null;
          return { pick: { legend: lg, layer: null, point: [sp.position.x + ox, sp.position.z + oz, sp.position.y], mount: "deck" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: sp.userData.legend as number };
        }
      }
      const hits = ray.intersectObjects(content.group.children.filter((o) => o.visible && !(o instanceof THREE.Sprite) && !(o instanceof THREE.LineSegments) && !o.userData.dims), true);
      const hit = hits.find((h) => h.object.visible && (h.object as THREE.Mesh).isMesh);
      if (!hit) {
        const g = ray.intersectObject(ground, false)[0];
        if (!g) return null;
        return { pick: { legend: null, layer: "ground", point: [g.point.x + ox, g.point.z + oz, g.point.y], mount: "deck" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: null };
      }
      const obj = hit.object as THREE.Mesh;
      const L = obj.userData.layer as number | undefined;
      const point: [number, number, number] = [hit.point.x + ox, hit.point.z + oz, hit.point.y];
      if (L === -2) return { pick: { legend: null, layer: "house", point, mount: "wall" }, boxIdx: null, mesh: null, instanceId: null, calloutLegend: null };
      if (L === undefined || L < 0) return null;
      const layerName = SCENE_LAYERS[L];
      let boxIdx: number | null = null;
      let legend: SceneLegend | null = null;
      if (obj instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        const entry = content.layers[L]?.find((e) => e.mesh === obj);
        boxIdx = entry?.boxIdx[hit.instanceId] ?? null;
        if (boxIdx !== null && s.tags.length === s.boxes.length && s.tags[boxIdx] >= 0) legend = s.legend[s.tags[boxIdx]] ?? null;
        return { pick: { legend, layer: layerName, point, mount: MOUNT_OF[layerName] ?? "deck" }, boxIdx, mesh: obj, instanceId: hit.instanceId, calloutLegend: null };
      }
      if (typeof obj.userData.boxIdx === "number") {
        boxIdx = obj.userData.boxIdx as number;
        if (s.tags.length === s.boxes.length && s.tags[boxIdx] >= 0) legend = s.legend[s.tags[boxIdx]] ?? null;
      } else {
        // A polygon: which ring was hit, by the face index.
        const p = content.polys[L];
        if (p && hit.faceIndex !== undefined && hit.faceIndex !== null) {
          const idxEnd = (hit.faceIndex + 1) * 3;
          const k = p.ends.findIndex((e) => idxEnd <= e);
          const pi = k >= 0 ? p.polyIdx[k] : -1;
          if (pi >= 0 && s.polyTags.length === s.polys.length && s.polyTags[pi] >= 0) legend = s.legend[s.polyTags[pi]] ?? null;
        }
      }
      return { pick: { legend, layer: layerName, point, mount: MOUNT_OF[layerName] ?? "deck" }, boxIdx, mesh: null, instanceId: null, calloutLegend: null };
    };
    const planePoint = (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const out = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, out) ? out : null;
    };
    const handleAt = (clientX: number, clientY: number): THREE.Mesh | null => {
      if (!content || !editRef.current) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(content.handles.filter((h) => h.visible), false);
      return (hits[0]?.object as THREE.Mesh | undefined) ?? null;
    };
    const dragStart = (mesh: THREE.Mesh, clientX: number, clientY: number) => {
      const h = mesh.userData.handle as SceneHandle;
      const at = mesh.getWorldPosition(new THREE.Vector3());
      // Horizontal axes drag on the horizontal plane through the handle; a height drags on a vertical plane facing the camera.
      const plane = h.axis === "z" ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(camera.position.x - at.x, 0, camera.position.z - at.z).normalize(), at) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -at.y);
      const start = planePoint(clientX, clientY, plane);
      if (!start) return;
      drag = { handle: h, plane, start, last: h.value };
      orbit.enabled = false;
      renderer.domElement.style.cursor = h.axis === "z" ? "ns-resize" : "move";
    };
    const dragMove = (clientX: number, clientY: number, done: boolean) => {
      if (!drag) return;
      const p = planePoint(clientX, clientY, drag.plane);
      if (!p) return;
      const h = drag.handle;
      const d = h.axis === "x" ? p.x - drag.start.x : h.axis === "y" ? p.z - drag.start.z : p.y - drag.start.y;
      const value = h.value + d / h.perUnit;
      // Half a foot or an inch at a time: the deck re-frames on every value sent.
      if (!done && Math.abs(value - drag.last) < (h.perUnit === 1 ? 0.5 : 1)) return;
      drag.last = value;
      editCbRef.current?.({ kind: h.kind, id: h.id, value, done });
      if (done) {
        drag = null;
        orbit.enabled = true;
        renderer.domElement.style.cursor = "";
      }
    };
    const clearHover = () => {
      if (hover) {
        hover.mesh.setColorAt(hover.id, hover.color);
        if (hover.mesh.instanceColor) hover.mesh.instanceColor.needsUpdate = true;
        hover = null;
        dirty = true;
      }
    };
    const knobDown = (e: PointerEvent, mesh: THREE.Mesh, knob: HTMLButtonElement) => {
      dragStart(mesh, e.clientX, e.clientY);
      try {
        knob.setPointerCapture(e.pointerId);
      } catch {
        /* the canvas picks the drag up */
      }
    };
    const hoverHandle = (h: SceneHandle) => {
      clearHover();
      const now = h.perUnit === 1 ? `${Math.round(h.value * 2) / 2} ft` : `${Math.round(h.value)} in.`;
      pickRef.current?.({ legend: { role: h.label, nominal: now, lengthFt: 0, count: 1, note: "Drag the knob, or press the arrow keys." }, layer: null, point: [h.x, h.y, h.z], mount: "deck" }, "hover");
    };
    const knobKey = (e: KeyboardEvent, h: SceneHandle) => {
      const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const step = (h.perUnit === 1 ? 0.5 : 1) * (e.shiftKey ? 4 : 1);
      editCbRef.current?.({ kind: h.kind, id: h.id, value: h.value + dir * step, done: true });
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        dragMove(e.clientX, e.clientY, false);
        return;
      }
      if (editRef.current && !downAt) {
        const hm = handleAt(e.clientX, e.clientY);
        if (hm) {
          renderer.domElement.style.cursor = (hm.userData.handle as SceneHandle).axis === "z" ? "ns-resize" : "move";
          hoverHandle(hm.userData.handle as SceneHandle);
          return;
        }
      }
      if (coarse || downAt) return;
      const r = pickAt(e.clientX, e.clientY);
      if (!r || !r.mesh || r.instanceId === null) {
        clearHover();
        renderer.domElement.style.cursor = placingRef.current ? "crosshair" : "";
        pickRef.current?.(r?.pick ?? null, "hover");
        return;
      }
      if (hover && hover.mesh === r.mesh && hover.id === r.instanceId) return;
      clearHover();
      const c = new THREE.Color();
      r.mesh.getColorAt(r.instanceId, c);
      hover = { mesh: r.mesh, id: r.instanceId, color: c.clone() };
      r.mesh.setColorAt(r.instanceId, c.clone().lerp(new THREE.Color(0x4f8cff), 0.55));
      if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
      renderer.domElement.style.cursor = placingRef.current ? "crosshair" : "pointer";
      dirty = true;
      pickRef.current?.(r.pick, "hover");
    };
    const onDown = (e: PointerEvent) => {
      const hm = handleAt(e.clientX, e.clientY);
      if (hm) {
        dragStart(hm, e.clientX, e.clientY);
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          /* the drag still works while the pointer stays over the canvas */
        }
        return;
      }
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        dragMove(e.clientX, e.clientY, true);
        return;
      }
      const d = downAt;
      downAt = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const r = pickAt(e.clientX, e.clientY);
      if (!r) {
        pickRef.current?.(null, "click");
        return;
      }
      if (!placingRef.current && content) {
        if (r.boxIdx !== null && content.centres[r.boxIdx]) {
          const [c, size] = content.centres[r.boxIdx];
          const s = sceneRef.current;
          flyTo([c.x + s.widthFt / 2, c.z + s.depthFt / 2, c.y], Math.min(8, Math.max(1.5, size)));
        } else if (r.calloutLegend !== null) flyTo(r.pick.point, 3);
      }
      pickRef.current?.(r.pick, "click");
    };
    const onLeave = () => {
      if (drag) return;
      clearHover();
      pickRef.current?.(null, "hover");
    };
    const onCancel = () => {
      if (drag) {
        drag = null;
        orbit.enabled = true;
        renderer.domElement.style.cursor = "";
      }
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointercancel", onCancel);

    const knobV = new THREE.Vector3();
    const placeKnobs = () => {
      const c = content;
      if (!c) return;
      const w = renderer.domElement.clientWidth;
      const hgt = renderer.domElement.clientHeight;
      c.handles.forEach((m, i) => {
        const k = c.knobs[i];
        if (!k) return;
        m.getWorldPosition(knobV).project(camera);
        const off = knobV.z > 1 || Math.abs(knobV.x) > 1.05 || Math.abs(knobV.y) > 1.05;
        k.style.display = off ? "none" : "grid";
        if (!off) k.style.transform = `translate(${(((knobV.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - knobV.y) / 2) * hgt).toFixed(1)}px)`;
      });
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const moved = orbit.update();
      if (!moved && !dirty) return;
      dirty = false;
      // A tag keeps its size on the screen's scale of the deck, wherever the camera stands.
      if (content) {
        const dist = camera.position.distanceTo(orbit.target);
        const size = Math.max(0.3, Math.min(span * 0.035, dist * 0.045));
        content.group.traverse((o) => {
          if (o instanceof THREE.Sprite && o.userData.dim) o.scale.set(size * (o.userData.aspect as number), size, 1);
        });
      }
      renderer.render(world, camera);
      if (content && editRef.current) placeKnobs();
    };
    tick();

    let measured = mount.clientWidth > 0 && mount.clientHeight > 0;
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || w0;
      const h = mount.clientHeight || h0;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!measured && mount.clientWidth > 0 && mount.clientHeight > 0) {
        measured = true;
        frame(true);
      }
      dirty = true;
    });
    ro.observe(mount);

    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("pointercancel", onCancel);
      orbit.dispose();
      if (content) {
        world.remove(content.group);
        content.dispose();
      }
      unitBox.dispose();
      unitCyl.dispose();
      siding.dispose();
      for (const t of textures.values()) t.dispose();
      grain.dispose();
      shingles.dispose();
      ribs.dispose();
      grass.dispose();
      concrete.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      envTex?.dispose();
      (sky.material as THREE.Material).dispose();
      sky.geometry.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      knobLayer.remove();
    };
  }, [supported]);

  if (!supported) {
    return (
      <div className={className} data-deck3d="unsupported" style={{ display: "grid", placeItems: "center" }}>
        <span>The 3D view is not available on this device</span>
      </div>
    );
  }
  // The host's class places and sizes the box (an absolute fill, in every host so far); the canvas follows it.
  return <div ref={mountRef} className={className} data-deck3d="canvas" role="img" aria-label={label ?? "The deck in 3D"} style={{ overflow: "hidden" }} />;
}
