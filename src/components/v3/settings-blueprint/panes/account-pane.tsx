"use client";

// Settings blueprint — ACCOUNT pane.
//
// Cards, in donor order: Profile · Business · Security.
//
// REAL DATA. Profile is the signed-in User row (name / email / phone) and a
// red "Log out" at the foot of the pane; Business is the Organization row
// (manager-gated). Security: password hands off to /auth/forgot, "Log out
// everywhere" and the page-level "Log out" are the SAME action now (owner's
// call, 2026-09-03): bump the credential epoch so every other device's token
// dies on its next request, then sign this browser out.
//
// GONE (owner's call, 2026-09-03): the Role field (the header badge already
// says it) and the Danger zone card — deleteOrganization stays in
// src/actions/accountSettings.ts, nothing on this page calls it.
//
// ADDED the same day, flagged "Testing": a Delete-account card. HARD delete
// of the user (deleteMyAccount) so the owner can register the same address
// again while debugging signup; it is slated for removal at launch.

import { useState } from "react";

import { signOut } from "next-auth/react";

import { deleteMyAccount, updateBusiness, updateProfile } from "@/actions/accountSettings";
import { SignOutButton, logOutEverywhere } from "@/components/v3/blueprint-shell/sign-out";
import type { Badge, CardHead, PaneProps, SecurityKey } from "../settings-data";
import {
  BUSINESS_CARD,
  BUSINESS_LABELS,
  DELETE_ACCOUNT_CARD,
  DELETE_ACCOUNT_MODAL,
  DELETE_ACCOUNT_ROW,
  PROFILE_CARD,
  PROFILE_LABELS,
  SECURITY_CARD,
  SECURITY_ITEMS,
  SIGN_OUT_LABEL,
  deleteAccountDesc,
} from "../settings-data";
import { Field, Modal, SaveBar, actionError } from "../ui";
import { PasswordControl } from "@/components/account-password/password-control";

function Badge2({ badge }: { badge: Badge }) {
  return (
    <span className={`badge2 ${badge.tone}`}>
      <i />
      {badge.label}
    </span>
  );
}

function CardHeader({ card, badge }: { card: CardHead; badge?: Badge }) {
  const shown = badge ?? card.badge;
  return (
    <div className="sc-h">
      <div>
        <div className="sc-t">{card.title}</div>
        <div className="sc-s">{card.sub}</div>
      </div>
      {shown ? <Badge2 badge={shown} /> : null}
    </div>
  );
}

export function AccountPane({ data }: PaneProps) {
  const a = data.account;

  const [name, setName] = useState(a.name);
  const [phone, setPhone] = useState(a.phone);

  const [bizName, setBizName] = useState(a.business.name);
  const [bizAddress, setBizAddress] = useState(a.business.address);
  const [bizWebsite, setBizWebsite] = useState(a.business.website);
  const [bizPhone, setBizPhone] = useState(a.business.phone);

  const [signingOutAll, setSigningOutAll] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const emailMatches = confirm.trim().toLowerCase() === a.email.toLowerCase();

  async function runDelete() {
    if (!emailMatches || deleting) return;
    setDeleting(true);
    setDeleteErr("");
    try {
      await deleteMyAccount({ confirmEmail: confirm.trim() });
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      setDeleteErr(actionError(e));
      setDeleting(false);
    }
  }

  // The account's own password, added or changed here (2026-10-10).
  const [hasPw, setHasPw] = useState(a.hasPassword);
  const securityDesc: Record<SecurityKey, string> = {
    password: hasPw ? "Set. Sign in with it, with a code from email or with Google." : "Not set. You sign in with a code from email or with Google.",
    sessions: a.security.sessionsDesc,
  };

  async function signOutAll() {
    setSigningOutAll(true);
    try {
      await logOutEverywhere("/auth/login");
    } catch {
      setSigningOutAll(false);
    }
  }

  return (
    <>
      {/* ── Profile ── */}
      <section className="sc">
        <CardHeader card={PROFILE_CARD} badge={{ label: a.roleBadge, tone: "bg-live" }} />
        <div className="sc-b">
          <div className="fgrid">
            <Field label={PROFILE_LABELS.name} value={name} onChange={setName} />
            <Field label={PROFILE_LABELS.email} value={a.email} disabled />
            <Field label={PROFILE_LABELS.phone} value={phone} onChange={setPhone} />
          </div>
        </div>
        <SaveBar watch={[name, phone]} onSave={() => updateProfile({ name, phone })} />
      </section>

      {/* ── Business ── */}
      <section className="sc">
        <CardHeader card={BUSINESS_CARD} />
        <div className="sc-b">
          <div className="fgrid">
            <Field label={BUSINESS_LABELS.name} value={bizName} onChange={setBizName} disabled={!a.canEditBusiness} />
            <Field label={BUSINESS_LABELS.address} value={bizAddress} onChange={setBizAddress} disabled={!a.canEditBusiness} />
            <Field label={BUSINESS_LABELS.website} value={bizWebsite} onChange={setBizWebsite} disabled={!a.canEditBusiness} />
            <Field label={BUSINESS_LABELS.phone} value={bizPhone} onChange={setBizPhone} disabled={!a.canEditBusiness} />
          </div>
        </div>
        <SaveBar
          disabled={!a.canEditBusiness}
          watch={[bizName, bizAddress, bizWebsite, bizPhone]}
          onSave={() => updateBusiness({ name: bizName, address: bizAddress, website: bizWebsite, phone: bizPhone })}
        />
      </section>

      {/* ── Security ── */}
      <section className="sc">
        <CardHeader card={SECURITY_CARD} />
        <div className="sc-b">
          <div className="seccols">
            {SECURITY_ITEMS.map((item) => (
              <div className="seccol" key={item.key} id={item.key === "password" ? "password" : undefined}>
                <span className="prow-ic">
                  <svg className="ic">
                    <use href={`#${item.icon}`} />
                  </svg>
                </span>
                <span className="prow-n">{item.name}</span>
                <span className="prow-d">{securityDesc[item.key]}</span>
                {item.badge ? <Badge2 badge={item.badge} /> : null}
                {item.key === "password" ? (
                  <PasswordControl hasPassword={hasPw} email={a.email} buttonClassName="btn btn-ghost btn-sm seccol-act" onSaved={setHasPw} />
                ) : (
                  <button
                    className="btn btn-ghost btn-sm seccol-act"
                    type="button"
                    disabled={signingOutAll}
                    onClick={() => void signOutAll()}
                  >
                    {signingOutAll ? "Logging out…" : item.action}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Delete account (testing) ── */}
      <section className="sc">
        <CardHeader card={DELETE_ACCOUNT_CARD} />
        <div className="sc-b">
          <div className="prow prow--flush">
            <span className="prow-b">
              <span className="prow-n">{DELETE_ACCOUNT_ROW.name}</span>
              <span className="prow-d">{deleteAccountDesc(a.email, a.business.name)}</span>
            </span>
            <span className="prow-act">
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={() => {
                  setConfirm("");
                  setDeleteErr("");
                  setDeleteOpen(true);
                }}
              >
                {DELETE_ACCOUNT_ROW.action.icon ? (
                  <svg className="ic">
                    <use href={`#${DELETE_ACCOUNT_ROW.action.icon}`} />
                  </svg>
                ) : null}
                {DELETE_ACCOUNT_ROW.action.label}
              </button>
            </span>
          </div>
        </div>
      </section>

      {/* ── Log out — last thing on the page, red like the other exit. ── */}
      <div className="sactions sactions--logout">
        <SignOutButton className="btn btn-danger" iconClassName="ic" label={SIGN_OUT_LABEL} />
      </div>

      {/* Renders in the shell's overlay layer (not here in the pane) so its
          scrim covers the sidebar and topbar too, and plays its exit after
          `deleteOpen` turns false — see ui.tsx `Modal`. */}
      <Modal
        open={deleteOpen}
        title={DELETE_ACCOUNT_MODAL.title}
        sub={DELETE_ACCOUNT_MODAL.sub}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        footer={
          <>
            <button className="btn btn-ghost" type="button" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              {DELETE_ACCOUNT_MODAL.cancelLabel}
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={!emailMatches || deleting}
              onClick={() => void runDelete()}
            >
              {deleting ? "Deleting…" : DELETE_ACCOUNT_MODAL.confirmLabel}
            </button>
          </>
        }
      >
        <div className="prow-d" style={{ marginBottom: 12 }}>
          {deleteAccountDesc(a.email, a.business.name)}
        </div>
        <Field label={DELETE_ACCOUNT_MODAL.inputLabel} value={confirm} onChange={setConfirm} placeholder={a.email} />
        {confirm && !emailMatches ? (
          <div className="prow-d prow-warn" style={{ marginTop: 8 }}>
            {DELETE_ACCOUNT_MODAL.mismatch}
          </div>
        ) : null}
        {deleteErr ? (
          <div className="prow-d prow-warn" style={{ marginTop: 8 }}>
            {deleteErr}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
