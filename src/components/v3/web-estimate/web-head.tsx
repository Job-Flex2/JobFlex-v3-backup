// THE SHOP'S BRAND ON ITS WEBSITE PAGES (owner, 2026-10-28: "the client's company name should be like a bigger logo on
// it, so it wouldn't confuse the client that he is working on the contractor's website but a different name appears
// up there"). The contractor's logo big and their name first; JobFlex a quiet "by JobFlex" mark, never the headline.
// Inside a frame on their own site (embed) the shop's own header is already above: one short brand line.
// THE HOUSE (2026-10-28, lib/webEstimator houseShop): JobFlex is the shop — no "by JobFlex" twice; a way back to the
// row of estimators on /price instead.
import * as React from "react";

export interface WebHeadProps {
  shop: { name: string; logoUrl: string | null; house?: boolean };
  /** "Your roof, priced" — the page's own title, under the brand. */
  title: string;
  /** "Deck Studio", "Roof estimator"… — what the small mark says this is. */
  tool: string;
  embed: boolean;
}

export function WebHead({ shop, title, tool, embed }: WebHeadProps) {
  if (embed) {
    return (
      <div className="we-embedHead">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo URL, any host
          <img className="we-embedLogo" src={shop.logoUrl} alt="" />
        ) : null}
        <b>{title}</b>
        {shop.house ? null : <span className="we-by">{tool} by JobFlex</span>}
      </div>
    );
  }
  return (
    <header className="we-head">
      <div className="we-brand">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo URL, any host
          <img className="we-logo" src={shop.logoUrl} alt={shop.name} />
        ) : (
          <span className="we-mark" aria-hidden="true">{shop.name.slice(0, 1)}</span>
        )}
        <div className="we-brandText">
          <div className="we-shop">{shop.name}</div>
          <div className="we-title">{title}</div>
        </div>
      </div>
      {shop.house ? (
        <a className="we-back" href="/price" data-web-back>← Price another project</a>
      ) : (
        <div className="we-by" aria-label={`${tool} by JobFlex`}>
          <span className="we-byTool">{tool}</span>
          <span className="we-byJf">by JobFlex</span>
        </div>
      )}
    </header>
  );
}
