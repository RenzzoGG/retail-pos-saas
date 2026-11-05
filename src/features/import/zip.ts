import { MAX_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from "./limits";

/**
 * An .xlsx file is a ZIP archive. Before handing it to the parser we read the
 * ZIP's central directory (a small index at the end of the file) and add up
 * the declared uncompressed sizes. A tiny file that would expand to hundreds of
 * MB ("zip bomb") is rejected without decompressing anything.
 * ZIP64 archives (huge files) are not needed for a 1 MB upload and are refused.
 */
export function checkZipDeclaredSize(
  bytes: Uint8Array,
  limit = MAX_UNCOMPRESSED_BYTES,
): { ok: true; uncompressed: number; entries: number } | { ok: false; reason: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;

  // The End Of Central Directory record is in the last 22 + 65,535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "not_a_zip" };

  const entries = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || dirOffset === 0xffffffff) return { ok: false, reason: "zip64_not_supported" };
  if (entries > MAX_ZIP_ENTRIES) return { ok: false, reason: "too_many_entries" };

  let offset = dirOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL) return { ok: false, reason: "corrupt_zip" };
    const uncompressed = view.getUint32(offset + 24, true);
    if (uncompressed === 0xffffffff) return { ok: false, reason: "zip64_not_supported" };
    total += uncompressed;
    if (total > limit) return { ok: false, reason: "too_large_uncompressed" };
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, uncompressed: total, entries };
}
