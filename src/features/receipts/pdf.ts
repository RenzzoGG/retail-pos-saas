import "server-only";
import PDFDocument from "pdfkit";
import { COLUMNS, type ReceiptLine } from "./layout";

/**
 * Renders receipt lines as a PDF for 80 mm thermal printers.
 * Page: 80 mm wide (226.77 pt), 4 mm side margins (~72 mm printable, the usual
 * area of an 80 mm printer), height fitted to the content. Courier (a built-in
 * PDF font) keeps the columns aligned; 42 characters at 8 pt fill the width.
 */
const MM = 72 / 25.4;
const WIDTH = 80 * MM;
const MARGIN_X = 4 * MM;
const MARGIN_Y = 5 * MM;
const FONT_SIZE = 8;
const LINE = 10.5;

function lineHeight(line: ReceiptLine): number {
  return line.size === "large" ? LINE * 1.35 : LINE;
}

export function renderReceiptPdf(lines: ReceiptLine[], title: string): Promise<Buffer> {
  const height = MARGIN_Y * 2 + lines.reduce((sum, l) => sum + lineHeight(l), 0);
  const doc = new PDFDocument({
    size: [WIDTH, Math.max(height, 60 * MM)],
    margins: { top: MARGIN_Y, bottom: MARGIN_Y, left: MARGIN_X, right: MARGIN_X },
    info: { Title: title, Creator: "Stocktill (fictional brand)" },
    autoFirstPage: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const usable = WIDTH - MARGIN_X * 2;
  let y = MARGIN_Y;
  for (const line of lines) {
    const size = line.size === "large" ? FONT_SIZE * 1.25 : FONT_SIZE;
    doc.font(line.bold ? "Courier-Bold" : "Courier").fontSize(size);
    // Large lines hold fewer characters: shrink them if they'd overflow.
    const fitted = line.size === "large" && line.text.length > Math.floor(COLUMNS / 1.25) ? FONT_SIZE : size;
    doc.fontSize(fitted).text(line.text, MARGIN_X, y, {
      width: usable,
      align: line.center ? "center" : "left",
      lineBreak: false,
    });
    y += lineHeight(line);
  }
  doc.end();
  return done;
}
