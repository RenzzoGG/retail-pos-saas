"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CustomerOption } from "@/features/pos/service";
import { requireRole, requireStoreContext } from "@/lib/auth/dal";
import { type FormState, formValues, zodFieldErrors } from "@/lib/forms/state";
import { createClient } from "@/lib/supabase/server";
import { customerSchema } from "./schemas";
import { createCustomer, deleteCustomer, updateCustomer } from "./service";

const FIELDS = ["name", "documentId", "phone", "email", "notes"];

async function memberActor() {
  const { store } = await requireStoreContext();
  return { storeId: store.storeId, role: store.role };
}

export async function createCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await memberActor();
  const values = formValues(formData, FIELDS);
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  const result = await createCustomer(await createClient(), actor, parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };
  revalidatePath("/app/customers");
  redirect(`/app/customers/${result.data.id}?created=1`);
}

export async function updateCustomerAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await memberActor();
  const values = formValues(formData, FIELDS);
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", fieldErrors: zodFieldErrors(parsed.error), values };
  const result = await updateCustomer(await createClient(), actor, id, parsed.data);
  if (!result.ok) return { status: "error", message: result.error, values };
  revalidatePath(`/app/customers/${id}`);
  revalidatePath("/app/customers");
  return { status: "success", message: "Customer saved.", values };
}

export async function deleteCustomerAction(id: string): Promise<FormState> {
  const { store } = await requireRole(["owner", "admin"]);
  const result = await deleteCustomer(await createClient(), { storeId: store.storeId, role: store.role }, id);
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/app/customers");
  redirect(`/app/customers?removed=${result.data}`);
}

export type QuickCustomerResult = { ok: true; customer: CustomerOption } | { ok: false; message: string; fieldErrors?: FormState["fieldErrors"] };

/** From the POS: create a customer without leaving the sale. */
export async function quickCreateCustomer(input: { name: string; phone: string; email: string }): Promise<QuickCustomerResult> {
  const actor = await memberActor();
  const parsed = customerSchema.safeParse({ ...input, documentId: "", notes: "" });
  if (!parsed.success) return { ok: false, message: "Check the customer's details.", fieldErrors: zodFieldErrors(parsed.error) };
  const result = await createCustomer(await createClient(), actor, parsed.data);
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/app/customers");
  const c = result.data;
  return { ok: true, customer: { id: c.id, name: c.name, detail: c.documentId || c.phone || c.email || null } };
}
