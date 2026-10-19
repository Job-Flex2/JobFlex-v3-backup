import type { ReactNode } from "react";
import { SmoothWheel } from "@/components/v3/landing-e/smooth-wheel";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <>{children}<SmoothWheel /></>;
}
