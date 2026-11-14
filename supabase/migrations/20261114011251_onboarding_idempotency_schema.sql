ALTER TABLE "stores" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_creator_idempotency_key" UNIQUE("created_by","idempotency_key");