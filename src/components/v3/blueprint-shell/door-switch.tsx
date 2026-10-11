"use client";
// THE DOOR SWITCH (2026-10-11, lib/editions): drawn only for an account that
// holds both workspaces. "Switch to Deck Studio" from the platform, "Back to
// JobFlex" from the studio — a plain form post, so it works before any script
// and from either shell. The icon is the caller's, from its own sprite.
import * as React from "react";
import { usePathname } from "next/navigation";
import type { Workspace } from "@/lib/editions";

export function DoorSwitch({ workspace, className, children }: { workspace: Workspace; className?: string; children?: React.ReactNode }) {
  const pathname = usePathname();
  const toDeck = workspace !== "deck";
  const label = toDeck ? "Switch to Deck Studio" : "Back to JobFlex";
  return (
    <form method="post" action="/api/door" style={{ display: "contents" }} data-deck-door-switch={toDeck ? "deck" : "platform"}>
      <input type="hidden" name="to" value={toDeck ? "deck" : "platform"} />
      {!toDeck && pathname && !pathname.startsWith("/dashboard/deck-estimator") ? <input type="hidden" name="next" value={pathname} /> : null}
      <button type="submit" className={className} aria-label={label} title={label}>
        {children}
      </button>
    </form>
  );
}
