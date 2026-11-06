import { checkAccess } from "@/features/billing/service";
import { createHash } from "node:crypto";
import { isManager, type StoreRole } from "@/lib/permissions";
import { getProfileNames } from "@/lib/services/profiles";
import { type Db, fail, forbidden, ok, type Result } from "@/lib/services/result";
import { parseImportFile } from "./parse";
import { type ExistingProduct, type ImportSummary, type ValidatedRow, validateRows } from "./validate";

export type ImportActor = { userId: string; storeId: string; role: StoreRole };
export type UploadedFile = { name: string; bytes: Uint8Array };

export type ImportPreview = {
  fileName: string;
  /** SHA-256 of the file: the confirm step must receive exactly the same file. */
  fileHash: string;
  updateExisting: boolean;
  rows: ValidatedRow[];
  summary: ImportSummary;
  unknownColumns: string[];
};

export type ImportResult = {
  batchId: string;
  created: number;
  updated: number;
  skipped: number;
  stockEntryId: string | null;
};

const CHUNK = 150;

function hashFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Only the store's products whose SKU or barcode appear in the file (not the whole catalog). */
async function loadExisting(db: Db, storeId: string, skus: string[], barcodes: string[]): Promise<Result<ExistingProduct[]>> {
  const found = new Map<string, ExistingProduct>();
  const columns = "id, sku, barcode, name, category, sale_price, low_stock_threshold";
  const batches: ["sku" | "barcode", string[]][] = [];
  for (let i = 0; i < skus.length; i += CHUNK) batches.push(["sku", skus.slice(i, i + CHUNK)]);
  for (let i = 0; i < barcodes.length; i += CHUNK) batches.push(["barcode", barcodes.slice(i, i + CHUNK)]);
  for (const [column, values] of batches) {
    const { data, error } = await db
      .from("products")
      .select(columns)
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .in(column, values);
    if (error) return fail(error);
    for (const p of data ?? []) {
      found.set(p.id, {
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        category: p.category,
        salePrice: Number(p.sale_price),
        lowStockThreshold: p.low_stock_threshold,
      });
    }
  }
  return ok([...found.values()]);
}

/** Parses and validates the file. Saves nothing. */
export async function previewImport(
  db: Db,
  actor: ImportActor,
  file: UploadedFile,
  updateExisting: boolean,
): Promise<Result<ImportPreview>> {
  if (!isManager(actor.role)) return forbidden();
  const parsed = parseImportFile(file.name, file.bytes);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: "invalid_file" };

  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  const skus = [...new Set(parsed.data.rows.map((r) => text(r.values.sku)).filter(Boolean))];
  const barcodes = [...new Set(parsed.data.rows.map((r) => text(r.values.barcode)).filter(Boolean))];
  const existing = await loadExisting(db, actor.storeId, skus, barcodes);
  if (!existing.ok) return existing;

  const { rows, summary } = validateRows(parsed.data.rows, existing.data, { updateExisting });
  return ok({
    fileName: file.name,
    fileHash: hashFile(file.bytes),
    updateExisting,
    rows,
    summary,
    unknownColumns: parsed.data.unknownColumns,
  });
}

/**
 * Re-reads the SAME file (hash check), re-validates it against the current
 * database and saves the valid rows in one transaction (public.import_products).
 * Rows with errors are skipped and counted.
 */
export async function confirmImport(
  db: Db,
  actor: ImportActor,
  file: UploadedFile,
  expectedHash: string,
  updateExisting: boolean,
): Promise<Result<ImportResult>> {
  if (!isManager(actor.role)) return forbidden();
  const access = await checkAccess(db, actor.storeId, "edit");
  if (!access.ok) return access;
  if (hashFile(file.bytes) !== expectedHash) {
    return { ok: false, error: "The file changed after the preview. Preview it again before importing.", code: "file_changed" };
  }
  const preview = await previewImport(db, actor, file, updateExisting);
  if (!preview.ok) return preview;

  const valid = preview.data.rows.filter((r) => r.status !== "error" && r.data);
  if (valid.length === 0) return { ok: false, error: "There are no valid rows to import.", code: "nothing_to_import" };

  const { data: batchId, error } = await db.rpc("import_products", {
    p_store_id: actor.storeId,
    p_file_name: file.name.slice(0, 255),
    p_update_existing: updateExisting,
    p_total_rows: preview.data.summary.total,
    p_skipped_rows: preview.data.summary.error,
    p_rows: valid.map((r) => r.data),
  });
  if (error || !batchId) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error: "Some products changed since the preview (for example, a SKU or barcode is now taken). Preview the file again.",
        code: "conflict",
      };
    }
    return fail(error, "The import failed and nothing was saved. Please try again.");
  }

  const { data: batch, error: readError } = await db
    .from("import_batches")
    .select("id, created_count, updated_count, skipped_count, stock_entry_id")
    .eq("id", batchId)
    .single();
  if (readError) return fail(readError);
  return ok({
    batchId: batch.id,
    created: batch.created_count,
    updated: batch.updated_count,
    skipped: batch.skipped_count,
    stockEntryId: batch.stock_entry_id,
  });
}

export type ImportBatchSummary = {
  id: string;
  fileName: string;
  createdAt: string;
  createdBy: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  updateExisting: boolean;
  stockEntryId: string | null;
};

export async function listImports(db: Db, actor: ImportActor, limit = 10): Promise<Result<ImportBatchSummary[]>> {
  if (!isManager(actor.role)) return forbidden();
  const { data, error } = await db
    .from("import_batches")
    .select("id, file_name, created_at, created_by, total_rows, created_count, updated_count, skipped_count, update_existing, stock_entry_id")
    .eq("store_id", actor.storeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(error);
  const names = await getProfileNames(db, (data ?? []).map((b) => b.created_by));
  return ok(
    (data ?? []).map((b) => ({
      id: b.id,
      fileName: b.file_name,
      createdAt: b.created_at,
      createdBy: (b.created_by && names.get(b.created_by)) || "Former member",
      total: b.total_rows,
      created: b.created_count,
      updated: b.updated_count,
      skipped: b.skipped_count,
      updateExisting: b.update_existing,
      stockEntryId: b.stock_entry_id,
    })),
  );
}
