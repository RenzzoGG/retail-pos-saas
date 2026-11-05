CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"update_existing" boolean DEFAULT false NOT NULL,
	"total_rows" integer NOT NULL,
	"created_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"stock_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_counts_valid" CHECK ("import_batches"."created_count" >= 0 and "import_batches"."updated_count" >= 0 and "import_batches"."skipped_count" >= 0
          and "import_batches"."created_count" + "import_batches"."updated_count" + "import_batches"."skipped_count" = "import_batches"."total_rows"),
	CONSTRAINT "import_batches_file_name_not_blank" CHECK (length(trim("import_batches"."file_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_entries" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_stock_entry_fk" FOREIGN KEY ("stock_entry_id","store_id") REFERENCES "public"."stock_entries"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_store_created_idx" ON "import_batches" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_source_valid" CHECK ("stock_entries"."source" in ('manual', 'import'));