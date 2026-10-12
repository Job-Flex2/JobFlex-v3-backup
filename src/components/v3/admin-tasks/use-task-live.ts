"use client";

// ADMIN · TASKS — the live feed. Every 3 seconds, while the tab is visible,
// ask /api/admin/tasks/changes what changed since the last answer and hand it
// to the store. A hidden tab asks nothing; coming back asks at once.
//
// THE OVERLAP. The next `since` is the server's own clock minus 3 seconds, so
// a write that was committed just after the server read its clock is still
// caught next time. The store ignores rows it already has at the same
// updatedAt, so the overlap costs nothing but a few repeated bytes.
//
// STATUS. "live" after an answer, "offline" after two misses in a row (the
// second one asked a second after the first) or a refusal, "waiting" before
// the first answer.

import { useEffect, useRef, useState } from "react";
import type { TaskDetailDTO, TaskRowDTO } from "@/lib/adminTasks/model";

export type LiveStatus = "waiting" | "live" | "offline";

const EVERY_MS = 3000;
/** After a miss, ask again sooner: a blip clears fast, an outage shows fast. */
const RETRY_MS = 1000;
const OVERLAP_MS = 3000;
const TIMEOUT_MS = 8000;

interface Changes {
  now: string;
  rows: TaskRowDTO[];
  detail: TaskDetailDTO | null;
}

export function useTaskLive({
  since,
  openId,
  onRows,
  onDetail,
}: {
  /** The server's clock when the page's rows were read. */
  since: string;
  openId: string | null;
  onRows: (rows: TaskRowDTO[]) => void;
  onDetail: (d: TaskDetailDTO) => void;
}): { status: LiveStatus; reason: string | null } {
  const [status, setStatus] = useState<LiveStatus>("waiting");
  const [reason, setReason] = useState<string | null>(null);
  const sinceRef = useRef(since);
  const openRef = useRef(openId);
  const handlers = useRef({ onRows, onDetail });

  useEffect(() => {
    openRef.current = openId;
  }, [openId]);
  useEffect(() => {
    handlers.current = { onRows, onDetail };
  }, [onRows, onDetail]);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    let inFlight: AbortController | null = null;
    let misses = 0;

    const schedule = (ms: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(tick, ms);
    };

    const miss = (why: string, hard = false) => {
      misses++;
      if (hard || misses >= 2) {
        setStatus("offline");
        setReason(why);
      }
    };

    async function tick() {
      timer = null;
      if (stopped || document.visibilityState !== "visible") return;
      const ctrl = new AbortController();
      inFlight = ctrl;
      const kill = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const q = new URLSearchParams({ since: sinceRef.current });
        if (openRef.current && !openRef.current.startsWith("tmp-")) q.set("open", openRef.current);
        const res = await fetch(`/api/admin/tasks/changes?${q}`, { cache: "no-store", signal: ctrl.signal, credentials: "same-origin" });
        if (res.status === 401 || res.status === 403) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          miss(body?.error ?? "Signed out of the admin console.", true);
        } else if (res.status === 410) {
          miss("This tab slept too long — reload the page.", true);
          return; // no point asking again
        } else if (!res.ok) {
          miss(`The server answered ${res.status}.`);
        } else {
          const data = (await res.json()) as Changes;
          sinceRef.current = new Date(Date.parse(data.now) - OVERLAP_MS).toISOString();
          if (data.rows.length) handlers.current.onRows(data.rows);
          if (data.detail) handlers.current.onDetail(data.detail);
          misses = 0;
          setStatus("live");
          setReason(null);
        }
      } catch {
        if (!stopped) miss("No answer from the server.");
      } finally {
        window.clearTimeout(kill);
        if (inFlight === ctrl) inFlight = null;
      }
      if (!stopped && document.visibilityState === "visible") schedule(misses > 0 ? RETRY_MS : EVERY_MS);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!inFlight) schedule(0);
      } else if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
    schedule(0);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, []);

  return { status, reason };
}
