/** Import limits (shown in the UI and enforced on the server). */
export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB: ~10x a 2,000-row catalog in .xlsx or .csv
export const MAX_DATA_ROWS = 2000; // also enforced by public.import_products
/** For .xlsx (a ZIP): reject files whose declared uncompressed size is larger (zip bombs). */
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 200;
