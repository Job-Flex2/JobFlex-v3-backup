// Admin · Tasks — the platform admins' own task tracker (2026-10-11).
//
// The admin layout mounts the blueprint shell and guards the console; this
// page asks again (requirePlatformAdmin) because a page must never rely on a
// layout for its own data. Every task is read here once — the list is small
// and the filters run in the browser, so filtering never waits on the server —
// and from then on the page keeps itself current through the live poll
// (/api/admin/tasks/changes), not by re-rendering this route.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { loadTasksPage } from "@/lib/adminTasks/service";
import { isConsoleEmail } from "@/lib/adminTasks/model";
import { parseFilters } from "@/lib/adminTasks/filters";
import { AdminTasksContent } from "@/components/v3/admin-tasks/admin-tasks-content";
import { TasksUnavailable } from "@/components/v3/admin-tasks/tasks-unavailable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Tasks",
  description: "The platform team's tasks: who has what, how far along, and what is late.",
};

type SP = Record<string, string | string[] | undefined>;

export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  // Read before the rows: the live poll starts from here, so a write that
  // lands while they load is still "after" it.
  const now = new Date();
  const openId = typeof sp.task === "string" && sp.task.length <= 64 ? sp.task : null;

  // Without the task tables (not applied yet, or a dev server's old client)
  // the page says so instead of a 500. Any other error still throws.
  const data = await loadTasksPage(openId);
  if (data.status === "missing") return <TasksUnavailable />;
  const { rows, people, detail } = data;

  return (
    <AdminTasksContent
      initialRows={rows}
      initialDetail={detail}
      initialFilters={parseFilters(sp)}
      people={people}
      me={{ id: admin.id, console: isConsoleEmail(admin.email) }}
      // The server's clock and its UTC day: the first paint and the hydration
      // agree on both, then the viewer's own zone takes over.
      serverNow={now.toISOString()}
      serverToday={now.toISOString().slice(0, 10)}
      // A ?task= link to a task that no longer exists says so instead of opening nothing.
      missingTask={openId !== null && detail === null}
    />
  );
}
