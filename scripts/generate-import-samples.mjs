// Generates the sample import files in docs/samples (run: node scripts/generate-import-samples.mjs).
// Fictional products for the fictional Stocktill demo store.
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const HEADERS = ["Name", "SKU", "Barcode", "Category", "Sale price", "Low stock threshold", "Initial stock", "Unit cost"];

// 1) Mixed sample: valid new products, 2 updates of seed products, and rows with errors.
const sample = [
  HEADERS,
  ["Braided USB-C Cable 3 m", "SMP-CBL-USBC-3M", "2900000000011", "Cables", 18.99, 5, 25, 6.4],
  ["USB-A to USB-C Adapter", "SMP-ADP-A2C", "2900000000028", "Adapters", 6.99, 10, 60, 1.75],
  ["Magnetic Phone Mount", "SMP-MNT-MAG", "2900000000035", "Car", 21.5, 4, 12, 8.1],
  ["Laptop Stand Aluminium", "SMP-STD-LAP", "2900000000042", "Computer", 39.99, 3, 8, 16],
  ["Webcam 1080p", "SMP-CAM-1080", "2900000000059", "Computer", 49.99, 2, 6, 22.5],
  ["Smart Plug Wi-Fi", "SMP-PLG-WIFI", "2900000000066", "Smart Home", 14.99, 6, 30, 5.2],
  ["LED Desk Lamp", "SMP-LMP-LED", "2900000000073", "Lighting", 27.99, 3, "", ""],
  ["Gaming Mouse Pad XL", "SMP-PAD-XL", "2900000000080", "Computer", "$12.50", 5, 20, "4,10"],
  ["Screen Cleaning Kit", "SMP-CLN-KIT", "", "Accessories", 7.99, "", 40, 1.9],
  ["Bluetooth Tracker Tag", "SMP-TRK-TAG", "2900000000097", "Accessories", 24.99, 4, 15, 9.75],
  // Updates of seed products (valid only with "Update existing products" on).
  ["USB-C to USB-C Cable 1 m", "CBL-USBC-1M", "2000000000015", "Cables", 10.99, 10, 20, 3.5],
  ["Power Bank 20,000 mAh", "PWB-20K", "", "", 47.99, "", 10, 21],
  // Rows with errors (reported in the preview and the error report).
  ["", "SMP-ERR-NONAME", "", "Cables", 5, "", "", ""],
  ["Negative Price Cable", "SMP-ERR-NEG", "", "Cables", -3, "", "", ""],
  ["Duplicate SKU A", "SMP-ERR-DUP", "", "Cables", 4, "", "", ""],
  ["Duplicate SKU B", "SMP-ERR-DUP", "", "Cables", 4, "", "", ""],
  ["Taken Barcode Cable", "SMP-ERR-BARCODE", "2000000000022", "Cables", 8, "", "", ""],
  ["Stock Without Cost", "SMP-ERR-NOCOST", "", "Cables", 8, "", 5, ""],
  ["Half Unit Stock", "SMP-ERR-HALF", "", "Cables", 8, "", 2.5, 1],
  ["Formula Name", "=1+1", "", "Cables", 8, "", "", ""],
];

function writeBook(rows, path, bookType) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Codes as text so Excel keeps them as typed.
  for (let r = 1; r < rows.length; r++) {
    for (const c of [1, 2]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (sheet[ref]) {
        sheet[ref].t = "s";
        sheet[ref].v = String(sheet[ref].v);
        sheet[ref].z = "@";
      }
    }
  }
  sheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 20 }, { wch: 13 }, { wch: 10 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  writeFileSync(path, XLSX.write(book, { type: "buffer", bookType }));
}

writeBook(sample, "docs/samples/products-import-sample.xlsx", "xlsx");
writeBook(sample, "docs/samples/products-import-sample.csv", "csv");

// 2) A large, all-valid catalog: 600 products with opening stock.
const categories = ["Cables", "Chargers", "Audio", "Cases", "Computer", "Power", "Storage", "Smart Home"];
const bulk = [HEADERS];
for (let i = 1; i <= 600; i++) {
  const n = String(i).padStart(4, "0");
  const category = categories[i % categories.length];
  const cost = Math.round((2 + (i % 40) * 0.85) * 100) / 100;
  const price = Math.round(cost * 2.2 * 100) / 100;
  bulk.push([`Bulk ${category} Item ${n}`, `BULK-${n}`, `2910000${String(i).padStart(6, "0")}`, category, price, 3, 5 + (i % 30), cost]);
}
writeBook(bulk, "docs/samples/products-600.csv", "csv");
console.log("Wrote docs/samples/products-import-sample.{xlsx,csv} and docs/samples/products-600.csv");
