"use client";
import type { RevenueReport } from "@/lib/revenue-contract";
import { RevenueView } from "./revenue-content";
export default function RevenueMobile({ data }: { data: RevenueReport }) { return <RevenueView data={data} mobile />; }
