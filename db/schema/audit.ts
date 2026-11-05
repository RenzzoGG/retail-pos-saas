import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared";
import { activityAction } from "./enums";

/** Append-only audit trail written by the app.log_activity() trigger. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // No FKs on purpose: the log is immutable (UPDATE/DELETE blocked by trigger),
    // so it must outlive deleted stores/users instead of being nulled or cascaded.
    storeId: uuid("store_id"),
    /** Null when the change was made by the server (service role) or a migration. */
    actorId: uuid("actor_id"),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    action: activityAction("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_log_store_created_idx").on(t.storeId, t.createdAt),
    index("activity_log_record_idx").on(t.tableName, t.recordId),
  ],
);
