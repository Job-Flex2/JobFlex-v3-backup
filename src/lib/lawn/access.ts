import "server-only";
// WHO MAY USE THE LAWN & LANDSCAPE ESTIMATOR (2026-10-18): in preview, the same accounts as the Home Design Studio —
// platform admins, the admin console's sign-in and the owner's early-access account. The page and every action ask here.
import { canUseDesignStudio } from "@/lib/design/access";

export const canUseLawnEstimator = (user: { id: string; email?: string | null }) => canUseDesignStudio(user);
