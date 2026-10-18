// The platform admin's rule on rows already read — lib/fullAccess's pure half,
// database-free so lib/auth (the JWT role the middleware reads) can apply it
// without importing the module that reads the session. Ask hasFullAccess
// (lib/fullAccess) everywhere else.
import { ROLE_ROUTE_GATES } from "@/lib/roleRoutes";

/** The rule: the isPlatformAdmin flag, and a seat (any role) in this organization. */
export function fullAccessFor(user: { isPlatformAdmin?: boolean | null } | null | undefined, seat: unknown): boolean {
  return !!user?.isPlatformAdmin && !!seat;
}

/** The role the route gates and the role guards read. A platform admin's seat
 *  never narrows the dashboard: a limited role (installer, sales, estimator)
 *  reads as a manager. Anyone else keeps the role of the seat. */
export function accessRole(seatRole: string | null | undefined, full: boolean): string | null {
  if (!seatRole) return null;
  return full && ROLE_ROUTE_GATES[seatRole] ? "MANAGER" : seatRole;
}
