// "Homeowner looking for a fence? Get quotes from local pros →" — under the button below the product shot on a trade's
// ad landing (lib/home/homeownerDoor). Its own tracked spot ("homeowner"), so a homeowner's click is told apart from
// the sign-up buttons on the live map and in the analyst.
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";

export function HomeownerDoor({ trade }: { trade?: string | null }) {
  const door = homeownerDoorFor(trade);
  if (!door) return null;
  return (
    <p className="lp-home-door" data-home-door={door.key}>
      Homeowner looking for {door.thing}?{" "}
      <a href={door.href} data-cta="homeowner">
        Get quotes from local pros<span aria-hidden> →</span>
      </a>
    </p>
  );
}
