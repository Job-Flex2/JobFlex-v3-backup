"use client";
// WHAT DO YOU WANT TO DESIGN? (Home Design Studio, 2026-10-18 — owner: "ask what room you want to design and then you
// find it in the plan … offer all spaces that plan has and you select either all or one — super smart"). After a plan
// set is opened: every space its floor plans hold, by floor, with the size the plan prints (or the one measured);
// type a room to find it ("master bath" finds "Primary bath"); one room opens straight in 3D, a floor opens as its
// plan, and "the whole house" lays every floor out side by side. The sheet grid stays one click away.
import * as React from "react";
import s from "./design-studio.module.css";
import { matchScore } from "@/lib/design/planSet";

export type SpaceRoom = { name: string; size?: string; sqft?: number };
export type SpaceFloor = {
  key: string;
  name: string;
  page: number;
  fileName: string;
  level: string | null;
  rooms: SpaceRoom[];
  /** "text": the rooms the sheet labels; "reading": the floor is being read for its rooms; "read": measured. */
  status: "text" | "reading" | "read" | "failed";
  thumb?: string;
};

type Props = {
  floors: SpaceFloor[];
  /** The floors are levels of one house (the whole house is them all). */
  multi: boolean;
  busy: string | null;
  onRoom: (floorKey: string, room: string) => void;
  onFloor: (floorKey: string) => void;
  onHouse: () => void;
  onSheets: () => void;
  onBack: () => void;
};

const sizeOf = (r: SpaceRoom) => (r.size ? r.size : r.sqft ? `${Math.round(r.sqft)} sq ft` : "");

export function SpacesPicker({ floors, multi, busy, onRoom, onFloor, onHouse, onSheets, onBack }: Props) {
  const [q, setQ] = React.useState("");
  const total = floors.reduce((n, f) => n + f.rooms.length, 0);
  const hits = q.trim()
    ? floors
        .flatMap((f) => f.rooms.map((r) => ({ f, r, score: matchScore(q, r.name) })))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [];
  const reading = floors.some((f) => f.status === "reading");
  const file = floors[0]?.fileName ?? "";
  const alternatives = !multi && floors.length > 1;

  return (
    <section className={s.card} data-design-spaces>
      <div className={s.head}>
        <div>
          <div className={s.cardTitle}>What do you want to design?</div>
          <p className={s.cardSub}>
            {total ? `${total} spaces` : "The spaces"} {multi ? `on ${floors.length} floors` : alternatives ? `in ${floors.length} plans` : ""} in {file.replace(/\.pdf$/i, "")} — pick a room, {multi ? "a floor, or the whole house" : "or the whole plan"}.
            {reading ? " Reading the rooms the sheet draws as lines…" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
      <div className={s.body}>
        <label className={s.field}>
          <span className={s.lbl}>Find a room</span>
          <input id="space-search" className={s.in} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type it — kitchen, master bath, bedroom 2…" autoFocus data-design-space-search />
        </label>
        {q.trim() ? (
          hits.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} data-design-space-hits>
              {hits.map(({ f, r }) => (
                <RoomChip key={`${f.key}|${r.name}`} floor={floors.length > 1 ? f.name : null} room={r} primary disabled={!!busy} onClick={() => onRoom(f.key, r.name)} />
              ))}
            </div>
          ) : (
            <p className={s.note}>No room by that name {reading ? "yet — the rest are still being read" : "in these plans"}.</p>
          )
        ) : null}

        {busy ? (
          <p className={`${s.note} ${s.noteGood}`} data-design-space-busy>
            {busy}
          </p>
        ) : null}

        {multi ? (
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} style={{ height: "auto", padding: "14px 16px", textAlign: "left", display: "grid", gap: 2 }} onClick={onHouse} disabled={!!busy} data-design-space-house>
            <span style={{ fontSize: 15 }}>The whole house</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0, textTransform: "none", opacity: 0.85 }}>
              {floors.map((f) => f.name).join(" · ")} — every floor side by side, {total} spaces
            </span>
          </button>
        ) : null}

        {floors.map((f) => (
          <div key={f.key} style={{ border: "1.5px solid var(--hair-soft)", borderRadius: 4, padding: 12, display: "grid", gap: 10 }} data-design-space-floor={f.name}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {f.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.thumb} alt="" style={{ width: 88, height: 60, objectFit: "cover", border: "1px solid var(--hair-soft)", borderRadius: 3 }} />
              ) : null}
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>{f.name}</div>
                <div className={s.mono}>
                  Page {f.page} · {f.status === "reading" ? "reading its rooms…" : f.status === "failed" ? `${f.rooms.length} labelled — open it to read the rest` : `${f.rooms.length} ${f.rooms.length === 1 ? "space" : "spaces"}${f.status === "read" ? ", measured" : ""}`}
                </div>
              </div>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => onFloor(f.key)} disabled={!!busy} data-design-space-whole={f.name}>
                {multi ? "The whole floor" : "The whole plan"}
              </button>
            </div>
            {f.rooms.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {f.rooms.map((r) => (
                  <RoomChip key={r.name} floor={null} room={r} disabled={!!busy} onClick={() => onRoom(f.key, r.name)} />
                ))}
              </div>
            ) : f.status !== "reading" ? (
              <p className={s.note}>This sheet labels no rooms as text — open the whole plan and they&apos;re read from the drawing.</p>
            ) : null}
          </div>
        ))}

        <button type="button" className={s.link} style={{ justifySelf: "start" }} onClick={onSheets} data-design-space-sheets>
          Not the right plan? Pick the sheet yourself
        </button>
      </div>
    </section>
  );
}

function RoomChip({ room, floor, primary, disabled, onClick }: { room: SpaceRoom; floor: string | null; primary?: boolean; disabled?: boolean; onClick: () => void }) {
  const size = sizeOf(room);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${s.btn} ${primary ? s.btnPrimary : ""}`}
      style={{ height: "auto", minHeight: 40, padding: "6px 12px", display: "grid", gap: 1, textAlign: "left", letterSpacing: 0, textTransform: "none", fontSize: 13.5 }}
      data-design-space-room={room.name}
    >
      <span style={{ fontWeight: 800 }}>{room.name}</span>
      {size || floor ? <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75 }}>{[floor, size].filter(Boolean).join(" · ")}</span> : null}
    </button>
  );
}
