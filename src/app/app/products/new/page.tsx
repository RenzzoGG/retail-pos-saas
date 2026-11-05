import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { createProductAction } from "@/features/inventory/actions";
import { ProductForm } from "@/features/inventory/components/product-form";
import { ProductsTabs } from "@/features/inventory/components/products-tabs";
import { listCategories } from "@/features/inventory/service";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New product · Stocktill" };

export default async function NewProductPage() {
  const { store } = await requireRole(["owner", "admin"]);
  const categories = await listCategories(await createClient(), store.storeId);
  return (
    <>
      <PageHeader title="New product" description="Stock starts at 0: add it with “Receive stock”." />
      <ProductsTabs current="catalog" />
      <Card>
        <ProductForm
          action={createProductAction}
          categories={categories}
          submitLabel="Create product"
          defaults={{ name: "", sku: "", barcode: "", category: "", salePrice: "", lowStockThreshold: "5", active: true }}
        />
      </Card>
    </>
  );
}
