"use server";

import { revalidatePath } from "next/cache";
import { requireStoreContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { checkoutSchema } from "./schemas";
import {
  type CheckoutError,
  type CustomerOption,
  type SaleDetail,
  type SaleProduct,
  completeSale,
  lookupForSale,
  searchCustomers,
  searchForSale,
} from "./service";

/** Any member can sell (cashiers included). */
async function sellerContext() {
  const { user, store } = await requireStoreContext();
  return { userId: user.id, storeId: store.storeId, role: store.role };
}

export async function lookupSaleProduct(code: string): Promise<SaleProduct | null> {
  const actor = await sellerContext();
  const result = await lookupForSale(await createClient(), actor.storeId, String(code).slice(0, 64));
  return result.ok ? result.data : null;
}

export async function searchSaleProducts(text: string): Promise<SaleProduct[]> {
  const actor = await sellerContext();
  const result = await searchForSale(await createClient(), actor.storeId, String(text).slice(0, 64));
  return result.ok ? result.data : [];
}

export async function searchSaleCustomers(text: string): Promise<CustomerOption[]> {
  const actor = await sellerContext();
  const result = await searchCustomers(await createClient(), actor.storeId, String(text).slice(0, 64));
  return result.ok ? result.data : [];
}

export type CheckoutResult = { ok: true; sale: SaleDetail } | { ok: false; error: CheckoutError };

/**
 * Validates the cart on the server (never trusts prices from the browser) and
 * registers it with create_sale. The idempotency key makes retries safe.
 */
export async function checkoutAction(input: unknown): Promise<CheckoutResult> {
  const actor = await sellerContext();
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Check the cart and payments." } };
  }
  const result = await completeSale(await createClient(), actor, parsed.data);
  if (result.ok) {
    revalidatePath("/app/sales");
    revalidatePath("/app/products");
  }
  return result;
}
