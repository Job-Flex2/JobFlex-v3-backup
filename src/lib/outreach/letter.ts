// THE OUTREACH EMAIL (2026-10-23) — pure. A contractor whose number the AI may not call (a cell phone, an internet
// line) gets ONE plain letter: who we are, a thank-you for the work they do, what the AI desk does, and the
// "Have the AI desk call me" link — on that page, ticking the box, they ask for the call themselves. Written the way the
// admin's contractor letters are (lib/adminMail/compose contractorLetter): no images, no boxes, a text twin, the
// one-click unsubscribe; and what the email law asks of a first commercial email: it says what it is, where it comes
// from (a postal address) and how to stop.

import { tradeWords } from "./script";
import type { Prospect } from "./rules";

export interface OutreachLetter {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

export function outreachLetter(input: { p: Pick<Prospect, "name" | "business" | "trade">; sender: string; callMeUrl: string; siteUrl: string; unsubscribeUrl: string; postal: string }): OutreachLetter {
  const { p } = input;
  const t = tradeWords(p.trade);
  const who = firstName(p.name);
  const biz = p.business || "your business";
  const subject = `Who answers ${p.business ? `${p.business}'s` : "your"} phone when you're on a job?`;
  const paras = [
    who ? `Hi ${who},` : "Hi,",
    `I'm ${input.sender}, from JobFlex — we make software for contractors. First, thank you for what you do: people count on ${t.who} for ${t.help}, and that matters.`,
    `We built an AI desk that answers a contractor's phone in their own company's name, books visits onto their calendar and texts them what came in — so the call that comes in while you're up on a job isn't lost to the next company on the list. JobFlex also writes the estimates and the proposals your customers sign on their phone, and keeps the schedule.`,
    `The quickest way to see it is to hear it: tap the link below and it will call you in about half a minute and answer the way it would for ${biz}.`,
  ];
  const linkLabel = "Have the AI desk call me";
  const why = `You're getting this one-time note because ${biz} is listed publicly as a local contractor. It's an introduction from JobFlex; we won't email again unless you write back.`;
  const P = 'style="margin:0 0 16px;font:15px/1.6 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;"';
  const html = [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;">',
    ...paras.map((x) => `<p ${P}>${esc(x)}</p>`),
    `<p ${P}><a href="${esc(input.callMeUrl)}" style="color:#1854a0;text-decoration:underline;font-weight:600;">${esc(linkLabel)}</a></p>`,
    `<p ${P}>Or have a look first at <a href="${esc(input.siteUrl)}" style="color:#1854a0;text-decoration:underline;">jobflex.app</a>.</p>`,
    `<p style="margin:24px 0 0;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">${esc(input.sender)}<br><span style="color:#6a6a6a;">JobFlex · jobflex.app</span></p>`,
    `<p style="margin:32px 0 0;padding-top:12px;border-top:1px solid #e5e5e5;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a8a8a;">${esc(why)} <a href="${esc(input.unsubscribeUrl)}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a><br>${esc(input.postal)}</p>`,
    "</div></body></html>",
  ].join("\n");
  const text = [...paras, `${linkLabel}: ${input.callMeUrl}`, `Or have a look first: ${input.siteUrl}`, `${input.sender}\nJobFlex · jobflex.app`, `--\n${why}\nUnsubscribe: ${input.unsubscribeUrl}\n${input.postal}`].join("\n\n");
  return { subject, html, text };
}
