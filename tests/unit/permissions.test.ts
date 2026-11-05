import { describe, expect, it } from "vitest";
import { assignableRoles, canManageRole, invitableRoles, navForRole } from "@/lib/permissions";

describe("role rules", () => {
  it("owners manage everyone", () => {
    expect(["owner", "admin", "cashier"].every((r) => canManageRole("owner", r as never))).toBe(true);
    expect(invitableRoles("owner")).toEqual(["admin", "cashier"]);
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "cashier"]);
  });

  it("admins manage only cashiers", () => {
    expect(canManageRole("admin", "cashier")).toBe(true);
    expect(canManageRole("admin", "admin")).toBe(false);
    expect(canManageRole("admin", "owner")).toBe(false);
    expect(invitableRoles("admin")).toEqual(["cashier"]);
    expect(assignableRoles("admin")).toEqual(["cashier"]);
  });

  it("cashiers manage nobody", () => {
    expect(canManageRole("cashier", "cashier")).toBe(false);
    expect(invitableRoles("cashier")).toEqual([]);
  });

  it("navigation hides manager sections from cashiers", () => {
    const labels = navForRole("cashier").map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "POS", "Sales", "Products", "Customers"]);
    expect(navForRole("admin").map((i) => i.label)).toContain("Team");
    expect(navForRole("admin").map((i) => i.label)).toContain("Activity");
    expect(navForRole("owner").map((i) => i.label)).toContain("Settings");
  });
});
