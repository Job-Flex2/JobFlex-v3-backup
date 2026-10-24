"use client";
// THE WIZARD'S PHOTOS, SENT FOR REAL (2026-10-23). Until now the picker played a progress bar and nothing left the
// browser, so it was hidden. Now the files are only listed while the homeowner writes; once the request is sent, each
// one goes into that request's job folder (lib/home/uploadClient, through the request-just-sent door of
// lib/home/freshRequest) — where the contractor who takes the project sees it, and Deck Studio can build the house
// from a back-wall photo. Both wizards (desktop and phone) use this.

import { useCallback, useRef, useState } from "react";
import { uploadHomeFile } from "@/lib/home/uploadClient";
import { FRESH_REQUEST_KEY, WIZARD_MAX_FILES } from "@/lib/home/freshRequest";

export type AttachmentKind = "photo" | "video" | "pdf";
export type AttachmentState = "ready" | "sending" | "sent" | "failed";

export interface Attachment {
  id: number;
  file: File;
  /** Shortened for the chip. */
  name: string;
  kind: AttachmentKind;
  state: AttachmentState;
  progress: number;
  error?: string;
}

const kindOf = (f: File): AttachmentKind => (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name) ? "video" : "photo");
const shortName = (n: string) => (n.length > 22 ? n.slice(0, 19) + "…" : n || "file");

export interface RequestAttachments {
  items: Attachment[];
  add: (list: FileList | File[]) => void;
  remove: (id: number) => void;
  clear: () => void;
  /** Every file into the request's folder, one after another; the shop hears once, with the last. */
  send: (requestToken: string) => Promise<void>;
  /** How the sending stands, for the Done screen. */
  sent: number;
  failed: number;
  sending: boolean;
}

export function useRequestAttachments(onChange?: () => void): RequestAttachments {
  const [items, setItems] = useState<Attachment[]>([]);
  const ref = useRef<Attachment[]>([]);
  const nextId = useRef(1);
  const put = useCallback(
    (next: Attachment[]) => {
      ref.current = next;
      setItems(next);
      onChange?.();
    },
    [onChange],
  );
  const patch = useCallback((id: number, p: Partial<Attachment>) => put(ref.current.map((a) => (a.id === id ? { ...a, ...p } : a))), [put]);

  const add = useCallback(
    (list: FileList | File[]) => {
      const have = new Set(ref.current.map((a) => `${a.file.name}:${a.file.size}`));
      const next = [...ref.current];
      for (const f of Array.from(list)) {
        if (next.length >= WIZARD_MAX_FILES) break;
        const k = `${f.name}:${f.size}`;
        if (have.has(k)) continue;
        have.add(k);
        next.push({ id: nextId.current++, file: f, name: shortName(f.name), kind: kindOf(f), state: "ready", progress: 0 });
      }
      put(next);
    },
    [put],
  );
  const remove = useCallback((id: number) => put(ref.current.filter((a) => a.id !== id || a.state === "sending")), [put]);
  const clear = useCallback(() => put([]), [put]);

  const send = useCallback(
    async (requestToken: string) => {
      const todo = ref.current.filter((a) => a.state === "ready" || a.state === "failed");
      for (let i = 0; i < todo.length; i++) {
        const a = todo[i];
        patch(a.id, { state: "sending", progress: 1, error: undefined });
        try {
          const res = await uploadHomeFile({
            homeKey: FRESH_REQUEST_KEY,
            token: requestToken,
            file: a.file,
            note: null,
            notify: i === todo.length - 1 ? { count: todo.length } : null,
            onProgress: (pct) => patch(a.id, { progress: pct }),
          });
          if (res.ok) patch(a.id, { state: "sent", progress: 100 });
          else patch(a.id, { state: "failed", error: res.error });
        } catch (err) {
          patch(a.id, { state: "failed", error: err instanceof Error && err.message ? err.message : "It didn't go through." });
        }
      }
    },
    [patch],
  );

  return {
    items,
    add,
    remove,
    clear,
    send,
    sent: items.filter((a) => a.state === "sent").length,
    failed: items.filter((a) => a.state === "failed").length,
    sending: items.some((a) => a.state === "sending"),
  };
}

/** The Done screen's line about the files. */
export function attachmentsLine(a: Pick<RequestAttachments, "items" | "sent" | "failed" | "sending">): string | null {
  const n = a.items.length;
  if (!n) return null;
  const what = (k: number) => `${k} file${k === 1 ? "" : "s"}`;
  if (a.sending) return `Sending your ${what(n)} — ${a.sent} of ${n} in the project's folder…`;
  if (a.failed && a.sent) return `${what(a.sent)} in the project's folder; ${what(a.failed)} didn't go — add ${a.failed === 1 ? "it" : "them"} from your home dashboard (the link is in your email).`;
  if (a.failed) return `Your ${what(n)} didn't go — add ${n === 1 ? "it" : "them"} from your home dashboard (the link is in your email).`;
  return `Your ${what(n)} ${n === 1 ? "is" : "are"} in the project's folder — the contractor who takes it sees ${n === 1 ? "it" : "them"}.`;
}
