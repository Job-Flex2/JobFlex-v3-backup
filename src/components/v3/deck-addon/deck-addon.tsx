"use client";

// THE DECK STUDIO ADD-ON, ON SCREEN (owner, 2026-10-19: "if existing users didn't purchase deck studio, they can't
// use it. Only preview it. And option to add it to the plan"). Three pieces, one offer (actions/deckAddon):
//   · DeckAddonDialog — what it adds, what it costs today, and the button that puts it on the plan;
//   · DeckPreviewBanner — the studio's band while it is a preview, and the trial's one line;
//   · DeckAddonCard — the Subscription page's row: on the plan (with Remove) or the way to add it.

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Check } from "lucide-react";
import { addDeckStudio, getDeckAddonOffer, removeDeckStudio, type DeckAddonView } from "@/actions/deckAddon";
import { deckAddonCents, deckAddonPriceWords } from "@/lib/deckAddon";
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
  if (o.trialing) return `Nothing today. It starts with your first bill after the trial${day(o.trialEndsAt) ? ` (${day(o.trialEndsAt)})` : ""}, then ${per}.`;
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
        toast.success(
          "Deck Studio is on your plan",
          res.trialing ? "Everything in the studio is open. The add-on starts with your first bill after the trial." : res.chargedCents > 0 ? `${dollars(res.chargedCents)} charged for the rest of this period. Everything in the studio is open.` : "Everything in the studio is open.",
        );
        onAdded?.();
        close();
        router.refresh();
      }
    } catch {
      setFailed("Couldn't add Deck Studio. Check the connection and try again.");
    }
    setBusy(false);
  };

  const per = deckAddonPriceWords(offer?.interval ?? "MONTH");
  return (
    <dialog ref={ref} className={`${s.da} ${s.dialog}`} onClose={close} aria-labelledby="deck-addon-title" data-deck-addon-dialog>
      <div className={s.body}>
        <div className={s.kicker}>Deck Studio · add-on</div>
        <h2 className={s.title} id="deck-addon-title">{why ?? "Add Deck Studio to your plan"}</h2>
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
          <div className={s.priceNote}>{offer ? (offer.canAdd ? dueWords(offer) : offer.interval === "YEAR" ? "Your plan is billed yearly, so the add-on is too — two months free." : "Cancel it any time from Subscription.") : "Reading your plan…"}</div>
        </div>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        {failed ? <p className={s.error} role="alert" data-deck-addon-error>{failed}</p> : null}
        {offer && !offer.canAdd && offer.reason ? <p className={s.note} data-deck-addon-reason>{offer.reason}</p> : null}
        <div className={s.acts}>
          {offer?.canAdd ? (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void add()} disabled={busy} data-deck-addon-add>
              {busy ? "Adding…" : `Add Deck Studio — ${per}`}
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

/** The studio's band while it is a preview; while the trial holds it, one line about after the trial. */
export function DeckPreviewBanner({ mode, trialEndsAt, onAdd }: { mode: "preview" | "trial"; trialEndsAt?: string | null; onAdd: () => void }) {
  if (mode === "trial") {
    return (
      <p className={`${s.da} ${s.trialLine}`} data-deck-trial-line>
        <span>
          Deck Studio is in your free trial{day(trialEndsAt ?? null) ? ` until ${day(trialEndsAt ?? null)}` : ""}. After it, the studio stays open for $49/month on your plan — without it, it&apos;s a preview.
        </span>
        <button type="button" onClick={onAdd} data-deck-trial-add>
          Keep it after the trial
        </button>
      </p>
    );
  }
  return (
    <div className={`${s.da} ${s.banner}`} role="note" data-deck-preview>
      <div className={s.bannerText}>
        <span className={s.stamp}>Preview</span>
        Design anything here — the deck in 3D, checked to code, priced. <b>Saving, sending and printing come with Deck Studio</b>, $49/month on your plan.
      </div>
      <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onAdd} data-deck-preview-add>
        Add Deck Studio
      </button>
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
        toast.success("Deck Studio removed", "The Deck estimator is a preview again. Your next bill is without it.");
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
        <span className={`${s.cardState} ${offer?.held ? s.cardOn : ""}`}>{offer?.held ? `On your plan · ${deckAddonPriceWords(offer.interval)}` : `${deckAddonPriceWords(offer?.interval ?? "MONTH")} · not added`}</span>
      </div>
      {error ? <p className={s.error} role="alert">{error}</p> : null}
      {offer ? (
        <p className={s.note}>
          {offer.held
            ? "The whole Deck estimator: drafts, proposals, the client's design link, material lists and the permit sheet."
            : offer.trialing
              ? "Your trial includes the whole Deck estimator. Add it to keep saving, sending and printing decks after the trial; without it the studio is a preview."
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
                  <span className={s.note}>Remove it now? The studio becomes a preview at once; nothing is refunded.</span>
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
                  Add Deck Studio
                </button>
              ) : offer.reason ? (
                <span className={s.note} data-deck-addon-reason>{offer.reason}</span>
              ) : null}
              <Link className={s.btn} href={"/dashboard/deck-estimator" as Route}>{offer.trialing ? "Open the Deck estimator" : "Try the preview"}</Link>
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
