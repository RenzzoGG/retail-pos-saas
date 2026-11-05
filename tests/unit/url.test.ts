import { describe, expect, it } from "vitest";
import { parseProductListQuery } from "@/features/inventory/schemas";
import { withQuery } from "@/lib/url";

describe("withQuery", () => {
  it("drops empty values and encodes the rest", () => {
    expect(withQuery("/app/products", { q: "usb c", page: 2, low: true, category: "" })).toBe("/app/products?q=usb+c&page=2&low=1");
    expect(withQuery("/app/products", { low: false })).toBe("/app/products");
  });
});

describe("product list query", () => {
  it("parses valid params", () => {
    expect(parseProductListQuery({ q: " cable ", low: "1", sort: "stock", dir: "desc", page: "3" })).toEqual({
      q: "cable",
      category: "",
      low: true,
      sort: "stock",
      dir: "desc",
      page: 3,
    });
  });
  it("falls back to safe defaults for invalid params", () => {
    expect(parseProductListQuery({ sort: "cost_price; drop table", dir: "sideways", page: "-4" })).toMatchObject({
      sort: "name",
      dir: "asc",
      page: 1,
    });
  });
});
