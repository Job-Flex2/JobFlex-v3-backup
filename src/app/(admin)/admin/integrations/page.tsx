import { requirePlatformAdmin } from "@/lib/orgContext";
import { readIntegrationsHealth } from "@/lib/integrationsHealth";
import { getIntegrationStatuses } from "@/lib/sdk/integrations";
import { getStripeMode, stripeKeyFor } from "@/lib/stripeMode";
import {
  AdminIntegrationsContent,
} from "@/components/v3/admin-integrations/integrations-content";

export default async function AdminIntegrationsPage() {
  await requirePlatformAdmin();

  const items = await getIntegrationStatuses();

  const [health, stripeMode] = await Promise.all([readIntegrationsHealth(), getStripeMode()]);

  return (
    <AdminIntegrationsContent
      items={items}
      initialHealth={health}
      stripeMode={stripeMode}
      stripeModes={{ live: Boolean(stripeKeyFor("live")), test: Boolean(stripeKeyFor("test")) }}
    />
  );
}
