import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/page-header";
import { requireStoreContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Products · Stocktill" };

export default async function ProductsPage() {
  await requireStoreContext();
  return <ComingSoon title="Products" phase="phase 4" />;
}
