"use client";

// THE DECK STUDIO ADD-ON, ON SCREEN (owner, 2026-10-19: "if existing users didn't purchase deck studio, they can't
// use it. Only preview it. And option to add it to the plan"). Three pieces, one offer (actions/deckAddon):
//   · DeckAddonDialog — what it adds, what it costs today, and the button that puts it on the plan;
//   · DeckPreviewBanner — the studio's band while it is a preview, and the trial's one line;
//   · DeckAddonCard — the Subscription page's row: on the plan (with Remove) or the way to add it.
// "Add Deck Studio" beside the plan cards is ./deck-addon-pick (no server actions, no toast: the sign-up loads it).

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Check } from "lucide-react";
import { addDeckStudio, getDeckAddonOffer, removeDeckStudio, type DeckAddonView } from "@/actions/deckAddon";
import { deckAddonCents, deckAddonHeldWords, deckAddonPriceWords, deckAddonShortWords, deckTrialWords, type AddonInterval } from "@/lib/deckAddon";
import { toast } from "@/components/ui/Toast";
import s from "./deck-addon.module.css";

const UNLOCKS = [
  "Drafts that save as you go, and open again from any device",
  "The proposal straight from the design — and updated when the design changes",
  "The client's design link, to shape the deck with you",
  "Material lists for the yard and the installer, and the permit sheet",
];

const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null);

const NO_READ = "Couldn't read your plan. Check the connection and try again.";
const readOffer = () => getDeckAddonOffer().catch(() => ({ ok: false as const, error: NO_READ }));

function useOffer(load: boolean) {
  const [offer, setOffer] = React.useState<DeckAddonView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const apply = React.useCallback((res: Awaited<ReturnType<typeof readOffer>>) => {
    if (res.ok) {
      setOffer(res.offer);
      setError(null);
    } else setError(res.error);
  }, []);
  const reload = React.useCallback(async () => apply(await readOffer()), [apply]);
  React.useEffect(() => {
    if (!load) return;
    let live = true;
    void readOffer().then((res) => {
      if (live) apply(res);
    });
    return () => {
      live = false;
    };
  }, [load, apply]);
  return { offer, error, reload };
}

/** What today's charge will be, in words. */
function dueWords(o: DeckAddonView): string {
  const per = deckAddonPriceWords(o.interval);
  if (o.dueNowCents === null) return `Today you pay for the rest of this billing period (prorated), then ${per} with each bill.`;
  if (o.dueNowCents === 0) return `Nothing more today; ${per} from your next bill.`;
  return `${dollars(o.dueNowCents)} today for the rest of this billing period, then ${per} with each bill.`;
}

export function DeckAddonDialog({ open, onClose, why, onAdded }: { open: boolean; onClose: () => void; why?: string | null; onAdded?: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const { offer, error, reload } = useOffer(open);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  const close = () => {
    setFailed(null);
    onClose();
  };

  const add = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const res = await addDeckStudio();
      if (!res.ok) {
        setFailed(res.error);
        void reload();
      } else {
        toast.success("Deck Studio is on your plan", res.chargedCents > 0 ? `${dollars(res.chargedCents)} charged for the rest of this period. Everything in the studio is open.` : "Everything in the studio is open.");
        onAdded?.();
        close();
        router.refresh();
      }
    } catch {
      setFailed("Couldn't add Deck Studio. Check the connection and try again.");
    }
    setBusy(false);
  };

  const short = deckAddonShortWords(offer?.interval ?? "MONTH");
  // The trial (or a complimentary plan) holds the studio: the dialog says so and offers nothing to add.
  const included = offer?.included ?? null;
  return (
    <dialog ref={ref} className={`${s.da} ${s.dialog}`} onClose={close} aria-labelledby="deck-addon-title" data-deck-addon-dialog data-deck-addon-included={included ?? undefined}>
      <div className={s.body}>
        <div className={s.kicker}>Deck Studio · add-on</div>
        <h2 className={s.title} id="deck-addon-title">{included === "trial" ? "Included in your trial" : included === "custom" ? "Included in your Custom plan" : included === "grant" ? "Included in your plan" : included === "admin" ? "Open to platform admins" : (why ?? "Add Deck Studio to your plan")}</h2>
        <p className={s.lead}>The preview designs anything — the deck in 3D, checked to code, priced. Deck Studio adds the rest:</p>
        <ul className={s.list}>
          {UNLOCKS.map((u) => (
            <li key={u}>
              <Check className={s.tick} strokeWidth={3} aria-hidden="true" />
              <span>{u}</span>
            </li>
          ))}
        </ul>
        <div className={s.price} data-deck-addon-price>
          <div className={s.priceBig}>
            {`$${Math.round(deckAddonCents(offer?.interval ?? "MONTH") / 100)}`}
            <small> /{offer?.interval === "YEAR" ? "year" : "month"}, added to your plan</small>
          </div>
          <div className={s.priceNote}>{offer ? (included ? offer.reason : offer.canAdd ? dueWords(offer) : offer.interval === "YEAR" ? "Your plan is billed yearly, so the add-on is too — two months free." : "Cancel it any time from Subscription.") : "Reading your plan…"}</div>
        </div>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        {failed ? <p className={s.error} role="alert" data-deck-addon-error>{failed}</p> : null}
        {offer && !offer.canAdd && !included && offer.reason ? <p className={s.note} data-deck-addon-reason>{offer.reason}</p> : null}
        <div className={s.acts}>
          {offer?.canAdd ? (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void add()} disabled={busy} data-deck-addon-add>
              {busy ? "Adding…" : `Add Deck Studio · ${short}`}
            </button>
          ) : null}
          <button type="button" className={s.btn} onClick={close} disabled={busy}>
            {offer?.canAdd ? "Not now" : "Close"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The studio's band while it is a preview (a saved deck: to look at and print); while the trial holds it, one line
 *  about after the trial — nothing to add in a trial (owner, 2026-10-20). */
export function DeckPreviewBanner({ mode, trialEndsAt, interval = "MONTH", saved = false, onAdd, children }: { mode: "preview" | "trial"; trialEndsAt?: string | null; interval?: AddonInterval; saved?: boolean; onAdd?: () => void; children?: React.ReactNode }) {
  if (mode === "trial") {
    const until = day(trialEndsAt ?? null);
    return (
      <p className={`${s.da} ${s.trialLine}`} data-deck-trial-line>
        <span>
          {deckTrialWords(interval)}
          {until ? ` Your trial runs until ${until}.` : ""}
        </span>
      </p>
    );
  }
  return (
    <div className={`${s.da} ${s.banner}`} role="note" data-deck-preview={saved ? "saved" : "design"}>
      <div className={s.bannerText}>
        <span className={s.stamp}>{saved ? "View only" : "Preview"}</span>
        {saved ? (
          <>
            A saved deck, to look at and print. <b>Changing it takes Deck Studio.</b>
          </>
        ) : (
          <>
            Design anything here — the deck in 3D, checked to code, priced. <b>Saving, sending and printing come with Deck Studio.</b>
          </>
        )}
      </div>
      <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onAdd} data-deck-preview-add>
        Add Deck Studio · {deckAddonShortWords(interval)}
      </button>
      {/* A saved deck's prints: from the saved copy, open in the preview too. */}
      {children ? <div className={s.prints}>{children}</div> : null}
    </div>
  );
}

/** The Subscription page's row: the add-on on the plan, or the way to it. Reads its own state. */
export function DeckAddonCard() {
  const router = useRouter();
  const { offer, error, reload } = useOffer(true);
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const res = await removeDeckStudio();
      if (!res.ok) setFailed(res.error);
      else {
        toast.success("Deck Studio removed", "The Deck estimator is a preview again. The unused part of this period is a credit on your next bill.");
        setConfirm(false);
        await reload();
        router.refresh();
      }
    } catch {
      setFailed("Couldn't remove Deck Studio. Try again.");
    }
    setBusy(false);
  };

  if (!offer && !error) return null;
  return (
    <section className={`${s.da} ${s.card}`} aria-label="Deck Studio add-on" data-deck-addon-card>
      <div className={s.cardHead}>
        <h3 className={s.cardTitle}>Deck Studio add-on</h3>
        <span className={`${s.cardState} ${offer?.held || offer?.included ? s.cardOn : ""}`} data-deck-addon-state>
          {offer?.held ? `On your plan · ${deckAddonHeldWords(offer.heldCents, offer.interval, { long: true })}` : offer?.included === "trial" ? "Included in your trial" : offer?.included === "custom" ? "Included in your Custom plan" : offer?.included === "grant" ? "Included in your plan" : offer?.included === "admin" ? "Open to platform admins" : `${deckAddonPriceWords(offer?.interval ?? "MONTH")} · not added`}
        </span>
      </div>
      {error ? <p className={s.error} role="alert">{error}</p> : null}
      {offer ? (
        <p className={s.note}>
          {offer.held
            ? "The whole Deck estimator: drafts, proposals, the client's design link, material lists and the permit sheet."
            : offer.included === "trial"
              ? `${deckTrialWords(offer.interval)} Nothing is added to your subscription now — add it here once the trial is over to keep saving, sending and printing.`
              : offer.included === "custom"
                ? "Your Custom plan has the Deck estimator page, so the whole Deck Studio is yours — no separate add-on."
                : offer.included === "grant"
                ? "Your complimentary plan includes the whole Deck estimator."
                : offer.included === "admin"
                ? "A platform admin has the whole Deck estimator in every company — nothing to add."
                : "Without it the Deck estimator is a preview: design anything, save and send nothing. Add it to open the whole studio."}
        </p>
      ) : null}
      {failed ? <p className={s.error} role="alert">{failed}</p> : null}
      {offer ? (
        <div className={s.acts}>
          {offer.held ? (
            offer.owner ? (
              confirm ? (
                <>
                  <span className={s.note}>Remove it now? The studio becomes a preview at once; the unused part of this period is a credit on your next bill.</span>
                  <button type="button" className={s.btn} onClick={() => void remove()} disabled={busy} data-deck-addon-remove-yes>
                    {busy ? "Removing…" : "Remove Deck Studio"}
                  </button>
                  <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={() => setConfirm(false)} disabled={busy}>
                    Keep it
                  </button>
                </>
              ) : (
                <>
                  <Link className={s.btn} href={"/dashboard/deck-estimator" as Route}>Open the Deck estimator</Link>
                  <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={() => setConfirm(true)} data-deck-addon-remove>
                    Remove
                  </button>
                </>
              )
            ) : null
          ) : (
            <>
              {offer.canAdd ? (
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setOpen(true)} data-deck-addon-open>
                  Add Deck Studio · {deckAddonShortWords(offer.interval)}
                </button>
              ) : offer.reason && !offer.included ? (
                <span className={s.note} data-deck-addon-reason>{offer.reason}</span>
              ) : null}
              <Link className={s.btn} href={"/dashboard/deck-estimator" as Route}>{offer.included ? "Open the Deck estimator" : "Try the preview"}</Link>
            </>
          )}
        </div>
      ) : null}
      <DeckAddonDialog open={open} onClose={() => setOpen(false)} onAdded={() => void reload()} />
    </section>
  );
}

/** One button that opens the dialog — for the server-drawn pages (the deck inventory's offer). */
export function DeckAddonButton({ label = "Add Deck Studio", className }: { label?: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" className={className ?? `${s.btn} ${s.btnPrimary}`} onClick={() => setOpen(true)} data-deck-offer="addon">
        {label}
      </button>
      <DeckAddonDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

