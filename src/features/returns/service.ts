import { checkAccess } from "@/features/billing/service";
import { isManager, type StoreRole } from "@/lib/permissions";
import { type Db, forbidden, ok, type Result } from "@/lib/services/result";
import type { ReturnInput } from "./schemas";

const MESSAGES: Record<string, string> = {
  forbidden: "Only owners and admins can register returns.",
  return_exceeds_sold: "You can't return more than what was sold minus what was already returned.",
  sale_not_found: "That sale doesn't exist.",
  sale_item_not_found: "One of the items doesn't belong to this sale.",
  invalid_items: "Check the items to return.",
  invalid_quantity: "Quantities must be whole numbers of at least 1.",
};

/**
 * Registers a return through create_return: the database validates the
 * quantities, computes the proportional refund, puts restocked units back in
 * stock (with a ledger movement) and updates the sale status, atomically.
 */
export async function createReturn(
  db: Db,
  actor: { storeId: string; role: StoreRole },
  input: ReturnInput,
): Promise<Result<string>> {
  const access = await checkAccess(db, actor.storeId, "sell");
  if (!access.ok) return access;
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db.rpc("create_return", {
    p_sale_id: input.saleId,
    p_items: input.items.map((i) => ({ sale_item_id: i.saleItemId, quantity: i.quantity, restock: i.restock })),
    ...(input.reason ? { p_reason: input.reason } : {}),
    p_refund_method: input.refundMethod,
  });
  if (error || !data) {
    const code = error?.message ?? "unknown";
    return { ok: false, error: MESSAGES[code] ?? "The return couldn't be registered. Nothing was changed.", code };
  }
  return ok(data);
}
