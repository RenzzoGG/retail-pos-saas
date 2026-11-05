CREATE TYPE "public"."activity_action" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('completed', 'partially_returned', 'returned');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('sale', 'return', 'entry');--> statement-breakpoint
CREATE TYPE "public"."store_role" AS ENUM('owner', 'admin', 'cashier');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "store_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_not_owner" CHECK ("invitations"."role" <> 'owner'),
	CONSTRAINT "invitations_email_lowercase" CHECK ("invitations"."email" = lower("invitations"."email") and position('@' in "invitations"."email") > 1)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "store_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_user_key" UNIQUE("store_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"ticket_footer" text,
	"last_sale_number" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_name_not_blank" CHECK (length(trim("stores"."name")) > 0),
	CONSTRAINT "stores_slug_format" CHECK ("stores"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "stores_currency_iso" CHECK ("stores"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "stores_tax_rate_range" CHECK ("stores"."tax_rate" >= 0 and "stores"."tax_rate" < 1),
	CONSTRAINT "stores_last_sale_number_nonneg" CHECK ("stores"."last_sale_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_costs" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_costs_cost_nonneg" CHECK ("product_costs"."cost_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"category" text,
	"sale_price" numeric(12, 2) NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_store_id_key" UNIQUE("id","store_id"),
	CONSTRAINT "products_stock_nonneg" CHECK ("products"."stock" >= 0),
	CONSTRAINT "products_sale_price_nonneg" CHECK ("products"."sale_price" >= 0),
	CONSTRAINT "products_low_stock_threshold_nonneg" CHECK ("products"."low_stock_threshold" >= 0),
	CONSTRAINT "products_sku_not_blank" CHECK (length(trim("products"."sku")) > 0),
	CONSTRAINT "products_name_not_blank" CHECK (length(trim("products"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"supplier" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_entries_id_store_id_key" UNIQUE("id","store_id")
);
--> statement-breakpoint
CREATE TABLE "stock_entry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	CONSTRAINT "stock_entry_items_quantity_pos" CHECK ("stock_entry_items"."quantity" > 0),
	CONSTRAINT "stock_entry_items_unit_cost_nonneg" CHECK ("stock_entry_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"ref_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_stock_after_nonneg" CHECK ("stock_movements"."stock_after" >= 0),
	CONSTRAINT "stock_movements_sign_matches_type" CHECK (("stock_movements"."type" = 'sale' and "stock_movements"."quantity" < 0) or ("stock_movements"."type" in ('return', 'entry') and "stock_movements"."quantity" > 0))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document_id" text,
	"phone" text,
	"email" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_id_store_id_key" UNIQUE("id","store_id"),
	CONSTRAINT "customers_name_not_blank" CHECK (length(trim("customers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"refund_amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "return_items_quantity_pos" CHECK ("return_items"."quantity" > 0),
	CONSTRAINT "return_items_refund_nonneg" CHECK ("return_items"."refund_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"reason" text,
	"refund_total" numeric(12, 2) NOT NULL,
	"refund_method" "payment_method" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_id_store_id_key" UNIQUE("id","store_id"),
	CONSTRAINT "returns_refund_total_nonneg" CHECK ("returns"."refund_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_item_costs" (
	"sale_item_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	CONSTRAINT "sale_item_costs_unit_cost_nonneg" CHECK ("sale_item_costs"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"sku" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "sale_items_id_store_id_key" UNIQUE("id","store_id"),
	CONSTRAINT "sale_items_quantity_pos" CHECK ("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_amounts_nonneg" CHECK ("sale_items"."unit_price" >= 0 and "sale_items"."discount" >= 0 and "sale_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"tendered" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_amount_pos" CHECK ("sale_payments"."amount" > 0),
	CONSTRAINT "sale_payments_tendered_valid" CHECK ("sale_payments"."tendered" is null or ("sale_payments"."method" = 'cash' and "sale_payments"."tendered" >= "sale_payments"."amount"))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"cashier_id" uuid,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"prices_include_tax" boolean NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" "sale_status" DEFAULT 'completed' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_id_store_id_key" UNIQUE("id","store_id"),
	CONSTRAINT "sales_store_number_key" UNIQUE("store_id","number"),
	CONSTRAINT "sales_store_idempotency_key" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "sales_number_pos" CHECK ("sales"."number" > 0),
	CONSTRAINT "sales_amounts_nonneg" CHECK ("sales"."subtotal" >= 0 and "sales"."discount_total" >= 0 and "sales"."tax_total" >= 0 and "sales"."total" >= 0),
	CONSTRAINT "sales_discount_le_subtotal" CHECK ("sales"."discount_total" <= "sales"."subtotal")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid,
	"actor_id" uuid,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"action" "activity_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" "subscription_status" NOT NULL,
	"price_id" text,
	"trial_end" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_product_fk" FOREIGN KEY ("product_id","store_id") REFERENCES "public"."products"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_entry_fk" FOREIGN KEY ("entry_id","store_id") REFERENCES "public"."stock_entries"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_product_fk" FOREIGN KEY ("product_id","store_id") REFERENCES "public"."products"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_fk" FOREIGN KEY ("product_id","store_id") REFERENCES "public"."products"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_fk" FOREIGN KEY ("return_id","store_id") REFERENCES "public"."returns"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_sale_item_fk" FOREIGN KEY ("sale_item_id","store_id") REFERENCES "public"."sale_items"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_fk" FOREIGN KEY ("sale_id","store_id") REFERENCES "public"."sales"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item_costs" ADD CONSTRAINT "sale_item_costs_sale_item_fk" FOREIGN KEY ("sale_item_id","store_id") REFERENCES "public"."sale_items"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_fk" FOREIGN KEY ("sale_id","store_id") REFERENCES "public"."sales"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_fk" FOREIGN KEY ("product_id","store_id") REFERENCES "public"."products"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_fk" FOREIGN KEY ("sale_id","store_id") REFERENCES "public"."sales"("id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_fk" FOREIGN KEY ("customer_id","store_id") REFERENCES "public"."customers"("id","store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_store_id_idx" ON "invitations" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_members_user_id_idx" ON "store_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "product_costs_store_id_idx" ON "product_costs" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_sku_key" ON "products" USING btree ("store_id","sku") WHERE "products"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_barcode_key" ON "products" USING btree ("store_id","barcode") WHERE "products"."deleted_at" is null and "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "products_store_name_idx" ON "products" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "stock_entries_store_created_idx" ON "stock_entries" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_entry_items_entry_id_idx" ON "stock_entry_items" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "stock_entry_items_store_product_idx" ON "stock_entry_items" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_store_created_idx" ON "stock_movements" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_store_product_idx" ON "stock_movements" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "customers_store_name_idx" ON "customers" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "return_items_return_id_idx" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_items_sale_item_id_idx" ON "return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX "returns_store_created_idx" ON "returns" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "returns_sale_id_idx" ON "returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_item_costs_store_id_idx" ON "sale_item_costs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_store_product_idx" ON "sale_items" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_store_created_idx" ON "sale_payments" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_store_created_idx" ON "sales" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_store_customer_idx" ON "sales" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "activity_log_store_created_idx" ON "activity_log" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_record_idx" ON "activity_log" USING btree ("table_name","record_id");