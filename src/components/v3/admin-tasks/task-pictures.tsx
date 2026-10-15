"use client";

// ADMIN · TASKS — a task's pictures (owner, 2026-10-15: "upload the pictures"). A strip of thumbnails in the sheet;
// "Add pictures" takes several at once (a phone offers its camera too), each shrunk to 1800 px JPEG in the browser
// (lib/media/uploadJobMedia shrinkPhoto) and sent to /api/admin/tasks/<id>/pictures one at a time. A thumbnail opens
// the full picture — arrows and Esc on a desk, tap on a phone. The links are short-lived and signed: the sheet's live
// copy brings fresh ones.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { shrinkPhoto } from "@/lib/media/uploadJobMedia";
import { removeAdminTaskPicture } from "@/actions/adminTasks";
import type { PictureDTO, TaskDetailDTO } from "@/lib/adminTasks/model";
import type { TaskStore } from "./use-task-store";
import { cx } from "./task-bits";

export const PICTURES_PER_TASK = 24;

/** One picture up: shrunk, sent, the task back in full. */
export async function uploadTaskPicture(taskId: string, file: File): Promise<{ ok: true; task: TaskDetailDTO } | { ok: false; error: string }> {
  let blob: Blob = file;
  let type = file.type;
  let name = file.name;
  try {
    const small = await shrinkPhoto(file);
    blob = small.blob;
    type = small.type;
    name = small.name;
  } catch {
    /* sent as it is */
  }
  const fd = new FormData();
  fd.append("file", new File([blob], name || "picture.jpg", { type: type || "image/jpeg" }));
  try {
    const res = await fetch(`/api/admin/tasks/${encodeURIComponent(taskId)}/pictures`, { method: "POST", body: fd });
    const j = (await res.json().catch(() => null)) as { ok: boolean; task?: TaskDetailDTO; error?: string } | null;
    if (!j) return { ok: false, error: res.status === 401 ? "Sign in to the admin console again." : "The upload failed — try again." };
    return j.ok && j.task ? { ok: true, task: j.task } : { ok: false, error: j.error ?? "The upload failed — try again." };
  } catch {
    return { ok: false, error: "No connection — the picture wasn't uploaded." };
  }
}

/** Several pictures, one after another; the sheet follows each. */
export async function uploadTaskPictures(taskId: string, files: File[], onTask: (t: TaskDetailDTO) => void, onProgress?: (done: number, total: number) => void): Promise<string | null> {
  let firstError: string | null = null;
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length);
    const r = await uploadTaskPicture(taskId, files[i]);
    if (r.ok) onTask(r.task);
    else if (!firstError) firstError = r.error;
  }
  onProgress?.(files.length, files.length);
  return firstError;
}

function Lightbox({ pics, index, onIndex, onClose }: { pics: PictureDTO[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const pic = pics[index];
  const go = useCallback((by: number) => onIndex((index + by + pics.length) % pics.length), [index, onIndex, pics.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose]);
  if (!pic || typeof document === "undefined") return null;
  // At the page's root: the sheet slides in with a transform, which would trap a fixed overlay inside it.
  return createPortal(
    <div className={cx("lightbox")} role="dialog" aria-modal="true" aria-label={`Picture ${index + 1} of ${pics.length}`} onClick={onClose} data-task-lightbox>
      <button type="button" className={cx("lbClose")} onClick={onClose} aria-label="Close">
        <X size={22} aria-hidden />
      </button>
      {pics.length > 1 ? (
        <button
          type="button"
          className={cx("lbNav", "lbPrev")}
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Previous picture"
        >
          <ChevronLeft size={28} aria-hidden />
        </button>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link; next/image would cache it */}
      <img className={cx("lbImg")} src={pic.href} alt={pic.name} onClick={(e) => e.stopPropagation()} />
      {pics.length > 1 ? (
        <button
          type="button"
          className={cx("lbNav", "lbNext")}
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Next picture"
        >
          <ChevronRight size={28} aria-hidden />
        </button>
      ) : null}
      <div className={cx("lbCap")}>
        {index + 1} / {pics.length} · {pic.byName}
      </div>
    </div>,
    document.body,
  );
}

export function TaskPictures({ task, store }: { task: TaskDetailDTO; store: TaskStore }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const pics = task.photos;
  const room = PICTURES_PER_TASK - pics.length;

  const add = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (input.current) input.current.value = "";
    if (!files.length) return;
    const take = files.slice(0, Math.max(0, room));
    if (take.length < files.length) toast.error("Too many pictures", `A task holds ${PICTURES_PER_TASK}; ${files.length - take.length} left out.`);
    if (!take.length) return;
    setBusy({ done: 0, total: take.length });
    const err = await uploadTaskPictures(task.id, take, (t) => store.ingestDetail(t), (done, total) => setBusy({ done, total }));
    setBusy(null);
    if (err) toast.error("Not every picture went up", err);
  };

  const remove = async (pic: PictureDTO) => {
    setRemoving(pic.id);
    const r = await removeAdminTaskPicture(task.id, pic.id);
    setRemoving(null);
    if (r.ok) {
      store.ingestDetail(r.task);
      setView(null);
    } else toast.error("Not removed", r.error);
  };

  return (
    <section className={cx("sec")} data-task-pictures>
      <div className={cx("sec-h")}>
        <span className={cx("sec-t")}>Pictures</span>
        <span className={cx("sec-m")}>{busy ? `Uploading ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…` : pics.length ? `${pics.length}` : "None yet"}</span>
      </div>
      <div className={cx("pics")}>
        {pics.map((p, i) => (
          <div key={p.id} className={cx("pic")} data-picture={p.id}>
            <button type="button" className={cx("picOpen")} onClick={() => setView(i)} aria-label={`Open picture ${i + 1}: ${p.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link */}
              <img src={p.href} alt={p.name} loading="lazy" />
            </button>
            <button type="button" className={cx("picDel")} onClick={() => void remove(p)} disabled={removing === p.id} aria-label={`Remove picture ${i + 1}`} title="Remove">
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
        {room > 0 ? (
          <button type="button" className={cx("picAdd")} onClick={() => input.current?.click()} disabled={!!busy} data-picture-add>
            {busy ? <Camera size={20} aria-hidden /> : <ImagePlus size={20} aria-hidden />}
            <span>{busy ? "Uploading…" : "Add pictures"}</span>
          </button>
        ) : null}
      </div>
      <input ref={input} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => void add(e.target.files)} data-picture-input />
      {view !== null && pics.length ? <Lightbox pics={pics} index={Math.min(view, pics.length - 1)} onIndex={setView} onClose={() => setView(null)} /> : null}
    </section>
  );
}
