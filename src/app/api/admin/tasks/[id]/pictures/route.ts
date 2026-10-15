// POST /api/admin/tasks/<id>/pictures — one picture onto a task (2026-10-15, owner: "upload the pictures").
//
// Multipart, field `file`. The page shrinks a photo to 1800 px JPEG before it sends (lib/media/uploadJobMedia
// shrinkPhoto), so a phone's 12 MB shot arrives at a few hundred KB; 8 MB is the ceiling here. Platform admins only —
// the same requirePlatformAdmin as every task action. Answers with the task in full, its pictures' fresh links
// included, so the sheet draws it at once; the other admins see it through the live poll.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { addTaskPicture, PictureError, PICTURE_MAX_BYTES } from "@/lib/adminTasks/pictures";
import { getTaskDetail } from "@/lib/adminTasks/service";
import { personName } from "@/lib/adminTasks/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let actor: { id: string; email: string; name: string | null };
  try {
    actor = await requirePlatformAdmin();
  } catch (err) {
    const forbidden = err instanceof Error && err.message === "Platform admin only";
    return Response.json({ ok: false, error: forbidden ? "Platform admins only." : "Sign in to the admin console." }, { status: forbidden ? 403 : 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  if (!id || id.length > 64) return Response.json({ ok: false, error: "That task doesn't exist." }, { status: 404, headers: NO_STORE });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return Response.json({ ok: false, error: "That upload didn't come through — try again." }, { status: 400, headers: NO_STORE });
  }
  if (!file) return Response.json({ ok: false, error: "Pick a picture to upload." }, { status: 400, headers: NO_STORE });
  if (file.size > PICTURE_MAX_BYTES) return Response.json({ ok: false, error: "That picture is too big (8 MB at most)." }, { status: 413, headers: NO_STORE });

  try {
    await addTaskPicture({ id: actor.id, name: personName(actor) }, id, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name });
    const task = await getTaskDetail(id);
    return Response.json(task ? { ok: true, task } : { ok: false, error: "This task no longer exists." }, { status: task ? 200 : 404, headers: NO_STORE });
  } catch (err) {
    if (err instanceof PictureError) return Response.json({ ok: false, error: err.message }, { status: 400, headers: NO_STORE });
    console.error("[adminTasks] picture upload failed:", err);
    return Response.json({ ok: false, error: "Couldn't save the picture. Try again." }, { status: 500, headers: NO_STORE });
  }
}
