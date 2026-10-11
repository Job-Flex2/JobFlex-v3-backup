"use client";
// WHERE TO SIGN IN (owner, 2026-10-11): "an option where to sign in — to the
// JobFlex platform or to the Deck Studio." One account, two doors: the choice
// is a cookie the sign-in form reads to pick where to land (lib/doorClient),
// remembered a year, pre-set by ?door= (the deck landing's own link) and never
// asked twice. An account that holds only one workspace lands there whatever
// was picked (lib/editions homeFor).
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { EDITIONS, isEditionOpen, parseDoor, type Door } from "@/lib/editions";
import { readDoorCookie, writeDoorCookie } from "@/lib/doorClient";

/** The switch is drawn only while the Deck Studio is open (lib/editions): coming soon, there is one door. */
export function DoorSwitchSignIn() {
  return isEditionOpen("deck") ? <DoorSwitchButtons /> : null;
}

function DoorSwitchButtons() {
  const search = useSearchParams();
  const fromUrl = parseDoor(search.get("door"));
  // The cookie is read after the first paint (it is not on the server's render), so the switch never flashes.
  const [door, setDoor] = React.useState<Door | null>(fromUrl);
  React.useEffect(() => {
    if (fromUrl) {
      writeDoorCookie(fromUrl);
      return;
    }
    const saved = readDoorCookie();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cookie exists only in the browser; this is the one read of it
    if (saved) setDoor(saved);
  }, [fromUrl]);
  const choose = (d: Door) => {
    writeDoorCookie(d);
    setDoor(d);
  };
  const current: Door = door ?? "platform";
  return (
    <div className="jf-door-switch" role="group" aria-label="Open" data-door={current}>
      <span className="jf-door-switch-label">Open</span>
      {(["platform", "deck"] as const).map((d) => (
        <button key={d} type="button" className={`jf-door-switch-btn${current === d ? " on" : ""}`} aria-pressed={current === d} onClick={() => choose(d)} data-door-choice={d}>
          {d === "platform" ? "JobFlex platform" : EDITIONS.deck.short}
        </button>
      ))}
      <style jsx>{`
        .jf-door-switch { display: flex; align-items: center; gap: 6px; margin: 0 0 14px; flex-wrap: wrap; }
        .jf-door-switch-label { font: 700 11px/1 ui-monospace, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin-right: 4px; }
        .jf-door-switch-btn { appearance: none; border: 1.5px solid #cfd5dd; background: #fff; color: #111827; border-radius: 999px; padding: 7px 12px; font: 600 13px/1 inherit; cursor: pointer; }
        .jf-door-switch-btn.on { background: #111827; border-color: #111827; color: #fff; }
        .jf-door-switch-btn:focus-visible { outline: 2px solid #1854a0; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
