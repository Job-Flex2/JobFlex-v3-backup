"use client";

// ADMIN · TASKS — the page when the tracker's tables are not in this database
// yet (lib/adminTasks/service loadTasksPage → "missing"). A plain note in the
// page's own head instead of a 500; the rest of the console keeps working.

import { useAdminMotion } from "@/components/v3/admin-users/use-admin-motion";
import { KIT_BTN_CLASS, Note } from "@/components/v3/admin-users/admin-kit";
import { cx } from "./task-bits";

export function TasksUnavailable() {
  useAdminMotion(KIT_BTN_CLASS);
  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform</div>
          <h1 className={cx("page-title")}>Tasks</h1>
        </div>
      </div>
      <section className={cx("card")}>
        <Note tone="warn">
          <b>Tasks are not set up yet.</b> The task tables are not in this database. Apply
          prisma/sql/prod-2026-10-11-admin-tasks.sql (or restart a dev server started before the schema changed), then reload.
        </Note>
      </section>
    </>
  );
}
