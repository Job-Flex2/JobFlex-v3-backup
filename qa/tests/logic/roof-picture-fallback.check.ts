// The client's roof picture when EagleView will not serve it (2026-10-19): an old order's ortho answers 410 "Image is
// older than the maximum allowed age" (order aa5f7a47, 9903 117th Pl NE, Kirkland), or 404s, or never answers. The
// picture then falls to Google's satellite at the same point, with the pin projected onto THAT frame — the same frame
// and pin as a measurement that never had an ortho — and only when the satellite fails too is it the stand-in, which
// carries no pin. The network is a stub here: nothing reaches EagleView or Google, and no order can be placed.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-picture-fallback.check.ts
import "../_lib/_server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { firstRoofPicture, roofFrames, roofPinOnFrame, roofPinPoint, roofStandInSvg, type RoofFrame } from "../../../src/lib/roofPictures";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// The filmed house's stored answer, as order aa5f7a47 carried it (outline + the two clear orthos).
const ring = [
  { lng: -122.183522273, lat: 47.68896314 }, { lng: -122.183361109, lat: 47.688956782 }, { lng: -122.18336583, lat: 47.688877754 },
  { lng: -122.183277493, lat: 47.688875029 }, { lng: -122.183284911, lat: 47.688804631 }, { lng: -122.183373922, lat: 47.688809627 },
  { lng: -122.183388082, lat: 47.688814623 }, { lng: -122.183530364, lat: 47.688819619 }, { lng: -122.183522273, lat: 47.68896314 },
];
const PIN = { lat: 47.68889, lng: -122.183442 };
const instantWith = (wide: string, narrow: string) => ({
  lat: PIN.lat,
  lng: PIN.lng,
  structures: [{ outline: ring }],
  imagery: [
    { token: wide, view: "ortho", masked: false, bbox: [-122.1837789791945, 47.68872544786646, -122.18311484064316, 47.68906694718896] as [number, number, number, number] },
    { token: `${wide}-m`, view: "ortho", masked: true, bbox: [-122.1837789791945, 47.68872544786646, -122.18311484064316, 47.68906694718896] as [number, number, number, number] },
    { token: narrow, view: "ortho", masked: false, bbox: [-122.1835968602867, 47.688738133791816, -122.1832112280839, 47.68902969010302] as [number, number, number, number] },
  ],
});
const instant = instantWith("ev-wide", "ev-narrow");

// ── the frames, best first (pure)
const both = roofFrames(instant, PIN, { ortho: true, satellite: true });
check("with both keys the frames are the widest clear ortho, then the satellite at the pin", both.length === 2 && both[0].kind === "ortho" && both[0].token === "ev-wide" && both[1].kind === "satellite" && both[1].lat === PIN.lat && both[1].lng === PIN.lng, JSON.stringify(both.map((f) => f.kind)));
const satOnly = roofFrames(instant, PIN, { ortho: false, satellite: true });
check("the fallback satellite frame is exactly the frame of a measurement that never had an ortho", JSON.stringify(both[1]) === JSON.stringify(satOnly[0]));
check("no key, no frames — no roof picture at all", roofFrames(instant, PIN, { ortho: false, satellite: false }).length === 0);

// ── the fall-through (pure, injected loader)
const gone = Object.assign(new Error('eagleview property image failed (410): {"errorCode":10638,"errorDescription":"Image is older than the maximum allowed age"}'), { httpStatus: 410 });
const tried: string[] = [];
const loader = (fail: Partial<Record<RoofFrame["kind"], Error>>) => async (f: RoofFrame) => {
  tried.push(f.kind);
  if (fail[f.kind]) throw fail[f.kind];
  return `${f.kind}-bytes`;
};
const run = async () => {
  const ok = await firstRoofPicture(both, loader({}));
  check("an ortho that loads is the picture; the satellite is not even asked", ok.frame?.kind === "ortho" && ok.picture === "ortho-bytes" && tried.join() === "ortho");
  for (const [why, err] of [["410 (too old)", gone], ["404", Object.assign(new Error("eagleview property image failed (404)"), { httpStatus: 404 })], ["a timeout", new Error("EagleView image timed out")]] as const) {
    tried.length = 0;
    const r = await firstRoofPicture(both, loader({ ortho: err }));
    check(`ortho ${why} → the satellite`, r.frame?.kind === "satellite" && r.picture === "satellite-bytes" && tried.join() === "ortho,satellite" && r.failed.length === 1 && r.failed[0].kind === "ortho");
  }
  tried.length = 0;
  const none = await firstRoofPicture(both, loader({ ortho: gone, satellite: new Error("Static Maps refused (403)") }));
  check("ortho and satellite both fail → no frame (the stand-in)", none.frame === null && none.failed.map((x) => x.kind).join() === "ortho,satellite");

  // ── the pin goes with the frame that came
  const point = roofPinPoint(instant, PIN);
  const onOrtho = roofPinOnFrame(point, both[0]);
  const onSat = roofPinOnFrame(point, both[1]);
  const normalSat = roofPinOnFrame(roofPinPoint(instant, PIN), satOnly[0]);
  check("the fallback pin is the normal satellite pin (same frame, same point)", !!onSat && JSON.stringify(onSat) === JSON.stringify(normalSat), JSON.stringify(onSat));
  check("…and it is not the ortho's pin — an ortho pin on the satellite would point at the wrong spot", !!onOrtho && !!onSat && (Math.abs(onOrtho.x - onSat.x) > 20 || Math.abs(onOrtho.y - onSat.y) > 20), `${JSON.stringify(onOrtho)} vs ${JSON.stringify(onSat)}`);
  check("the satellite pin lands near the middle of the picture, on the house", !!onSat && Math.abs(onSat.x - 500) < 80 && Math.abs(onSat.y - 500) < 120, JSON.stringify(onSat));
  check("the stand-in still says the picture could not be loaded and draws no pin itself", /could not be loaded/.test(roofStandInSvg("2,840 sq ft")) && !/<path/.test(roofStandInSvg("2,840 sq ft")));

  // ── the server's loader, end to end, over a stubbed network
  process.env.EAGLEVIEW_CLIENT_ID = "check-id";
  process.env.EAGLEVIEW_CLIENT_SECRET = "check-secret";
  process.env.GOOGLE_MAPS_API_KEY = "check-key";
  process.env.EAGLEVIEW_PROPERTY_API_BASE_URL = "https://ev.check.invalid";
  process.env.EAGLEVIEW_TOKEN_BASE_URL = "https://ev-token.check.invalid";
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const calls: string[] = [];
  let mapsDown = false;
  const imageAnswer: Record<string, () => Promise<Response>> = {
    "ev-ok": async () => new Response(new Uint8Array([7, 7, 7]), { status: 200, headers: { "content-type": "image/png" } }),
    "ev-410": async () => new Response('{"errorCode":10638,"errorDescription":"Image is older than the maximum allowed age"}', { status: 410 }),
    "ev-404": async () => new Response("not found", { status: 404 }),
    "ev-hang": () => new Promise<Response>(() => {}),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url.replace(/key=[^&]+/, "key=…"));
    if (url.includes("/oauth2/v1/token")) return new Response(JSON.stringify({ access_token: "a.e30.b", expires_in: 3600 }), { status: 200 });
    if (/\/property\/v2\/request/.test(url)) throw new Error("the check must never place an order");
    const img = url.match(/\/property\/v2\/image\/([^?]+)/);
    if (img) return (imageAnswer[decodeURIComponent(img[1])] ?? imageAnswer["ev-404"])();
    if (url.startsWith("https://maps.googleapis.com/maps/api/staticmap")) {
      void init;
      return mapsDown ? new Response("The provided API key is invalid.", { status: 403 }) : new Response(PNG, { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const { loadRoofPicture } = await import("../../../src/lib/roofPictureFetch");
  // A made-up address and point, so the satellite's disk cache neither answers for it nor keeps it afterwards.
  const subject = (wide: string) => ({ address: "1 Fallback Check Way", city: "Nowhere", state: "WA", zip: "00000", lat: 47.6000123, lng: -122.3000123, instantJson: null, instant: { ...instantWith(wide, `${wide}-narrow`), lat: 47.6000123, lng: -122.3000123 } as never });
  const cacheFiles = async () => (await fs.readdir(join(process.cwd(), ".cache", "staticmap")).catch(() => [] as string[])).filter((f) => f.startsWith("1-FALLBACK-CHECK-WAY") || /1-Fallback-Check-Way/i.test(f));

  const okShot = await loadRoofPicture(subject("ev-ok"));
  check("loader: a served ortho is the picture", okShot.frame?.kind === "ortho" && okShot.frame && "bytes" in okShot && okShot.bytes.length === 3);

  for (const tok of ["ev-410", "ev-404"]) {
    for (const f of await cacheFiles()) await fs.unlink(join(process.cwd(), ".cache", "staticmap", f)).catch(() => {});
    calls.length = 0;
    const shot = await loadRoofPicture(subject(tok));
    check(`loader: ortho ${tok.slice(3)} → Google satellite at the measurement's point`, shot.frame?.kind === "satellite" && shot.frame.lat === 47.6000123 && shot.frame.zoom === 20 && "bytes" in shot && shot.bytes[0] === 0x89, JSON.stringify(shot.frame));
    check(`loader: ortho ${tok.slice(3)} is asked once, never retried`, calls.filter((u) => u.includes("/property/v2/image/")).length === 1, calls.join(" "));
    check(`loader: the satellite request is centred on the frame, zoom 20, 640 logical px`, calls.some((u) => u.includes("center=47.6000123%2C-122.3000123") && u.includes("zoom=20") && u.includes("size=640x640")), calls.join(" "));
  }
  calls.length = 0;
  for (const f of await cacheFiles()) await fs.unlink(join(process.cwd(), ".cache", "staticmap", f)).catch(() => {});
  const again = await loadRoofPicture(subject("ev-410"));
  check("loader: a refused image stays refused — the next ask goes straight to the satellite", again.frame?.kind === "satellite" && !calls.some((u) => u.includes("/property/v2/image/")), calls.join(" "));

  const t0 = Date.now();
  for (const f of await cacheFiles()) await fs.unlink(join(process.cwd(), ".cache", "staticmap", f)).catch(() => {});
  const slow = await loadRoofPicture(subject("ev-hang"));
  const took = Date.now() - t0;
  check("loader: an ortho that never answers gives up within its deadline and falls to the satellite", slow.frame?.kind === "satellite" && took < 12_000, `${took} ms`);

  mapsDown = true;
  for (const f of await cacheFiles()) await fs.unlink(join(process.cwd(), ".cache", "staticmap", f)).catch(() => {});
  const down = await loadRoofPicture(subject("ev-410"));
  check("loader: ortho 410 and the satellite refused → no frame, the stand-in (frames > 0)", down.frame === null && down.frames === 2);
  const onlyOrtho = await loadRoofPicture(subject("ev-410"), "ortho");
  check("loader: the route asked for the page's ortho only — a refused ortho is the stand-in, never another frame under that pin", onlyOrtho.frame === null);
  mapsDown = false;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.EAGLEVIEW_CLIENT_ID;
  const noKeys = await loadRoofPicture(subject("ev-ok"));
  check("loader: no keys at all → no frames (no roof picture, not a stand-in)", noKeys.frame === null && noKeys.frames === 0);
  for (const f of await cacheFiles()) await fs.unlink(join(process.cwd(), ".cache", "staticmap", f)).catch(() => {});
  check("no order was ever requested", !calls.some((u) => /property\/v2\/request/.test(u)));
};

run()
  .catch((err) => { bad++; console.log("FAIL threw —", err instanceof Error ? err.stack : err); })
  .finally(() => {
    console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
    process.exit(bad ? 1 : 0);
  });
