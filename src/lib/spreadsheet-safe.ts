/**
 * Spreadsheet ("CSV/formula") injection guard. Text that starts with = + - @
 * (or tab / carriage return) could be run as a formula by Excel, LibreOffice or
 * Google Sheets, and our files contain text typed by users (product and
 * customer names...). Such text gets a leading apostrophe so it stays text.
 * Used by the import error report (CSV) and the sales export (XLSX).
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
