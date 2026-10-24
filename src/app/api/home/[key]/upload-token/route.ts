import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { FOLDER_TYPES, folderDoor } from "@/lib/home/files";
import { MAX_FILE_BYTES } from "@/lib/jobMediaShared";
import { privateToken } from "@/lib/media/privateStore";

export const runtime = "nodejs";

// STRAIGHT FROM THE HOMEOWNER'S PHONE TO THE PRIVATE STORE (2026-10-03). A
// video does not fit through a request body (Vercel caps it at 4.5 MB), so
// the browser asks here for a short-lived upload token, sends the file to the
// private Blob store itself, then records it (actions/homeFiles
// registerHomeFile). A token is handed out only for a request on the home the
// key opens (or the request just sent from the wizard — lib/home/freshRequest), under that request's own folder, for a picture, a video or a
// PDF up to 100 MB.
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const token = privateToken();
  if (!token) return NextResponse.json({ error: "File storage is not set up on this server." }, { status: 503 });
  const { key } = await ctx.params;
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: { token?: string } = {};
        try {
          payload = JSON.parse(clientPayload ?? "{}") as typeof payload;
        } catch {
          payload = {};
        }
        if (!payload.token) throw new Error("Which project?");
        const door = await folderDoor(key, payload.token);
        if (!door) throw new Error("Not authorized");
        if (!pathname.startsWith(`home/${door.home.id}/${door.lead.id}/`)) throw new Error("Wrong folder");
        return {
          allowedContentTypes: [...FOLDER_TYPES],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 30 * 60_000,
          tokenPayload: JSON.stringify({ homeId: door.home.id, leadId: door.lead.id }),
        };
      },
      // The browser records the file the moment its upload completes; this
      // callback (a webhook from the store) is not relied on.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload refused";
    return NextResponse.json({ error: message }, { status: message === "Not authorized" ? 403 : 400 });
  }
}
