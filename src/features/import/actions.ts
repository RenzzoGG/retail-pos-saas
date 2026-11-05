"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { MAX_FILE_BYTES } from "./limits";
import { type ImportPreview, type ImportResult, type UploadedFile, confirmImport, previewImport } from "./service";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; preview: ImportPreview }
  | { status: "done"; result: ImportResult; fileName: string };

async function actorAndFile(formData: FormData): Promise<
  | { ok: true; actor: { userId: string; storeId: string; role: "owner" | "admin" | "cashier" }; file: UploadedFile }
  | { ok: false; message: string }
> {
  const { user, store } = await requireRole(["owner", "admin"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a .xlsx or .csv file." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: "The file is larger than 1 MB. Split it into smaller files." };
  return {
    ok: true,
    actor: { userId: user.id, storeId: store.storeId, role: store.role },
    file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
  };
}

/** Step 1: parse + validate. Nothing is saved and the file is not stored. */
export async function previewImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const input = await actorAndFile(formData);
  if (!input.ok) return { status: "error", message: input.message };
  const updateExisting = formData.get("updateExisting") === "on";
  const result = await previewImport(await createClient(), input.actor, input.file, updateExisting);
  if (!result.ok) return { status: "error", message: result.error };
  return { status: "preview", preview: result.data };
}

/** Step 2: the browser sends the same file again; it's re-validated and saved atomically. */
export async function confirmImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const input = await actorAndFile(formData);
  if (!input.ok) return { status: "error", message: input.message };
  const updateExisting = formData.get("updateExisting") === "on";
  const fileHash = String(formData.get("fileHash") ?? "");
  const result = await confirmImport(await createClient(), input.actor, input.file, fileHash, updateExisting);
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/app/products", "layout");
  return { status: "done", result: result.data, fileName: input.file.name };
}
