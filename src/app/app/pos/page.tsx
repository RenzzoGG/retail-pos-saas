import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/page-header";
import { requireStoreContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Sales / POS · Stocktill" };

export default async function PosPage() {
  await requireStoreContext();
  return <ComingSoon title="Sales / POS" phase="phase 6" />;
}
