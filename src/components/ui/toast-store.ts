"use client";
import { create } from "zustand";

/* The toast store and the `toast` helpers, apart from the host that draws
   them (Toast.tsx). The host is the only thing that needs framer-motion. Push
   a toast by importing THIS file: Toast.tsx's re-export still brings the host,
   framer-motion and tailwind-merge into the importer's bundle (~42 KB gzip on
   the sign-up page, 2026-10-23). The root layout mounts the host
   lazily — toast-host-lazy.tsx — so pages that never toast never load it. */

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  kind: ToastKind;
}

interface ToastStore {
  items: ToastItem[];
  /** True from the first push on — the lazy host mounts on it and stays. */
  seen: boolean;
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  seen: false,
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items, { ...t, id }], seen: true }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "error", title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "info", title, description }),
};
