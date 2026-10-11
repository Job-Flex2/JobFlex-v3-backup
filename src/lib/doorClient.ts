// THE DOOR COOKIE IN THE BROWSER (2026-10-11, lib/editions): the sign-in page
// writes the choice, the sign-in form reads it to pick where to land. Not
// httpOnly on purpose — the server reads the same cookie (lib/editionAccess).
import { DOOR_COOKIE, DOOR_MAX_AGE_S, EDITIONS, parseDoor, type Door } from "@/lib/editions";

export function readDoorCookie(): Door | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${DOOR_COOKIE}=([^;]*)`));
  return parseDoor(m ? decodeURIComponent(m[1]) : null);
}

export function writeDoorCookie(door: Door): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${DOOR_COOKIE}=${door}; path=/; max-age=${DOOR_MAX_AGE_S}; samesite=lax${secure}`;
}

/** Where a sign-in goes: an explicit ?next= wins; else the door's own home. */
export function signInDestination(nextPath: string | null | undefined, door: Door | null = readDoorCookie()): string {
  if (nextPath && nextPath !== "/dashboard") return nextPath;
  return door === "deck" ? EDITIONS.deck.homeHref : EDITIONS.platform.homeHref;
}
