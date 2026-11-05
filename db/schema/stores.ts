import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { createdAt, id, updatedAt } from "./_shared";
import { storeRole } from "./enums";

export const stores = pgTable(
  "stores",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** ISO 4217 code, e.g. USD. */
    currency: text("currency").notNull().default("USD"),
    /** e.g. 0.0825 = 8.25 %. */
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
    /** IANA time zone (e.g. America/New_York): dates, filters and daily reports use it. */
    timezone: text("timezone").notNull().default("UTC"),
    /** Max total discount a cashier may give, as % of the sale's gross amount (owner/admin: no limit). */
    maxCashierDiscountPct: numeric("max_cashier_discount_pct", { precision: 5, scale: 2 }).notNull().default("10"),
    ticketFooter: text("ticket_footer"),
    /** Per-store sale counter; only changed by public.create_sale(). */
    lastSaleNumber: integer("last_sale_number").notNull().default(0),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("stores_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("stores_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("stores_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("stores_tax_rate_range", sql`${t.taxRate} >= 0 and ${t.taxRate} < 1`),
    check("stores_last_sale_number_nonneg", sql`${t.lastSaleNumber} >= 0`),
    check(
      "stores_max_cashier_discount_range",
      sql`${t.maxCashierDiscountPct} >= 0 and ${t.maxCashierDiscountPct} <= 100`,
    ),
  ],
);

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  /** Copied from auth.users by trigger so teammates can see it (auth.users is not exposed). */
  email: text("email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storeMembers = pgTable(
  "store_members",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: storeRole("role").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("store_members_store_user_key").on(t.storeId, t.userId),
    index("store_members_user_id_idx").on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: storeRole("role").notNull(),
    /** SHA-256 of the invitation token; the raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("invitations_role_not_owner", sql`${t.role} <> 'owner'`),
    check("invitations_email_lowercase", sql`${t.email} = lower(${t.email}) and position('@' in ${t.email}) > 1`),
    index("invitations_store_id_idx").on(t.storeId),
    // At most one pending invitation per email and store (resending replaces it).
    uniqueIndex("invitations_store_email_pending_key")
      .on(t.storeId, t.email)
      .where(sql`${t.acceptedAt} is null`),
  ],
);
