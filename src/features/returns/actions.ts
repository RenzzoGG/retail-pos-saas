"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { returnSchema } from "./schemas";
import { createReturn } from "./service";

export type ReturnActionResult = { ok: true; returnId: string } | { ok: false; message: string };

/** Owner/admin only (checked here and again by create_return in the database). */
export async function createReturnAction(input: unknown): Promise<ReturnActionResult> {
  const { store } = await requireRole(["owner", "admin"]);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the return." };
  const result = await createReturn(await createClient(), { storeId: store.storeId, role: store.role }, parsed.data);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath(`/app/sales/${parsed.data.saleId}`);
  revalidatePath("/app/sales");
  revalidatePath("/app/products", "layout");
  revalidatePath("/app/customers", "layout");
  return { ok: true, returnId: result.data };
}
