// /admin/mail has one page under it so far: the log of sent mail.
import { redirect } from "next/navigation";

export default function AdminMailPage() {
  redirect("/admin/mail/log");
}
