/**
 * Demo data from supabase/seed.sql, shared by integration and E2E tests.
 * The password is the documented LOCAL-ONLY demo password (see README).
 */
export const DEMO_PASSWORD = "stocktill-demo";
export const DEMO_STORE_ID = "b0000000-0000-4000-8000-000000000001";
export const OTHER_STORE_ID = "b0000000-0000-4000-8000-000000000002";
export const USERS = {
  owner: { email: "owner@demo.stocktill.test", id: "a0000000-0000-4000-8000-000000000001" },
  admin: { email: "admin@demo.stocktill.test", id: "a0000000-0000-4000-8000-000000000002" },
  cashier: { email: "cashier@demo.stocktill.test", id: "a0000000-0000-4000-8000-000000000003" },
  otherOwner: { email: "owner@other.stocktill.test", id: "a0000000-0000-4000-8000-000000000004" },
} as const;
