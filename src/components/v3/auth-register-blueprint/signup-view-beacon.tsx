"use client";

// THE SIGN-UP SCREEN, IN THE BROWSER (owner, 2026-10-22, lib/signupView). Mounted by the register page in both
// screens. It keeps the visitor on the screen they were given (the jf_suv cookie: 30 days under the half-and-half
// split, the browser session when a link asked for it), tags every later analytics event with `signup_view`, records
// the split's exposure for the A/B tab — only once the screen has actually been drawn — and, inside the app, writes
// the name being typed into the preview: the sidebar's account block, its initials and the overview's greeting.
import { useEffect } from "react";
import { SIGNUP_VIEW_COOKIE, SIGNUP_VIEW_DAYS, SIGNUP_VIEW_EXPERIMENT, signupViewCookieValue, type SignupViewChoice } from "@/lib/signupView";
import { setTrafficSignupView, trackTrafficExperiment } from "@/lib/traffic-client";

function paintName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  const words = name ? name.split(" ") : [];
  const first = words[0] ?? "";
  const initials = words.length ? words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "You";
  document.querySelectorAll("[data-pv-name]").forEach((el) => { el.textContent = name || "Your name"; });
  document.querySelectorAll("[data-pv-initials]").forEach((el) => { el.textContent = initials; });
  document.querySelectorAll("[data-pv-greet]").forEach((el) => { el.textContent = first ? `Welcome, ${first}` : "Welcome"; });
}

export function SignupViewBeacon({ view, source }: SignupViewChoice) {
  useEffect(() => {
    const value = signupViewCookieValue({ view, source });
    const life = source === "link" ? "" : `; max-age=${SIGNUP_VIEW_DAYS * 86_400}`;
    try {
      document.cookie = `${SIGNUP_VIEW_COOKIE}=${value}; path=/; samesite=lax${life}${location.protocol === "https:" ? "; secure" : ""}`;
    } catch {
      /* a refused cookie only means the next visit may draw the other screen */
    }
    setTrafficSignupView(view);
    if (source === "split") trackTrafficExperiment(SIGNUP_VIEW_EXPERIMENT, view);
  }, [view, source]);

  useEffect(() => {
    if (view !== "app") return;
    const field = document.getElementById("name");
    if (field instanceof HTMLInputElement && field.value.trim()) paintName(field.value);
    const onInput = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && (el.id === "name" || el.name === "name")) paintName(el.value);
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, [view]);

  return null;
}
