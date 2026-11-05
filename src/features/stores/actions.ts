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
import { storeSettingsSchema } from "./schemas";
import { createStore, updateStoreSettings } from "./service";

const FIELDS = ["name", "currency", "taxRatePercent", "pricesIncludeTax"];

export async function createStoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const values = formValues(formData, FIELDS);
  const parsed = storeSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };

  const result = await createStore(await createClient(), parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };

  (await cookies()).set(ACTIVE_STORE_COOKIE, result.data, activeStoreCookieOptions());
  redirect("/app");
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
