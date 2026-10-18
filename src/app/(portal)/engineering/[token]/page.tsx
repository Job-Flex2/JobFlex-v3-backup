// THE ENGINEERING REQUEST — /engineering/<token>, the page an engineer opens from the contractor's email (Home Design
// Studio, milestone 5 — 2026-10-17). Public: the token is the key. The plan with each change numbered, what the plan
// says about each wall and why, what the contractor found on site, the questions — and a box under each to answer.
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { engKey, ENG_TOKEN_RE, NEEDS_WORDS, parseRequest } from "@/lib/design/engineering";
import { ChangePlan } from "@/components/v3/design-studio/change-plan";
import { AnswerBox, AnswerProvider } from "@/components/v3/design-studio/engineer-answer";
import s from "@/components/v3/design-studio/engineering-sheet.module.css";

export const dynamic = "force-dynamic";

const load = cache(async (token: string) => {
  if (!ENG_TOKEN_RE.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: engKey(token) }, select: { cursor: true } }).catch(() => null);
  const req = parseRequest(row?.cursor);
  return req && req.token === token ? req : null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const req = await load(token);
  return {
    title: req ? `Structural review · ${req.from.company}` : "Structural review · JobFlex",
    // Addressed to one engineer; never a search result.
    robots: { index: false, follow: false },
  };
}

const INK: Record<string, string> = { engineer: "var(--red)", check: "var(--amber)", header: "var(--blue)", none: "var(--muted)" };

export default async function EngineeringRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const req = await load(token);
  if (!req) return notFound();
  // Seen: the first time someone not signed in to JobFlex opens it (the contractor checking their own link isn't).
  if (!req.seenAt) {
    const session = await auth().catch(() => null);
    if (!session?.user) await db.syncState.update({ where: { key: engKey(token) }, data: { cursor: JSON.stringify({ ...req, seenAt: new Date().toISOString() }) } }).catch(() => {});
  }
  const date = new Date(req.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <main className={s.page}>
      <article className={s.sheet} data-eng-sheet>
        <header className={s.top}>
          <div>
            <div className={s.caps}>Structural review request · {date}</div>
            <h1 className={s.h1}>{req.address ?? req.title}</h1>
            <p className={s.sub}>
              {req.changes.length} {req.changes.length === 1 ? "change" : "changes"} to the house for your review
            </p>
          </div>
          <div className={s.from}>
            <b>{req.from.company}</b>
            {req.from.person ? <div>{req.from.person}</div> : null}
            {req.from.email ? <div>{req.from.email}</div> : null}
            {req.from.phone ? <div>{req.from.phone}</div> : null}
          </div>
        </header>
        {req.note ? (
          <section className={s.section}>
            <p className={s.note}>{req.note}</p>
          </section>
        ) : null}
        <section className={s.section}>
          <h2 className={s.h2}>The plan</h2>
          <div className={s.plan}>
            <ChangePlan plan={req.plan} changes={req.changes} />
          </div>
          <div className={s.legend}>
            <span>
              <i className={s.sw} style={{ background: "#fde2e2", border: "1.5px dashed #c0262d" }} />
              Where a wall stood
            </span>
            <span>
              <i className={s.sw} style={{ background: "#111" }} />
              Outside walls
            </span>
            <span>
              <i className={s.sw} style={{ background: "#3a3f47" }} />
              Inside walls
            </span>
            <span>
              <i className={s.sw} style={{ background: "#1d6fb8" }} />
              Windows
            </span>
          </div>
          <p className={s.foot} style={{ marginTop: 8 }}>
            Drawn from the architect&apos;s plan and the contractor&apos;s design; dimensions are the plan&apos;s, to be verified on site.
          </p>
        </section>
        <section className={s.section}>
          <h2 className={s.h2}>What the plan doesn&apos;t show</h2>
          <ul className={s.facts}>
            {req.site.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
        <AnswerProvider token={token} initial={req.answer ?? null} company={req.from.company}>
          <section className={s.section}>
            <h2 className={s.h2}>The changes</h2>
            {req.changes.map((c) => (
              <div key={c.id} className={s.change} data-eng-change={c.n}>
                <div className={s.num} style={{ background: INK[c.needs] }}>
                  {c.n}
                </div>
                <div>
                  <div className={s.title}>
                    {c.title}
                    <span className={s.chip} style={{ color: INK[c.needs] }}>
                      {NEEDS_WORDS[c.needs]}
                    </span>
                  </div>
                  <p className={s.why}>{c.why}</p>
                  <p className={s.read}>
                    <b>{c.reading.words}.</b> {c.reading.confirmed ? `From the plan alone it read ${(c.reading.plan ?? "").toLowerCase()}: ` : ""}
                    {c.reading.reasons.join(" ")}
                    {c.reading.plumbing ? ` ${c.reading.plumbing}` : ""}
                  </p>
                  <ul className={s.qs}>
                    {c.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                  <AnswerBox id={c.id} />
                </div>
              </div>
            ))}
          </section>
        </AnswerProvider>
        <section className={s.section}>
          <p className={s.foot}>
            Prepared with JobFlex from the contractor&apos;s design. The readings of which walls carry load come from the plan alone — the framing isn&apos;t on it — and are for your review, not a determination.
          </p>
        </section>
      </article>
    </main>
  );
}
