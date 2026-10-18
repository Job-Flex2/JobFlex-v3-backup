import { requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { SupportForm } from "./support-form";
import { SupportFaq } from "./support-faq";
import { SupportTickets, type SupportTicketView } from "./support-tickets";
import { customerLabel, threadsFor } from "@/lib/supportThread";
import { openingMessage } from "@/lib/supportReply";

export const dynamic = "force-dynamic";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string | string[] }>;
}) {
  // ?ticket=<id> — the "Open conversation" button in every letter about a ticket.
  const sp = await searchParams;
  const openTicketId = typeof sp.ticket === "string" ? sp.ticket : null;
  // Every role (owner, 2026-10-17: installers, sales and estimators too — each
  // files tickets from the Help widget and must be able to answer in them; the
  // route gate is lib/roleRoutes) — and only the viewer's OWN tickets.
  //
  // This page listed every ticket the organization had ever filed, body
  // included. A ticket is addressed to the JobFlex platform, not to the
  // contractor: an installer writing about their employer had no way to know
  // that employer could read it verbatim from here, and no way to opt out.
  // Filtering by userId is what makes the page's own words ("Your tickets",
  // "Your conversations", "Only you and our team can see this") true. The
  // cross-org view stays where it belongs, on the operator's console at
  // /admin/support.
  const { organizationId, user } = await requireOrg();
  const tickets = await db.supportTicket.findMany({
    where: { organizationId, userId: user.id },
    // The conversation with the latest message first.
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: {
      id: true,
      subject: true,
      body: true,
      category: true,
      priority: true,
      status: true,
      createdAt: true,
      lastMessageAt: true,
    },
  });

  // Each ticket's conversation (2026-10-17, lib/supportThread): their words, ours, the AI's — the same that went by email.
  const [threads, me] = await Promise.all([
    threadsFor(tickets.map((t) => t.id)),
    db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
  ]);
  const by = customerLabel({ user: me });

  const open = tickets.filter((t) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS").length;
  const resolved = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;

  const pulse = [
    { label: "Open", value: open },
    { label: "In progress", value: inProgress },
    { label: "Resolved", value: resolved },
  ];

  const view: SupportTicketView[] = tickets.map((t) => ({
    id: t.id,
    subject: t.subject,
    body: t.body,
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messages: [openingMessage({ id: t.id, body: t.body, createdAt: t.createdAt.toISOString(), by }), ...(threads[t.id] ?? [])],
  }));

  return (
    <div className="pb-10">
      {/* ── Bold masthead: ink-on-paper headline beside a color-blocked sage pulse ── */}
      <header className="paper-card p-0 overflow-hidden !shadow-[var(--shadow-md)]">
        <div className="grid lg:grid-cols-[1.5fr_1fr]">
          <div className="px-7 py-8 lg:py-10">
            <span className="quiet-caps text-[color:var(--accent-ink)]">Help &amp; Support</span>
            <h1 className="mt-2 font-display text-[34px] lg:text-[40px] leading-[1.04] tracking-[-0.025em] text-[color:var(--ink)]">
              How can we help?
            </h1>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[color:var(--ink-muted)]">
              Tell us what&apos;s going on and we&apos;ll get you unstuck. Every message is tracked
              right here until it&apos;s resolved.
            </p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-soft)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--accent-ink)]">
              <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
              Typical reply within one business day
            </span>
          </div>

          {/* Drenched-sage ledger — the bold anchor, read as a well-kept shop's
              tally (label · numeral, hairline-ruled) rather than a SaaS hero. */}
          <div className="flex flex-col justify-center bg-[color:var(--accent)] px-7 py-8 lg:py-9">
            <span className="quiet-caps !text-white/90">Your tickets</span>
            <dl className="mt-2 divide-y divide-white/20">
              {pulse.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between py-3">
                  <dt className="text-[12.5px] font-medium text-white/90">{s.label}</dt>
                  <dd className="stat-numeric text-[30px] leading-none text-white tabular">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </header>

      {/* ── Contact form + self-serve help ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] items-start">
        <SupportForm />
        <SupportFaq />
      </div>

      {/* ── Status-tracked conversation history ── */}
      <section className="mt-9">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[18px] tracking-[-0.015em] text-[color:var(--ink)]">
            Your conversations
          </h2>
          <span className="text-[12px] text-[color:var(--ink-muted)] tabular">
            {tickets.length} conversation{tickets.length === 1 ? "" : "s"}
          </span>
        </div>
        <SupportTickets tickets={view} openId={openTicketId} />
      </section>
    </div>
  );
}
