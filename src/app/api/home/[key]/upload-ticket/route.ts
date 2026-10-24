import { NextResponse } from "next/server";
import { FOLDER_TYPES, folderCap, folderDoor, folderFullWords, folderPathname } from "@/lib/home/files";
import { MAX_FILE_BYTES, fileSize } from "@/lib/jobMediaShared";
import { safePathname, storageMode } from "@/lib/media/privateStore";
import { uploadTicket } from "@/lib/media/signedLink";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// WHERE A HOMEOWNER'S FILE GOES (2026-10-03, lib/home/files). The browser asks
// before anything moves: the key must open the home, the request must be on
// it (or the request was just sent from the wizard — lib/home/freshRequest), the file must be a picture, a video or a
// PDF, at most 100 MB, and the folder not full. The answer names the path and the way — the private Blob
// store, this machine's disk in development, or "inline" on Vercel before
// the store exists (then only a small picture, as a data URL).
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  let body: { token?: string; name?: string; contentType?: string; bytes?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.token) return NextResponse.json({ error: "Which project?" }, { status: 400 });
  const door = await folderDoor(key, body.token);
  if (!door) return NextResponse.json({ error: "This link is not valid." }, { status: 403 });
  const type = (body.contentType ?? "").toLowerCase();
  if (!FOLDER_TYPES.includes(type)) return NextResponse.json({ error: "Pictures, videos and PDFs only." }, { status: 415 });
  const bytes = Number(body.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  if (bytes > MAX_FILE_BYTES) return NextResponse.json({ error: `That file is larger than ${fileSize(MAX_FILE_BYTES)} — send a shorter video or a smaller picture.` }, { status: 413 });
  const count = await db.homeFile.count({ where: { platformLeadId: door.lead.id, deletedAt: null } });
  const cap = folderCap(key);
  if (count >= cap) return NextResponse.json({ error: folderFullWords(cap) }, { status: 409 });

  const mode = storageMode();
  const pathname = safePathname(folderPathname(door.home.id, door.lead.id, body.name, type));
  if (mode === "blob") return NextResponse.json({ mode, pathname });
  if (mode === "local") {
    const ticket = uploadTicket(pathname, type, Math.min(MAX_FILE_BYTES, Math.ceil(bytes * 1.01) + 1024));
    return NextResponse.json({ mode, pathname, uploadUrl: `/api/crew/upload-local?ticket=${encodeURIComponent(ticket)}` });
  }
  return NextResponse.json({ mode });
}
