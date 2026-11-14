"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACTIVE_STORE_COOKIE,
  activeStoreCookieOptions,
  getMemberships,
  requireRole,
  requireUser,
} from "@/lib/auth/dal";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { createClient } from "@/lib/supabase/server";
import { idempotencyKeySchema, storeSettingsSchema } from "./schemas";
import { createStore, updateStoreSettings } from "./service";

const FIELDS = ["name", "currency", "taxRatePercent", "pricesIncludeTax", "timezone", "cashierDiscountLimit", "ticketFooter"];

export async function createStoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const values = formValues(formData, FIELDS);
  const parsed = storeSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  const key = idempotencyKeySchema.safeParse(formData.get("idempotencyKey"));
  if (!key.success) return { status: "error", message: "Please reload the page and try again.", values };

  const result = await createStore(await createClient(), parsed.data, key.data);
  if (!result.ok) return { status: "error", message: result.error, values };

  (await cookies()).set(ACTIVE_STORE_COOKIE, result.data, activeStoreCookieOptions());
  // Not redirect("/app"): if this browser visited /app before having a store
  // (e.g. right after signing in), the client router cached /app as "redirect
  // to /onboarding" and a client-side redirect replays it, so the user landed
  // back on onboarding. The form opens /app with a full page load instead
  // (withDocumentRedirect), which starts from a fresh router.
  return { status: "success", redirectTo: "/app" };
}

/** Remembers the chosen store, but only if the user really is a member of it. */
export async function switchStoreAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get("storeId") ?? "");
  const memberships = await getMemberships();
  if (memberships.some((m) => m.storeId === storeId)) {
    (await cookies()).set(ACTIVE_STORE_COOKIE, storeId, activeStoreCookieOptions());
  }
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function updateStoreSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { store } = await requireRole(["owner", "admin"]);
  const values = formValues(formData, FIELDS);
  const parsed = storeSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await updateStoreSettings(await createClient(), store, parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };

  revalidatePath("/app", "layout");
  return { status: "success", message: "Store settings saved.", values };
}
