/**
 * Lenient number parsing for spreadsheet cells, so files from different tools
 * and locales work:
 *   12        -> 12           "$1,234.50" -> 1234.5      "1.234,50" -> 1234.5
 *   "12,5"    -> 12.5         "1,234"     -> 1234        " 7 "      -> 7
 * Rules: currency symbols/codes and spaces are ignored; with both "," and ".",
 * the LAST one is the decimal separator; a lone "," is a thousands separator
 * only in groups of three ("1,234"), otherwise a decimal comma ("12,5").
 * Returns null for empty cells and NaN for text that is not a number.
 */
export function parseNumberCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "boolean") return Number.NaN;

  let text = String(value)
    .replace(/[\s ]/g, "")
    .replace(/^[A-Za-z]{3}(?=[-+\d.,])/, "") // "USD12.50"
    .replace(/(?<=[\d.,])[A-Za-z]{3}$/, "") // "12.50EUR"
    .replace(/[$€£¥₹₽₩₱]/g, "");
  if (text === "") return null;
  if (text.startsWith("+")) text = text.slice(1);

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    text =
      lastComma > lastDot
        ? text.replace(/\./g, "").replace(",", ".") // 1.234,50
        : text.replace(/,/g, ""); // 1,234.50
  } else if (lastComma >= 0) {
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(text)) {
    text = text.replace(/\./g, ""); // 1.234.567
  }

  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/** Text cells (SKU, barcode, names): numbers become plain digit strings, never "1.23E+12". */
export function textCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  }
  return String(value).trim();
}
