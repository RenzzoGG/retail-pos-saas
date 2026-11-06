ALTER TABLE "subscriptions" ALTER COLUMN "stripe_customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_at" timestamp with time zone;