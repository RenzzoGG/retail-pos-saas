/**
 * Role rules shared by the UI (to hide what you can't do) and the server (to
 * refuse it). The database enforces the same rules with RLS; this module only
 * avoids pointless requests and gives clear messages.
 */
export const STORE_ROLES = ["owner", "admin", "cashier"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export function isStoreRole(value: unknown): value is StoreRole {
  return typeof value === "string" && (STORE_ROLES as readonly string[]).includes(value);
}

export function isManager(role: StoreRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Can `actor` manage (invite, change, remove) a membership whose role is `target`?
 * Owners manage everyone; admins only cashiers (decided in phase 3).
 */
export function canManageRole(actor: StoreRole, target: StoreRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "cashier";
  return false;
}

/** Roles `actor` may assign when inviting (owners are never invited). */
export function invitableRoles(actor: StoreRole): StoreRole[] {
  if (actor === "owner") return ["admin", "cashier"];
  if (actor === "admin") return ["cashier"];
  return [];
}

/** Roles `actor` may set on an existing member. */
export function assignableRoles(actor: StoreRole): StoreRole[] {
  if (actor === "owner") return ["owner", "admin", "cashier"];
  if (actor === "admin") return ["cashier"];
  return [];
}

export type NavItem = {
  href: string;
  label: string;
  /** Roles that can see and open the section. */
  roles: readonly StoreRole[];
};

const ALL: readonly StoreRole[] = STORE_ROLES;
const MANAGERS: readonly StoreRole[] = ["owner", "admin"];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", label: "Dashboard", roles: ALL },
  { href: "/app/pos", label: "Sales / POS", roles: ALL },
  { href: "/app/products", label: "Products", roles: ALL },
  { href: "/app/customers", label: "Customers", roles: ALL },
  { href: "/app/reports", label: "Reports", roles: MANAGERS },
  { href: "/app/activity", label: "Activity", roles: MANAGERS },
  { href: "/app/team", label: "Team", roles: MANAGERS },
  { href: "/app/settings", label: "Settings", roles: MANAGERS },
];

export function navForRole(role: StoreRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export const ROLE_LABELS: Record<StoreRole, string> = {
  owner: "Owner",
  admin: "Admin",
  cashier: "Cashier",
};
