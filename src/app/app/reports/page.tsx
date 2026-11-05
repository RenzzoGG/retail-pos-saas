import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/page-header";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Reports · Stocktill" };

export default async function ReportsPage() {
  await requireRole(["owner", "admin"]);
  return <ComingSoon title="Reports" phase="phase 8" />;
}
