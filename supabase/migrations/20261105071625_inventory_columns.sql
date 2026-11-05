ALTER TABLE "stores" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_low_stock" boolean GENERATED ALWAYS AS (stock <= low_stock_threshold) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "products_store_low_stock_idx" ON "products" USING btree ("store_id","is_low_stock");