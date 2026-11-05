import { inflateSync } from "node:zlib";

/**
 * Text drawn in a pdfkit PDF (tests only): inflates the content streams and decodes
 * the hex strings pdfkit writes for the standard fonts. Lines are concatenated.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue; // not a deflated content stream
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) parts.push(Buffer.from(hex[1] ?? "", "hex").toString("latin1"));
    parts.push("\n");
  }
  return parts.join("");
}

/** Page width in points of the first page (80 mm = 226.77 pt). */
export function pdfPageWidth(pdf: Buffer): number | null {
  const m = /\/MediaBox \[0 0 ([\d.]+) [\d.]+\]/.exec(pdf.toString("latin1"));
  return m ? Number(m[1]) : null;
}
