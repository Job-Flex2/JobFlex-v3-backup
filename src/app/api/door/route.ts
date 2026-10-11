// THE DOOR SWITCH (2026-10-11, lib/editions): the sidebar's "Switch to Deck
// Studio" / "Back to JobFlex" posts here; the choice is remembered a year and
// the browser is sent to that door's home (or the `next` it asked for).
import { NextResponse } from "next/server";
import { DOOR_COOKIE, DOOR_MAX_AGE_S, EDITIONS, parseDoor } from "@/lib/editions";
import { safeNextPath } from "@/lib/safeNext";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const door = parseDoor(String(form?.get("to") ?? "")) ?? "platform";
  const next = safeNextPath(String(form?.get("next") ?? ""));
  const url = new URL(next && next !== "/dashboard" ? next : EDITIONS[door].homeHref, req.url);
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(DOOR_COOKIE, door, { path: "/", maxAge: DOOR_MAX_AGE_S, sameSite: "lax", secure: url.protocol === "https:" });
  return res;
}
