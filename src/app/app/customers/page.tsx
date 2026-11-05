import type { Metadata } from "next";
import { ComingSoon } from "@/components/app/page-header";
import { requireStoreContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Customers · Stocktill" };

export default async function CustomersPage() {
  await requireStoreContext();
  return <ComingSoon title="Customers" phase="phase 7" />;
}
