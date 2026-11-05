ALTER TABLE "customers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_items" ADD COLUMN "restocked" boolean DEFAULT true NOT NULL;