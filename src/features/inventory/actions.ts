"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { createClient } from "@/lib/supabase/server";
import { productSchema, stockEntrySchema } from "./schemas";
import {
  createProduct,
  createStockEntry,
  deleteProduct,
  findProductByCode,
  type InventoryActor,
  searchProducts,
  updateProduct,
} from "./service";

const PRODUCT_FIELDS = ["name", "sku", "barcode", "category", "salePrice", "lowStockThreshold", "active"];

async function managerActor(): Promise<InventoryActor> {
  const { user, store } = await requireRole(["owner", "admin"]);
  return { userId: user.id, storeId: store.storeId, role: store.role };
}

function duplicateFieldErrors(code: string | undefined): FormState["fieldErrors"] {
  if (code === "duplicate_sku") return { sku: ["Already used by another product."] };
  if (code === "duplicate_barcode") return { barcode: ["Already used by another product."] };
  return undefined;
}

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await managerActor();
  const values = formValues(formData, PRODUCT_FIELDS);
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await createProduct(await createClient(), actor, parsed.data);
  if (!result.ok) {
    return { status: "error", message: result.error, fieldErrors: duplicateFieldErrors(result.code), values };
  }
  revalidatePath("/app/products");
  redirect(`/app/products/${result.data}?created=1`);
}

export async function updateProductAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await managerActor();
  const values = formValues(formData, PRODUCT_FIELDS);
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await updateProduct(await createClient(), actor, productId, parsed.data);
  if (!result.ok) {
    return { status: "error", message: result.error, fieldErrors: duplicateFieldErrors(result.code), values };
  }
  revalidatePath("/app/products", "layout");
  return { status: "success", message: "Product saved.", values };
}

export async function deleteProductAction(productId: string): Promise<FormState> {
  const actor = await managerActor();
  const result = await deleteProduct(await createClient(), actor, productId);
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/app/products", "layout");
  redirect("/app/products?deleted=1");
}

/** What the stock-entry screen needs about a product (owner/admin only: includes cost). */
export type EntryProduct = { id: string; name: string; sku: string; barcode: string | null; stock: number; cost: number | null };

function toEntryProduct(p: { id: string; name: string; sku: string; barcode: string | null; stock: number; cost: number | null }): EntryProduct {
  return { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, stock: p.stock, cost: p.cost };
}

/** Exact barcode/SKU lookup used when a scanner (or the user) presses Enter. */
export async function lookupProductCode(code: string): Promise<EntryProduct | null> {
  const actor = await managerActor();
  const result = await findProductByCode(await createClient(), actor, String(code).slice(0, 64));
  return result.ok && result.data ? toEntryProduct(result.data) : null;
}

export async function searchProductsForEntry(text: string): Promise<EntryProduct[]> {
  const actor = await managerActor();
  const result = await searchProducts(await createClient(), actor, String(text).slice(0, 64));
  return result.ok ? result.data.map(toEntryProduct) : [];
}

export async function createStockEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await managerActor();
  const values = formValues(formData, ["supplier", "note"]);
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { status: "error", message: "The product list is invalid. Reload the page and try again.", values };
  }
  const parsed = stockEntrySchema.safeParse({
    supplier: String(formData.get("supplier") ?? ""),
    note: String(formData.get("note") ?? ""),
    lines,
  });
  if (!parsed.success) {
    const fieldErrors = zodFieldErrors(parsed.error);
    const message = parsed.error.issues.some((i) => i.path[0] === "lines")
      ? "Check the products: quantities must be whole numbers of at least 1 and costs can't be negative."
      : undefined;
    return { status: "error", fieldErrors, values, ...(message ? { message } : {}) };
  }

  const result = await createStockEntry(await createClient(), actor, parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };
  revalidatePath("/app/products", "layout");
  redirect(`/app/products/entries/${result.data}?created=1`);
}
