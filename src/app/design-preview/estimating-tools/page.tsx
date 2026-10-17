import { notFound } from "next/navigation";
import { EstimatingToolsPreview } from "@/components/v3/estimating-sidebar-variants/preview";

export default function EstimatingToolsDesignPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EstimatingToolsPreview />;
}
