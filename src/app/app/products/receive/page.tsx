import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { StockEntryForm } from "@/features/inventory/components/stock-entry-form";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { getProduct } from "@/features/inventory/service";
import { getActiveStore } from "@/features/stores/queries";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Receive stock · Stocktill" };

export default async function ReceiveStockPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product: productId } = await searchParams;
  const { user, store } = await requireRole(["owner", "admin"]);
  const { settings } = await getActiveStore();
  let initial = null;
  if (productId && /^[0-9a-f-]{36}$/i.test(productId)) {
    const found = await getProduct(await createClient(), { userId: user.id, storeId: store.storeId, role: store.role }, productId);
    if (found.ok && found.data) {
      const p = found.data;
      initial = { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, stock: p.stock, cost: p.cost };
    }
  }
  return (
    <>
      <PageHeader
        title="Receive stock"
        description="Add merchandise to your stock. Each product's cost becomes the weighted average of what you paid."
      />
      <ProductsTabs current="receive" />
      <Card>
        <StockEntryForm currency={settings.currency} initialProduct={initial} />
      </Card>
    </>
  );
}
